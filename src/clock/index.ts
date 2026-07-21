/**
 * The clock seam: every Temporal usage in nl2time flows through this module.
 *
 * Portability contract (see docs/porting.md): a Python port replaces this
 * module with `whenever` (Temporal-inspired) — Temporal.Instant ↔
 * whenever.Instant, Temporal.ZonedDateTime ↔ whenever.ZonedDateTime,
 * Temporal.PlainDate ↔ whenever.Date. No other module may import Temporal
 * directly.
 */
import { Temporal } from 'temporal-polyfill';

import type { Grain, Unit, Weekday } from '../ir/types.js';

export { Temporal };

export type Instant = Temporal.Instant;
export type Zoned = Temporal.ZonedDateTime;

/** Half-open zoned interval [start, end) carrying its granularity. */
export interface ZInterval {
  start: Zoned;
  end: Zoned;
  grain: Grain;
}

export function systemNow(): Instant {
  return Temporal.Now.instant();
}

export function systemTimeZone(): string {
  return Temporal.Now.timeZoneId();
}

export function toZoned(instant: Instant, timeZone: string): Zoned {
  return instant.toZonedDateTimeISO(timeZone);
}

const WEEKDAY_NUM: Record<Weekday, number> = {
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
  sun: 7,
};

export function weekdayNumber(w: Weekday): number {
  return WEEKDAY_NUM[w];
}

/** Point interval at z (grain 'instant'). */
export function pointInterval(z: Zoned): ZInterval {
  return { start: z, end: z, grain: 'instant' };
}

/**
 * The containing unit interval of z: floor to the unit boundary, extend one
 * unit. Weeks honor weekStart; quarters are calendar quarters.
 */
export function containingUnit(z: Zoned, unit: Unit, weekStart: Weekday): ZInterval {
  const start = floorTo(z, unit, weekStart);
  return { start, end: addUnits(start, unit, 1), grain: unit };
}

export function floorTo(z: Zoned, unit: Unit, weekStart: Weekday): Zoned {
  switch (unit) {
    case 'second':
      return z.round({ smallestUnit: 'second', roundingMode: 'floor' });
    case 'minute':
      return z.round({ smallestUnit: 'minute', roundingMode: 'floor' });
    case 'hour':
      return z.round({ smallestUnit: 'hour', roundingMode: 'floor' });
    case 'day':
      return z.startOfDay();
    case 'week': {
      const target = WEEKDAY_NUM[weekStart];
      // dayOfWeek is ISO (mon=1..sun=7); step back to the week-start day.
      const delta = (z.dayOfWeek - target + 7) % 7;
      return z.startOfDay().subtract({ days: delta });
    }
    case 'month':
      return z.with({ day: 1 }).startOfDay();
    case 'quarter': {
      const qStartMonth = Math.floor((z.month - 1) / 3) * 3 + 1;
      return z.with({ month: qStartMonth, day: 1 }).startOfDay();
    }
    case 'year':
      return z.with({ month: 1, day: 1 }).startOfDay();
  }
}

/**
 * Calendar-aware unit addition: day/week/month/quarter/year offsets preserve
 * wall-clock time across DST (Temporal semantics); hour/minute/second are
 * exact.
 */
export function addUnits(z: Zoned, unit: Unit, n: number): Zoned {
  switch (unit) {
    case 'second':
      return z.add({ seconds: n });
    case 'minute':
      return z.add({ minutes: n });
    case 'hour':
      return z.add({ hours: n });
    case 'day':
      return z.add({ days: n });
    case 'week':
      return z.add({ weeks: n });
    case 'month':
      return z.add({ months: n });
    case 'quarter':
      return z.add({ months: 3 * n });
    case 'year':
      return z.add({ years: n });
  }
}

/** Whole calendar days between two zoned datetimes (calendar difference, not /86400s). */
export function calendarDaysBetween(from: Zoned, to: Zoned): number {
  return to.startOfDay().since(from.startOfDay(), { largestUnit: 'day' }).days;
}
