/**
 * The reverse direction: value → (TimeExpr, localized text).
 *
 * Stage 1 (select) chooses framing/unit and builds the IR expression that
 * describes the value; stage 2 (render) turns it into locale text via Intl.
 * The round-trip invariant: resolve(describe(v).expr, ctx) must contain v at
 * the stated grain (tested in test/roundtrip.test.ts).
 */
import {
  calendarDaysBetween,
  floorTo,
  toZoned,
  type Instant,
  type Zoned,
} from '../clock/index.js';
import type { TimeContext } from '../context.js';
import { periodForHour } from '../data/dayPeriods.js';
import type { TimeValue } from '../engine/resolve.js';
import type { Grain, TimeExpr, Unit, Weekday } from '../ir/types.js';

export type Framing = 'calendar' | 'elapsed' | 'absolute';

export interface DescribeOptions {
  framing?: Framing | 'auto';
  /** 'casual' produces "9pm last night"; 'neutral' produces "yesterday at 9:00 PM". */
  style?: 'neutral' | 'casual';
}

export interface Description {
  text: string;
  expr: TimeExpr;
  grain: Grain;
  framing: Framing;
}

const NOW: TimeExpr = { op: 'now' };
const WEEKDAYS_ISO: readonly Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export function describe(
  value: Instant | TimeValue,
  ctx: TimeContext,
  opts: DescribeOptions = {},
): Description {
  const style = opts.style ?? 'neutral';
  const framing = opts.framing ?? 'auto';

  if (typeof value === 'object' && 'kind' in value) {
    if (value.kind === 'duration' || value.kind === 'amount') {
      return describeAmount(value, ctx);
    }
    const start = toZoned(value.start, ctx.timeZone);
    return describeInterval(start, value.grain, ctx, framing, style);
  }
  // A bare instant: describe at minute grain (a DB timestamp answer).
  const z = toZoned(value, ctx.timeZone);
  return describeInterval(z, 'minute', ctx, framing, style);
}

function describeInterval(
  z: Zoned,
  grain: Grain,
  ctx: TimeContext,
  framing: Framing | 'auto',
  style: 'neutral' | 'casual',
): Description {
  if (framing === 'elapsed') return describeElapsed(z, ctx);
  if (framing === 'absolute') return describeAbsolute(z, grain, ctx);

  // auto / calendar
  const coarse = ['day', 'week', 'month', 'quarter', 'year'].includes(grain);
  if (coarse) return describeCoarse(z, grain as Unit, ctx);
  return describeDateTime(z, grain, ctx, style);
}

// ---------------------------------------------------------------------------
// coarse calendar grains: day / week / month / quarter / year
// ---------------------------------------------------------------------------

function describeCoarse(z: Zoned, unit: Unit, ctx: TimeContext): Description {
  const now = ctx.zonedNow;
  const thisUnitStart = floorTo(now, unit, ctx.weekStart);
  const valueStart = floorTo(z, unit, ctx.weekStart);

  const deltaMap: Record<string, [string, string, string]> = {
    day: ['yesterday', 'today', 'tomorrow'],
    week: ['last week', 'this week', 'next week'],
    month: ['last month', 'this month', 'next month'],
    quarter: ['last quarter', 'this quarter', 'next quarter'],
    year: ['last year', 'this year', 'next year'],
  };

  const delta = unitsBetween(thisUnitStart, valueStart, unit);
  if (delta >= -1 && delta <= 1) {
    const expr: TimeExpr =
      delta === 0
        ? { op: 'snap', base: NOW, unit }
        : { op: 'snap', base: { op: 'offset', base: NOW, amount: delta, unit }, unit };
    return { text: deltaMap[unit]![delta + 1]!, expr, grain: unit, framing: 'calendar' };
  }

  if (unit === 'day') return describeFarDay(z, ctx);

  if (unit === 'week') {
    const text = `the week of ${fmt(z, ctx, { month: 'long', day: 'numeric' })}`;
    return {
      text,
      expr: {
        op: 'snap',
        base: { op: 'literal', date: { year: z.year, month: z.month, day: z.day } },
        unit: 'week',
      },
      grain: 'week',
      framing: 'calendar',
    };
  }

  if (unit === 'month') {
    const sameYear = z.year === now.year;
    const text = sameYear ? fmt(z, ctx, { month: 'long' }) : fmt(z, ctx, { month: 'long', year: 'numeric' });
    const expr: TimeExpr = { op: 'literal', date: { month: z.month, year: z.year } };
    return { text, expr, grain: 'month', framing: 'calendar' };
  }

  if (unit === 'quarter') {
    const q = Math.floor((z.month - 1) / 3) + 1;
    return {
      text: `Q${q} ${z.year}`,
      expr: {
        op: 'snap',
        base: { op: 'literal', date: { year: z.year, month: (q - 1) * 3 + 1 } },
        unit: 'quarter',
      },
      grain: 'quarter',
      framing: 'calendar',
    };
  }

  return {
    text: String(z.year),
    expr: { op: 'literal', date: { year: z.year } },
    grain: 'year',
    framing: 'calendar',
  };
}

/** A specific day beyond yesterday/tomorrow: weekday within a week, else a date. */
function describeFarDay(z: Zoned, ctx: TimeContext): Description {
  const now = ctx.zonedNow;
  const dayDiff = calendarDaysBetween(now, z);
  const weekday = WEEKDAYS_ISO[z.dayOfWeek - 1]!;

  if (dayDiff < 0 && dayDiff > -7) {
    return {
      text: `last ${fmt(z, ctx, { weekday: 'long' })}`,
      expr: { op: 'seek', base: NOW, dir: 'prev', target: { kind: 'weekday', weekday } },
      grain: 'day',
      framing: 'calendar',
    };
  }
  if (dayDiff > 0 && dayDiff < 7) {
    return {
      text: `on ${fmt(z, ctx, { weekday: 'long' })}`,
      expr: { op: 'seek', base: NOW, dir: 'next', target: { kind: 'weekday', weekday } },
      grain: 'day',
      framing: 'calendar',
    };
  }
  const sameYear = z.year === now.year;
  const text = sameYear
    ? fmt(z, ctx, { month: 'long', day: 'numeric' })
    : fmt(z, ctx, { month: 'long', day: 'numeric', year: 'numeric' });
  // The emitted IR always carries the year (the text may omit it): a bare
  // month+day literal resolves past-first, which would break the round-trip
  // for future dates.
  const date = { year: z.year, month: z.month, day: z.day };
  return { text, expr: { op: 'literal', date }, grain: 'day', framing: 'calendar' };
}

// ---------------------------------------------------------------------------
// datetimes (grain finer than day)
// ---------------------------------------------------------------------------

function describeDateTime(
  z: Zoned,
  grain: Grain,
  ctx: TimeContext,
  style: 'neutral' | 'casual',
): Description {
  const day = describeCoarse(z, 'day', ctx);
  const timeExpr = timeLiteralFor(z, grain);
  const expr: TimeExpr = { op: 'intersect', parts: [day.expr, timeExpr] };
  const outGrain: Grain = grain === 'instant' ? 'minute' : grain;

  if (style === 'casual') {
    const casualDay = casualDayPhrase(z, ctx);
    if (casualDay) {
      return {
        text: `${casualTime(z, ctx)} ${casualDay}`,
        expr,
        grain: outGrain,
        framing: 'calendar',
      };
    }
  }

  const timeText = fmt(z, ctx, { hour: 'numeric', minute: '2-digit' });
  // "on Tuesday" already carries a preposition; "today"/"last Friday" need "at".
  const text = `${day.text} at ${timeText}`;
  return { text, expr, grain: outGrain, framing: 'calendar' };
}

function timeLiteralFor(z: Zoned, grain: Grain): TimeExpr {
  const h12 = z.hour % 12 === 0 ? 12 : z.hour % 12;
  const meridiem = z.hour < 12 ? 'am' : 'pm';
  const time: { hour: number; minute?: number; second?: number; meridiem: 'am' | 'pm' } = {
    hour: h12,
    meridiem,
  };
  if (grain !== 'hour') time.minute = z.minute;
  if (grain === 'second') time.second = z.second;
  return { op: 'literal', time };
}

/**
 * Casual day-period phrase for near days: "last night", "this morning",
 * "tonight", "tomorrow evening". Returns undefined beyond ±1 day.
 */
function casualDayPhrase(z: Zoned, ctx: TimeContext): string | undefined {
  const dayDiff = calendarDaysBetween(ctx.zonedNow, z);
  if (dayDiff < -1 || dayDiff > 1) return undefined;
  const period = z.hour < 6 ? 'morning' : periodForHour(ctx.language, z.hour);

  if (dayDiff === 0) {
    if (period === 'night') return 'tonight';
    return `this ${period}`;
  }
  if (dayDiff === -1) {
    if (period === 'evening' || period === 'night') return 'last night';
    return `yesterday ${period}`;
  }
  if (period === 'night') return 'tomorrow night';
  return `tomorrow ${period}`;
}

function casualTime(z: Zoned, ctx: TimeContext): string {
  void ctx;
  const h12 = z.hour % 12 === 0 ? 12 : z.hour % 12;
  const suffix = z.hour < 12 ? 'am' : 'pm';
  return z.minute === 0 ? `${h12}${suffix}` : `${h12}:${String(z.minute).padStart(2, '0')}${suffix}`;
}

// ---------------------------------------------------------------------------
// elapsed & absolute framings
// ---------------------------------------------------------------------------

const ELAPSED_LADDER: readonly { unit: Unit; seconds: number; max: number }[] = [
  { unit: 'second', seconds: 1, max: 60 },
  { unit: 'minute', seconds: 60, max: 3600 },
  { unit: 'hour', seconds: 3600, max: 86400 * 2 },
  { unit: 'day', seconds: 86400, max: 86400 * 30 },
  { unit: 'month', seconds: 86400 * 30, max: 86400 * 365 },
  { unit: 'year', seconds: 86400 * 365, max: Infinity },
];

function describeElapsed(z: Zoned, ctx: TimeContext): Description {
  const diffSec =
    (z.epochMilliseconds - ctx.zonedNow.epochMilliseconds) / 1000;
  const abs = Math.abs(diffSec);
  if (abs < 1) {
    return { text: 'now', expr: { op: 'now' }, grain: 'second', framing: 'elapsed' };
  }
  const rung =
    ELAPSED_LADDER.find((r) => abs < r.max) ?? ELAPSED_LADDER[ELAPSED_LADDER.length - 1]!;
  const n = Math.max(1, Math.trunc(abs / rung.seconds));
  const signed = diffSec < 0 ? -n : n;

  const rtf = new Intl.RelativeTimeFormat(ctx.locale, { numeric: 'always' });
  return {
    text: rtf.format(signed, rung.unit as Intl.RelativeTimeFormatUnit),
    expr: { op: 'offset', base: NOW, amount: signed, unit: rung.unit },
    grain: rung.unit,
    framing: 'elapsed',
  };
}

function describeAbsolute(z: Zoned, grain: Grain, ctx: TimeContext): Description {
  const fine = ['instant', 'second', 'minute', 'hour'].includes(grain);
  const dateOpts: Intl.DateTimeFormatOptions = fine
    ? { dateStyle: 'medium', timeStyle: 'short' }
    : { dateStyle: 'medium' };
  const date = { year: z.year, month: z.month, day: z.day };
  const expr: TimeExpr = fine
    ? { op: 'intersect', parts: [{ op: 'literal', date }, timeLiteralFor(z, grain)] }
    : { op: 'literal', date };
  return {
    text: fmt(z, ctx, dateOpts),
    expr,
    grain: fine ? (grain === 'instant' ? 'minute' : grain) : grain,
    framing: 'absolute',
  };
}

function describeAmount(
  value: Extract<TimeValue, { kind: 'duration' | 'amount' }>,
  ctx: TimeContext,
): Description {
  void ctx;
  if (value.kind === 'duration') {
    return {
      text: value.iso,
      expr: { op: 'duration', iso: value.iso },
      grain: 'second',
      framing: 'absolute',
    };
  }
  const parts = Object.entries(value.amount)
    .filter(([, v]) => typeof v === 'number' && v !== 0)
    .map(([k, v]) => `${v} ${Math.abs(v as number) === 1 ? k.slice(0, -1) : k}`);
  return {
    text: parts.join(' '),
    expr: { op: 'amount', amount: value.amount },
    grain: 'second',
    framing: 'absolute',
  };
}

// ---------------------------------------------------------------------------

function unitsBetween(a: Zoned, b: Zoned, unit: Unit): number {
  const dur = b.since(a, {
    largestUnit: unit === 'quarter' ? 'month' : unit,
    smallestUnit: unit === 'quarter' ? 'month' : unit,
    roundingMode: 'trunc',
  });
  switch (unit) {
    case 'second':
      return dur.seconds;
    case 'minute':
      return dur.minutes;
    case 'hour':
      return dur.hours;
    case 'day':
      return dur.days;
    case 'week':
      return dur.weeks;
    case 'month':
      return dur.months;
    case 'quarter':
      return Math.trunc(dur.months / 3);
    case 'year':
      return dur.years;
  }
}

function fmt(z: Zoned, ctx: TimeContext, opts: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(ctx.locale, { ...opts, timeZone: ctx.timeZone }).format(
    new Date(z.epochMilliseconds),
  );
}
