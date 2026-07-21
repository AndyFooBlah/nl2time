/**
 * The nl2time intermediate representation (IR).
 *
 * A TimeExpr is a small, JSON-serializable operator tree over timeline
 * intervals. Both directions of the library meet here: parsing produces a
 * TimeExpr, and describe() selects a TimeExpr before rendering it. Resolution
 * of a TimeExpr against a TimeContext is deterministic.
 *
 * The IR is language-neutral: the normative spec is schema/timeexpr.schema.json
 * plus docs/ir-spec.md, and ports (e.g. Python) implement the same semantics.
 */

export type Grain =
  | 'instant'
  | 'second'
  | 'minute'
  | 'hour'
  | 'day'
  | 'week'
  | 'month'
  | 'quarter'
  | 'year';

/** Units usable in offsets/snaps — every grain except the zero-width 'instant'. */
export type Unit = Exclude<Grain, 'instant'>;

export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

/** CLDR-style flexible day periods (boundaries come from locale data). */
export type DayPeriod = 'morning' | 'afternoon' | 'evening' | 'night';

/**
 * A calendar amount with unit-preserving fields ("2 months" is not a number of
 * seconds). Fields may be negative ("the past 3 days" is days: -3).
 */
export interface CalendarAmount {
  years?: number;
  months?: number;
  weeks?: number;
  days?: number;
  hours?: number;
  minutes?: number;
  seconds?: number;
}

/** Approximation / edge channel, after TIMEX3's `mod`: "early July", "around 5". */
export type Mod = 'approx' | 'start' | 'mid' | 'end';

/** What a `seek` navigates to. */
export type Target =
  | { kind: 'weekday'; weekday: Weekday }
  | { kind: 'month'; month: number } // 1-12
  | { kind: 'dayPeriod'; period: DayPeriod }
  | { kind: 'unit'; unit: Unit };

/**
 * Partial civil components. Only components the source text asserted are
 * present (chrono-node's known-vs-implied insight); missing components are
 * completed at resolution time under context policy, never defaulted here.
 */
export interface PartialDate {
  year?: number;
  month?: number; // 1-12
  day?: number;
}

export interface PartialTime {
  hour?: number; // 0-23 when meridiem is resolved; 1-12 with meridiem 'unknown'
  minute?: number;
  second?: number;
  /** 'unknown' marks an ambiguous clock reading ("at 4") → AM/PM candidates. */
  meridiem?: 'am' | 'pm' | 'unknown';
}

interface ModCarrier {
  mod?: Mod;
}

export type TimeExpr = TimeExprBody & ModCarrier;

export type TimeExprBody =
  /** The reference instant from the TimeContext. */
  | { op: 'now' }
  /** Civil components asserted by the text; optionally a day period. */
  | { op: 'literal'; date?: PartialDate; time?: PartialTime; dayPeriod?: DayPeriod }
  /** Calendar offset: offset(now, -1, 'week') is "one week before now". */
  | { op: 'offset'; base: TimeExpr; amount: number; unit: Unit }
  /**
   * Snap to the containing unit interval: snap(x, 'week') is the whole week
   * containing x (honoring the context week start). edge collapses to a point.
   */
  | { op: 'snap'; base: TimeExpr; unit: Unit; edge?: 'start' | 'end' }
  /**
   * Anchored span: span(now, {days: -3}) is the 3 days ending at now.
   * Positive amounts extend forward from the anchor start.
   */
  | { op: 'span'; anchor: TimeExpr; amount: CalendarAmount; business?: boolean }
  | { op: 'between'; start: TimeExpr; end: TimeExpr }
  /**
   * Directed calendar navigation: seek(now, 'next', weekday tue) is "next
   * Tuesday" (semantics of 'next' controlled by context nextWeekday policy);
   * seek(marchExpr, 'next', weekday mon, 2) is "the 2nd Monday of March".
   */
  | { op: 'seek'; base: TimeExpr; dir: 'next' | 'prev' | 'nearest'; target: Target; n?: number }
  /** Constraint intersection: "Tuesday" ∩ "morning" (SCATE-style). */
  | { op: 'intersect'; parts: TimeExpr[] }
  /** An exact elapsed duration ("for 90 minutes"). ISO-8601 duration string. */
  | { op: 'duration'; iso: string }
  /** A calendar amount as a value in its own right ("2 months"). */
  | { op: 'amount'; amount: CalendarAmount }
  /**
   * A named holiday, resolved by the engine's holiday table (fixed-date,
   * nth-weekday, or computed — Easter). Without a year: candidate occurrences
   * around the reference, ordered by bias/dir.
   */
  | { op: 'holiday'; name: HolidayName; year?: number; dir?: 'prev' | 'next' }
  /**
   * Recurrence — representable and serializable in v1, resolvable in v2.
   * "every Tuesday" = { every: 'week', filter: seek weekday tue }.
   */
  | { op: 'recur'; every: Unit; filter?: TimeExpr };

export type HolidayName =
  | 'black-friday'
  | 'earth-day'
  | 'st-patricks'
  | 'workers-day'
  | 'new-year'
  | 'new-year-eve'
  | 'valentines'
  | 'easter'
  | 'halloween'
  | 'thanksgiving'
  | 'christmas'
  | 'christmas-eve'
  | 'independence-day'
  | 'labor-day'
  | 'memorial-day'
  | 'mothers-day'
  | 'fathers-day';

export const HOLIDAY_NAMES: readonly HolidayName[] = [
  'black-friday', 'earth-day', 'st-patricks', 'workers-day',
  'new-year', 'new-year-eve', 'valentines', 'easter', 'halloween',
  'thanksgiving', 'christmas', 'christmas-eve', 'independence-day',
  'labor-day', 'memorial-day', 'mothers-day', 'fathers-day',
];

/** Current IR schema version, embedded when serializing. */
export const IR_VERSION = 1;

export const UNITS: readonly Unit[] = [
  'second',
  'minute',
  'hour',
  'day',
  'week',
  'month',
  'quarter',
  'year',
];

export const WEEKDAYS: readonly Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export const DAY_PERIODS: readonly DayPeriod[] = ['morning', 'afternoon', 'evening', 'night'];
