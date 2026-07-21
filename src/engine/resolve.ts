import {
  addUnits,
  calendarDaysBetween,
  containingUnit,
  floorTo,
  pointInterval,
  weekdayNumber,
  type Instant,
  type ZInterval,
  type Zoned,
} from '../clock/index.js';
import type { TimeContext } from '../context.js';
import { dayPeriodRules } from '../data/dayPeriods.js';
import type {
  CalendarAmount,
  DayPeriod,
  Grain,
  PartialDate,
  PartialTime,
  TimeExpr,
  Unit,
} from '../ir/types.js';

export class NotResolvableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotResolvableError';
  }
}

export class AmbiguityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AmbiguityError';
  }
}

/** A resolved value. Intervals are half-open [start, end). */
export type TimeValue =
  | { kind: 'interval'; start: Instant; end: Instant; grain: Grain }
  | { kind: 'duration'; iso: string }
  | { kind: 'amount'; amount: CalendarAmount };

export interface Resolution {
  /** Ordered best-first under the context policy. Ambiguity is data, not an error. */
  candidates: TimeValue[];
}

type Cand =
  | { type: 'interval'; zi: ZInterval }
  | { type: 'duration'; iso: string }
  | { type: 'amount'; amount: CalendarAmount };

const GRAIN_ORDER: readonly Grain[] = [
  'instant',
  'second',
  'minute',
  'hour',
  'day',
  'week',
  'month',
  'quarter',
  'year',
];

function finerGrain(a: Grain, b: Grain): Grain {
  return GRAIN_ORDER.indexOf(a) <= GRAIN_ORDER.indexOf(b) ? a : b;
}

const MAX_CANDIDATES = 4;

export function resolve(expr: TimeExpr, ctx: TimeContext): Resolution {
  const cands = evalExpr(expr, ctx, undefined).slice(0, MAX_CANDIDATES);
  return { candidates: cands.map((c) => toValue(c)) };
}

/** First candidate under policy, or throw. */
export function resolveOne(expr: TimeExpr, ctx: TimeContext): TimeValue {
  const { candidates } = resolve(expr, ctx);
  const first = candidates[0];
  if (!first) throw new AmbiguityError('expression produced no candidates');
  return first;
}

function toValue(c: Cand): TimeValue {
  switch (c.type) {
    case 'interval':
      return {
        kind: 'interval',
        start: c.zi.start.toInstant(),
        end: c.zi.end.toInstant(),
        grain: c.zi.grain,
      };
    case 'duration':
      return { kind: 'duration', iso: c.iso };
    case 'amount':
      return { kind: 'amount', amount: c.amount };
  }
}

/**
 * Evaluate an expression to ordered candidates. `anchor` carries the date
 * context inside an intersect ("tomorrow at 4" evaluates the time literal
 * against tomorrow, not today).
 */
function evalExpr(expr: TimeExpr, ctx: TimeContext, anchor: ZInterval | undefined): Cand[] {
  switch (expr.op) {
    case 'now':
      return [{ type: 'interval', zi: pointInterval(ctx.zonedNow) }];

    case 'literal':
      return evalLiteral(expr, ctx, anchor);

    case 'offset':
      return intervalMap(evalExpr(expr.base, ctx, anchor), (zi) => ({
        start: addUnits(zi.start, expr.unit, expr.amount),
        end: addUnits(zi.end, expr.unit, expr.amount),
        grain: zi.grain,
      }));

    case 'snap':
      return intervalMap(evalExpr(expr.base, ctx, anchor), (zi) => {
        const unit = containingUnit(zi.start, expr.unit, ctx.weekStart);
        if (expr.edge === 'start') return pointInterval(unit.start);
        if (expr.edge === 'end') return pointInterval(unit.end);
        return unit;
      });

    case 'span':
      return intervalMap(evalExpr(expr.anchor, ctx, anchor), (zi) =>
        evalSpan(zi, expr.amount, ctx),
      );

    case 'between': {
      const starts = evalExpr(expr.start, ctx, anchor);
      const ends = evalExpr(expr.end, ctx, anchor);
      const out: Cand[] = [];
      for (const s of starts) {
        for (const e of ends) {
          if (s.type !== 'interval' || e.type !== 'interval') continue;
          if (Temporal_compare(s.zi.start, e.zi.end) >= 0) continue;
          out.push({
            type: 'interval',
            zi: {
              start: s.zi.start,
              end: e.zi.end,
              grain: finerGrain(s.zi.grain, e.zi.grain),
            },
          });
        }
      }
      return out;
    }

    case 'seek':
      return evalSeek(expr, ctx, anchor);

    case 'intersect': {
      // Left-to-right: each part is evaluated with the accumulated interval as
      // its anchor. Time-of-day parts (a clock time or day period with no date
      // of their own) COMPOSE onto the anchor day — "last night" is 21:00 of
      // yesterday wrapping to 06:00 today, which must not be clipped at the
      // day boundary. Parts that carry their own date CONSTRAIN by interval
      // intersection.
      let acc = evalExpr(expr.parts[0]!, ctx, anchor);
      for (const part of expr.parts.slice(1)) {
        const composes = isTimeOfDayPart(part);
        const next: Cand[] = [];
        for (const a of acc) {
          if (a.type !== 'interval') continue;
          for (const b of evalExpr(part, ctx, a.zi)) {
            if (b.type !== 'interval') continue;
            if (composes) {
              next.push(b);
              continue;
            }
            const zi = intersectIntervals(a.zi, b.zi);
            if (zi) next.push({ type: 'interval', zi });
          }
        }
        acc = next;
      }
      return acc;
    }

    case 'duration':
      return [{ type: 'duration', iso: expr.iso }];

    case 'amount':
      return [{ type: 'amount', amount: expr.amount }];

    case 'recur':
      throw new NotResolvableError(
        'recurrence expressions are representable in v1 but not yet resolvable (planned for v2)',
      );
  }
}

/** A part that names a time within a day rather than a day: composes onto its anchor. */
function isTimeOfDayPart(expr: TimeExpr): boolean {
  if (expr.op === 'literal') return expr.date === undefined && (expr.time !== undefined || expr.dayPeriod !== undefined);
  if (expr.op === 'seek') return expr.target.kind === 'dayPeriod';
  return false;
}

function intervalMap(cands: Cand[], f: (zi: ZInterval) => ZInterval): Cand[] {
  return cands.map((c) => (c.type === 'interval' ? { type: 'interval', zi: f(c.zi) } : c));
}

function Temporal_compare(a: Zoned, b: Zoned): number {
  const x = a.epochNanoseconds;
  const y = b.epochNanoseconds;
  return x < y ? -1 : x > y ? 1 : 0;
}

function intersectIntervals(a: ZInterval, b: ZInterval): ZInterval | undefined {
  // Point intervals (grain 'instant') act as points-in-time; containment check.
  const start = Temporal_compare(a.start, b.start) >= 0 ? a.start : b.start;
  const end = Temporal_compare(a.end, b.end) <= 0 ? a.end : b.end;
  if (Temporal_compare(start, end) > 0) return undefined;
  if (Temporal_compare(start, end) === 0 && a.grain !== 'instant' && b.grain !== 'instant') {
    return undefined;
  }
  return { start, end, grain: finerGrain(a.grain, b.grain) };
}

// ---------------------------------------------------------------------------
// span
// ---------------------------------------------------------------------------

function smallestUnitOf(amount: CalendarAmount): Unit {
  if (amount.seconds) return 'second';
  if (amount.minutes) return 'minute';
  if (amount.hours) return 'hour';
  if (amount.days) return 'day';
  if (amount.weeks) return 'week';
  if (amount.months) return 'month';
  return 'year';
}

function addAmount(z: Zoned, amount: CalendarAmount, factor: 1 | -1): Zoned {
  const scaled: Record<string, number> = {};
  for (const [k, v] of Object.entries(amount)) {
    if (typeof v === 'number' && v !== 0) scaled[k] = v * factor;
  }
  return z.add(scaled);
}

function evalSpan(anchorZi: ZInterval, amount: CalendarAmount, ctx: TimeContext): ZInterval {
  const negative = Object.values(amount).some((v) => typeof v === 'number' && v < 0);
  const unit = smallestUnitOf(amount);
  const coarse = GRAIN_ORDER.indexOf(unit) >= GRAIN_ORDER.indexOf('day');

  let anchorPoint = negative ? anchorZi.end : anchorZi.start;
  // "the last 3 days" excluding today: anchor at today's start instead of now.
  if (
    ctx.partialPeriod === 'exclude' &&
    anchorZi.grain === 'instant' &&
    coarse
  ) {
    anchorPoint = floorTo(anchorPoint, 'day', ctx.weekStart);
  }

  const other = addAmount(anchorPoint, amount, 1);
  const [start, end] =
    Temporal_compare(anchorPoint, other) <= 0 ? [anchorPoint, other] : [other, anchorPoint];
  return { start, end, grain: unit };
}

// ---------------------------------------------------------------------------
// seek
// ---------------------------------------------------------------------------

function evalSeek(
  expr: Extract<TimeExpr, { op: 'seek' }>,
  ctx: TimeContext,
  anchor: ZInterval | undefined,
): Cand[] {
  const bases = evalExpr(expr.base, ctx, anchor);
  const out: Cand[] = [];
  for (const b of bases) {
    if (b.type !== 'interval') continue;
    const zi = seekFrom(b.zi, expr, ctx);
    if (zi) out.push({ type: 'interval', zi });
  }
  return out;
}

function seekFrom(
  base: ZInterval,
  expr: Extract<TimeExpr, { op: 'seek' }>,
  ctx: TimeContext,
): ZInterval | undefined {
  const t = expr.target;
  switch (t.kind) {
    case 'weekday': {
      const target = weekdayNumber(t.weekday);
      const n = expr.n ?? 1;
      if (base.grain !== 'instant' && GRAIN_ORDER.indexOf(base.grain) > GRAIN_ORDER.indexOf('day')) {
        // "the 2nd Monday of March": nth occurrence inside the base interval.
        let day = floorTo(base.start, 'day', ctx.weekStart);
        const delta = (target - day.dayOfWeek + 7) % 7;
        day = day.add({ days: delta + 7 * (n - 1) });
        if (Temporal_compare(day, base.end) >= 0) return undefined;
        return { start: day, end: day.add({ days: 1 }), grain: 'day' };
      }
      // Deictic navigation from a point/day ("next Tuesday").
      const today = floorTo(base.start, 'day', ctx.weekStart);
      const dow = today.dayOfWeek;
      let day: Zoned;
      if (expr.dir === 'next') {
        if (ctx.nextWeekday === 'week-after') {
          const weekStartDay = floorTo(today.add({ days: 7 }), 'week', ctx.weekStart);
          const delta = (target - weekStartDay.dayOfWeek + 7) % 7;
          day = weekStartDay.add({ days: delta });
        } else {
          const delta = ((target - dow + 6) % 7) + 1; // strictly after today
          day = today.add({ days: delta + 7 * (n - 1) });
        }
      } else if (expr.dir === 'prev') {
        const delta = ((dow - target + 6) % 7) + 1; // strictly before today
        day = today.subtract({ days: delta + 7 * (n - 1) });
      } else {
        // 'nearest': bias decides; 'none' behaves like future ("Friday" usually
        // means the upcoming one in conversation).
        const forwardDelta = ((target - dow + 6) % 7) + 1;
        const backDelta = ((dow - target + 6) % 7) + 1;
        day =
          ctx.bias === 'past'
            ? today.subtract({ days: backDelta })
            : today.add({ days: forwardDelta });
      }
      return { start: day, end: day.add({ days: 1 }), grain: 'day' };
    }
    case 'month': {
      const refYearStart = floorTo(base.start, 'year', ctx.weekStart);
      let m = refYearStart.with({ month: t.month });
      const cmp = Temporal_compare(m, base.start);
      if (expr.dir === 'next' && cmp <= 0) m = m.add({ years: 1 });
      if (expr.dir === 'prev' && cmp >= 0) m = m.subtract({ years: 1 });
      const start = floorTo(m, 'month', ctx.weekStart);
      return { start, end: addUnits(start, 'month', 1), grain: 'month' };
    }
    case 'dayPeriod': {
      return dayPeriodInterval(base, t.period, ctx);
    }
    case 'unit': {
      const cur = containingUnit(base.start, t.unit, ctx.weekStart);
      const n = expr.n ?? 1;
      const shift = expr.dir === 'next' ? n : expr.dir === 'prev' ? -n : 0;
      return {
        start: addUnits(cur.start, t.unit, shift),
        end: addUnits(cur.end, t.unit, shift),
        grain: t.unit,
      };
    }
  }
}

/** The day-period interval within (anchored to) the day of `base`. */
export function dayPeriodInterval(
  base: ZInterval,
  period: DayPeriod,
  ctx: TimeContext,
): ZInterval | undefined {
  const rule = dayPeriodRules(ctx.language).find((r) => r.period === period);
  if (!rule) return undefined;
  const day = floorTo(base.start, 'day', ctx.weekStart);
  const start = day.add({ hours: rule.from });
  const end =
    rule.before > rule.from
      ? day.add({ hours: rule.before })
      : day.add({ days: 1 }).add({ hours: rule.before });
  return { start, end, grain: 'hour' };
}

// ---------------------------------------------------------------------------
// literal
// ---------------------------------------------------------------------------

function evalLiteral(
  expr: Extract<TimeExpr, { op: 'literal' }>,
  ctx: TimeContext,
  anchor: ZInterval | undefined,
): Cand[] {
  const refDay = floorTo(anchor?.start ?? ctx.zonedNow, 'day', ctx.weekStart);
  const dateCands: ZInterval[] = expr.date
    ? resolveDate(expr.date, ctx, anchor)
    : anchor
      ? [anchor]
      : [{ start: refDay, end: refDay.add({ days: 1 }), grain: 'day' }];

  if (!expr.time && !expr.dayPeriod) return dateCands.map((zi) => ({ type: 'interval', zi }));

  const out: Cand[] = [];
  for (const d of dateCands) {
    if (expr.dayPeriod) {
      const zi = dayPeriodInterval(d, expr.dayPeriod, ctx);
      if (zi) out.push({ type: 'interval', zi });
      continue;
    }
    for (const timeCand of resolveTime(expr.time!, d)) {
      out.push({ type: 'interval', zi: timeCand });
    }
  }
  return out;
}

function resolveDate(date: PartialDate, ctx: TimeContext, anchor: ZInterval | undefined): ZInterval[] {
  const ref = anchor?.start ?? ctx.zonedNow;

  if (date.year !== undefined && date.month !== undefined && date.day !== undefined) {
    const day = ref.with({ year: date.year, month: date.month, day: date.day }).startOfDay();
    return [{ start: day, end: day.add({ days: 1 }), grain: 'day' }];
  }

  if (date.year !== undefined && date.month !== undefined) {
    const start = ref.with({ year: date.year, month: date.month, day: 1 }).startOfDay();
    return [{ start, end: start.add({ months: 1 }), grain: 'month' }];
  }

  if (date.year !== undefined) {
    const start = ref.with({ year: date.year, month: 1, day: 1 }).startOfDay();
    return [{ start, end: start.add({ years: 1 }), grain: 'year' }];
  }

  if (date.month !== undefined && date.day !== undefined) {
    // "May 29" with no year → this year's occurrence plus the adjacent year,
    // ordered under bias (Recognizers-style past+future candidates).
    const mk = (yearDelta: number): ZInterval => {
      const day = ref
        .add({ years: yearDelta })
        .with({ month: date.month, day: date.day })
        .startOfDay();
      return { start: day, end: day.add({ days: 1 }), grain: 'day' };
    };
    return orderByBias(mk(0), mk, ctx, 'years');
  }

  if (date.month !== undefined) {
    const mk = (yearDelta: number): ZInterval => {
      const start = ref.add({ years: yearDelta }).with({ month: date.month, day: 1 }).startOfDay();
      return { start, end: start.add({ months: 1 }), grain: 'month' };
    };
    return orderByBias(mk(0), mk, ctx, 'years');
  }

  if (date.day !== undefined) {
    // "the 3rd" → this month's occurrence plus the adjacent month.
    const mk = (monthDelta: number): ZInterval => {
      const day = ref.add({ months: monthDelta }).with({ day: date.day }).startOfDay();
      return { start: day, end: day.add({ days: 1 }), grain: 'day' };
    };
    return orderByBias(mk(0), mk, ctx, 'months');
  }

  const day = floorTo(ref, 'day', ctx.weekStart);
  return [{ start: day, end: day.add({ days: 1 }), grain: 'day' }];
}

/**
 * Order the this-period occurrence and its neighbor under the context bias:
 * 'future' → soonest occurrence not in the past first; 'past' → most recent
 * past occurrence first; 'none' → nearest by calendar distance first.
 */
function orderByBias(
  current: ZInterval,
  mk: (delta: number) => ZInterval,
  ctx: TimeContext,
  _unit: 'years' | 'months',
): ZInterval[] {
  const now = ctx.zonedNow;
  const isPast = Temporal_compare(current.end, now) <= 0;
  const isFuture = Temporal_compare(current.start, now) > 0;

  if (ctx.bias === 'future') {
    return isPast ? [mk(1), current] : [current, mk(1)];
  }
  if (ctx.bias === 'past') {
    return isFuture ? [mk(-1), current] : [current, mk(-1)];
  }
  // none → nearest first
  if (isPast) {
    const next = mk(1);
    const dPast = Math.abs(calendarDaysBetween(current.start, now));
    const dNext = Math.abs(calendarDaysBetween(now, next.start));
    return dPast <= dNext ? [current, next] : [next, current];
  }
  if (isFuture) {
    const prev = mk(-1);
    const dFut = Math.abs(calendarDaysBetween(now, current.start));
    const dPrev = Math.abs(calendarDaysBetween(prev.start, now));
    return dFut <= dPrev ? [current, prev] : [prev, current];
  }
  return [current];
}

function resolveTime(time: PartialTime, day: ZInterval): ZInterval[] {
  const grain: Grain = time.second !== undefined ? 'second' : time.minute !== undefined ? 'minute' : 'hour';
  const dayStart = day.start.startOfDay();

  const mk = (hour24: number): ZInterval => {
    const start = dayStart.add({
      hours: hour24,
      minutes: time.minute ?? 0,
      seconds: time.second ?? 0,
    });
    const end =
      grain === 'second'
        ? start.add({ seconds: 1 })
        : grain === 'minute'
          ? start.add({ minutes: 1 })
          : start.add({ hours: 1 });
    return { start, end, grain };
  };

  const h = time.hour ?? 0;
  if (time.meridiem === 'am') return [mk(h === 12 ? 0 : h)];
  if (time.meridiem === 'pm') return [mk(h === 12 ? 12 : h + 12)];
  if (time.meridiem === 'unknown' && h >= 1 && h <= 12) {
    // Ambiguous clock reading: both readings, plausibility-ordered ("at 4"
    // usually means 4pm; "at 9" usually means 9am).
    const am = mk(h === 12 ? 0 : h);
    const pm = mk(h === 12 ? 12 : h + 12);
    return h >= 7 && h <= 11 ? [am, pm] : [pm, am];
  }
  return [mk(h)];
}
