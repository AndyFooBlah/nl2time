/**
 * English rule set. Each rule inspects the token stream at a position and, on
 * match, emits a TimeExpr plus the number of tokens consumed. Rules are pure
 * pattern → IR translators; all resolution semantics live in the engine.
 */
import type { TimeContext } from '../context.js';
import type { DayPeriod, HolidayName, PartialTime, TimeExpr, Unit, Weekday } from '../ir/types.js';
import type { Token } from './tokenizer.js';

export interface RuleMatch {
  expr: TimeExpr;
  consumed: number;
  confidence: number;
  /** Marks results that combine with a date ("at 4pm") or a time ("yesterday"). */
  role: 'date' | 'time' | 'datetime' | 'duration';
}

export type Rule = (tokens: Token[], i: number, ctx: TimeContext) => RuleMatch | undefined;

const UNIT_WORDS: Record<string, Unit> = {
  second: 'second', seconds: 'second', sec: 'second', secs: 'second',
  minute: 'minute', minutes: 'minute', min: 'minute', mins: 'minute',
  hour: 'hour', hours: 'hour', hr: 'hour', hrs: 'hour',
  day: 'day', days: 'day',
  week: 'week', weeks: 'week', wk: 'week', wks: 'week',
  month: 'month', months: 'month', mo: 'month',
  quarter: 'quarter', quarters: 'quarter',
  year: 'year', years: 'year', yr: 'year', yrs: 'year',
  night: 'day', nights: 'day', // "two nights" as a duration
};

const WEEKDAY_WORDS: Record<string, Weekday> = {
  monday: 'mon', mon: 'mon',
  tuesday: 'tue', tue: 'tue', tues: 'tue',
  wednesday: 'wed', wed: 'wed', weds: 'wed',
  thursday: 'thu', thu: 'thu', thur: 'thu', thurs: 'thu',
  friday: 'fri', fri: 'fri',
  saturday: 'sat', sat: 'sat',
  sunday: 'sun', sun: 'sun',
};

const MONTH_WORDS: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4,
  may: 5, june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8,
  september: 9, sep: 9, sept: 9, october: 10, oct: 10,
  november: 11, nov: 11, december: 12, dec: 12,
};

const PERIOD_WORDS: Record<string, DayPeriod> = {
  morning: 'morning', mornings: 'morning',
  afternoon: 'afternoon', afternoons: 'afternoon',
  evening: 'evening', evenings: 'evening',
  night: 'night',
};

const ONES: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
  fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50 };
const FUZZY: Record<string, number> = { a: 1, an: 1, couple: 2, few: 3, some: 3, several: 3 };

const NOW: TimeExpr = { op: 'now' };

function snapNow(unit: Unit): TimeExpr {
  return { op: 'snap', base: NOW, unit };
}

function snapOffset(amount: number, unit: Unit): TimeExpr {
  return { op: 'snap', base: { op: 'offset', base: NOW, amount, unit }, unit };
}

function word(t: Token | undefined): string | undefined {
  return t?.type === 'word' ? t.value : undefined;
}

interface NumRead {
  value: number;
  consumed: number;
}

/** Digits, word numbers (incl. "twenty nine"), fuzzy quantities, decimals. */
function readNumber(tokens: Token[], i: number): NumRead | undefined {
  const t = tokens[i];
  if (t?.type === 'number') return { value: t.value, consumed: 1 };
  const w = word(t);
  if (w === undefined) return undefined;
  if (/^\d+\.\d+$/.test(w)) return { value: Number(w), consumed: 1 };
  if (w === '\u00bd') return { value: 0.5, consumed: 1 };
  if (w === '\u00bc') return { value: 0.25, consumed: 1 };
  if (w === '\u00be') return { value: 0.75, consumed: 1 };
  if (w in ONES) {
    // "two thousand [and] thirty two"
    if (word(tokens[i + 1]) === 'thousand') {
      let at = i + 2;
      let value = ONES[w]! * 1000;
      if (word(tokens[at]) === 'and') at += 1;
      const rest = word(tokens[at]);
      if (rest !== undefined && (rest in TENS || rest in ONES)) {
        const rn = readNumber(tokens, at);
        if (rn && rn.value < 1000) {
          return { value: value + rn.value, consumed: at + rn.consumed - i };
        }
      }
      return { value, consumed: 2 };
    }
    return { value: ONES[w]!, consumed: 1 };
  }
  if (w in TENS) {
    // "twenty nine" / "twenty and four"
    let at = i + 1;
    if (word(tokens[at]) === 'and') at += 1;
    const next = word(tokens[at]);
    if (next !== undefined && next in ONES && ONES[next]! < 10) {
      return { value: TENS[w]! + ONES[next]!, consumed: at + 1 - i };
    }
    return { value: TENS[w]!, consumed: 1 };
  }
  if (w in FUZZY) {
    // "a couple", "a few" — collapse the article.
    if ((w === 'a' || w === 'an') && word(tokens[i + 1]) !== undefined && word(tokens[i + 1])! in FUZZY) {
      const inner = FUZZY[word(tokens[i + 1])!]!;
      return { value: inner, consumed: 2 };
    }
    return { value: FUZZY[w]!, consumed: 1 };
  }
  return undefined;
}

function unitField(unit: Unit): string {
  return unit === 'quarter' ? 'months' : `${unit}s`;
}

/** Calendar amount for n units — quarters scale to months. */
function amountFor(unit: Unit, n: number): Record<string, number> {
  return unit === 'quarter' ? { months: 3 * n } : { [`${unit}s`]: n };
}

/** A year as digits or words ("2032", "two thousand and thirty two"). */
function readYear(tokens: Token[], i: number): NumRead | undefined {
  const y = yearAt(tokens, i);
  if (y !== undefined) return { value: y, consumed: 1 };
  const n = readNumber(tokens, i);
  if (n && Number.isInteger(n.value) && n.value >= 1500 && n.value <= 2199) return n;
  return undefined;
}

function yearAt(tokens: Token[], i: number): number | undefined {
  const t = tokens[i];
  return t?.type === 'number' && !t.ordinal && t.value >= 1000 && t.value <= 9999
    ? t.value
    : undefined;
}

/** "in the morning" / "at night" / "this morning" / "tonight" lookahead.
 * Returns period + consumed. "this <period>" binds a preceding bare hour
 * exactly like "in the <period>" ("8 this morning" → 8am): the period
 * supplies the meridiem, and the reference day is the anchor either way.
 * Deliberately NOT "last night": that also shifts the day, which a
 * meridiem-only suffix can't express (#9). */
function readPeriodSuffix(
  tokens: Token[],
  i: number,
  allowThis = true,
): { period: DayPeriod; consumed: number } | undefined {
  let at = i;
  if (word(tokens[at]) === 'in' || word(tokens[at]) === 'at') at += 1;
  if (word(tokens[at]) === 'the' || (allowThis && word(tokens[at]) === 'this')) at += 1;
  const w = word(tokens[at]);
  if (w === 'tonight') return { period: 'night', consumed: at + 1 - i };
  const period = w !== undefined ? PERIOD_WORDS[w] : undefined;
  if (period && at > i) return { period, consumed: at + 1 - i };
  return undefined;
}

function meridiemFor(period: DayPeriod): 'am' | 'pm' {
  return period === 'morning' ? 'am' : 'pm';
}

/** Words that license a following bare number as a clock time
 * ("at 8 this morning", "by 5 this afternoon"). */
const TIME_PREPOSITIONS = new Set([
  'at', 'around', 'about', 'by', 'from', 'until', 'till', 'to',
  'before', 'after', 'since',
]);

// --- rules -----------------------------------------------------------------

/** today / yesterday / tomorrow / tonight / day before yesterday / day after tomorrow */
const ruleDeicticDay: Rule = (tokens, i) => {
  const w = word(tokens[i]);
  if (w === 'today' || w === 'tdy') return { expr: snapNow('day'), consumed: 1, confidence: 1, role: 'date' };
  if (w === 'yesterday') return { expr: snapOffset(-1, 'day'), consumed: 1, confidence: 1, role: 'date' };
  if (w === 'tomorrow' || w === 'tmrw' || w === 'tmr') {
    return { expr: snapOffset(1, 'day'), consumed: 1, confidence: 1, role: 'date' };
  }
  if (w === 'tonight' || w === 'tonite') {
    return {
      expr: { op: 'intersect', parts: [snapNow('day'), { op: 'literal', dayPeriod: 'night' }] },
      consumed: 1,
      confidence: 1,
      role: 'datetime',
    };
  }
  if (w === 'day' || (w === 'the' && word(tokens[i + 1]) === 'day')) {
    const at = w === 'the' ? i + 1 : i;
    const rel = word(tokens[at + 1]);
    const target = word(tokens[at + 2]);
    if (rel === 'before' && target === 'yesterday') {
      return { expr: snapOffset(-2, 'day'), consumed: at + 3 - i, confidence: 1, role: 'date' };
    }
    if (rel === 'after' && target === 'tomorrow') {
      return { expr: snapOffset(2, 'day'), consumed: at + 3 - i, confidence: 1, role: 'date' };
    }
    // Trailing "the day after?" / "the day before" — adjacent days.
    if (rel === 'after' && target === undefined && w === 'the') {
      return { expr: snapOffset(1, 'day'), consumed: at + 2 - i, confidence: 0.8, role: 'date' };
    }
    if (rel === 'before' && target === undefined && w === 'the') {
      return { expr: snapOffset(-1, 'day'), consumed: at + 2 - i, confidence: 0.8, role: 'date' };
    }
  }
  return undefined;
};

/**
 * Ranges: [from|between]? A (to|and|until|till|through|-) B [shared suffix].
 * Ellipsis is resolved by the suffix: "between 3 and 12 of Sept" is a day
 * range in September; "5 to 6pm" shares B's meridiem; "between 5 and 6 in the
 * afternoon" infers pm for both.
 */
const ruleRange: Rule = (tokens, i, ctx) => {
  let at = i;
  const prefix = word(tokens[at]);
  const hasPrefix = prefix === 'from' || prefix === 'between';
  if (hasPrefix) at += 1;

  // Joined tokens: "4-23" (day range), "11-4" (hour range), "2014-2018".
  const joined = word(tokens[at]);
  // "10/1/2018-10/7/2018" and "5/1-5/7/2020": joined numeric-date ranges.
  const fdr =
    joined?.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})-(\d{1,2})\/(\d{1,2})\/(\d{4})$/) ??
    joined?.match(/^(\d{1,2})\/(\d{1,2})()-(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (fdr) {
    const sharedYear = Number(fdr[6]);
    const d1 = numericDate(
      fdr[3] === '' ? [Number(fdr[1]), Number(fdr[2]), sharedYear] : [Number(fdr[1]), Number(fdr[2]), Number(fdr[3])],
      ctx.dateOrder,
    );
    const d2 = numericDate([Number(fdr[4]), Number(fdr[5]), sharedYear], ctx.dateOrder);
    if (d1 && d2) {
      return {
        expr: { op: 'between', start: { op: 'literal', date: d1 }, end: { op: 'literal', date: d2 } },
        consumed: at + 1 - i,
        confidence: 0.9,
        role: 'date',
      };
    }
  }

  // Year range vs military time: leading zero or implausible values mean
  // "0730-0930" is a time range, not years.
  const looksLikeYears =
    joined !== undefined &&
    /^\d{4}[-~]\d{4}$/.test(joined) &&
    !joined.startsWith('0') &&
    Number(joined.slice(0, 4)) >= 1000 && Number(joined.slice(0, 4)) <= 2999 &&
    Number(joined.slice(5, 9)) >= 1000 && Number(joined.slice(5, 9)) <= 2999 &&
    Number(joined.slice(0, 4)) < Number(joined.slice(5, 9));

  const ym = looksLikeYears ? joined?.match(/^(\d{4})[-~](\d{4})$/) : null;
  if (ym) {
    return {
      expr: {
        op: 'between',
        start: { op: 'literal', date: { year: Number(ym[1]) } },
        end: { op: 'literal', date: { year: Number(ym[2]) } },
      },
      consumed: at + 1 - i,
      confidence: 0.9,
      role: 'date',
    };
  }
  // "0730-0930": military time range (year ranges were claimed above).
  const mil = looksLikeYears ? null : joined?.match(/^(\d{3,4})-(\d{3,4})$/);
  if (mil && Number(mil[1]) % 100 < 60 && Number(mil[2]) % 100 < 60 && Number(mil[1]) <= 2359 && Number(mil[2]) <= 2359) {
    const mkMil = (v: number): TimeExpr => {
      const hour = Math.floor(v / 100);
      return {
        op: 'literal',
        time:
          hour <= 12
            ? { hour, minute: v % 100, meridiem: 'unknown' }
            : { hour, minute: v % 100 },
      };
    };
    return {
      expr: { op: 'between', start: mkMil(Number(mil[1])), end: mkMil(Number(mil[2])) },
      consumed: at + 1 - i,
      confidence: 0.9,
      role: 'time',
    };
  }

  // "10-1-2018-10-7-2018": two joined numeric dates.
  const dd = joined?.match(/^(\d{1,2})-(\d{1,2})-(\d{4})-(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (dd) {
    const d1 = numericDate([Number(dd[1]), Number(dd[2]), Number(dd[3])], ctx.dateOrder);
    const d2 = numericDate([Number(dd[4]), Number(dd[5]), Number(dd[6])], ctx.dateOrder);
    if (d1 && d2) {
      return {
        expr: { op: 'between', start: { op: 'literal', date: d1 }, end: { op: 'literal', date: d2 } },
        consumed: at + 1 - i,
        confidence: 0.9,
        role: 'date',
      };
    }
  }

  // "10/1-11/7": joined numeric-date range.
  const ndr = joined?.match(/^(\d{1,2})\/(\d{1,2})-(\d{1,2})\/(\d{1,2})$/);
  if (ndr) {
    const d1 = numericDate([Number(ndr[1]), Number(ndr[2])], ctx.dateOrder);
    const d2 = numericDate([Number(ndr[3]), Number(ndr[4])], ctx.dateOrder);
    if (d1 && d2) {
      // "from 5/1-5/7, 2020" — trailing year applies to both ends.
      const year = yearAt(tokens, at + 1);
      if (year !== undefined) {
        d1.year = year;
        d2.year = year;
      }
      return {
        expr: {
          op: 'between',
          start: { op: 'literal', date: d1 },
          end: { op: 'literal', date: d2 },
        },
        consumed: (year !== undefined ? at + 2 : at + 1) - i,
        confidence: 0.9,
        role: 'date',
      };
    }
  }
  let a: RangeOperand | undefined;
  let b0: RangeOperand | undefined;
  let bStart: number = at;
  // "11-4", "9.30-4.30pm": joined hour(-minute) ranges.
  let jm: RegExpMatchArray | null | undefined = joined?.match(
    /^(\d{1,2})(?:[.:](\d{2}))?(am|pm)?-(\d{1,2})(?:[.:](\d{2}))?(am|pm)?$/,
  );
  if (jm) {
    const [, h1, m1, mer1, h2, m2, mer2] = jm;
    const timey = m1 !== undefined || m2 !== undefined || mer1 !== undefined || mer2 !== undefined;
    const hoursOk = Number(h1) <= 12 && Number(h2) <= 12;
    const mkTime = (h: string, m: string | undefined, mer: string | undefined): RangeOperand => ({
      kind: 'time',
      time: {
        hour: Number(h),
        ...(m !== undefined ? { minute: Number(m) } : {}),
        meridiem: (mer as 'am' | 'pm' | undefined) ?? 'unknown',
      },
    });
    if (hoursOk && (timey || !hasPrefix)) {
      // "11-4", "9.30-4.30pm" → hour range.
      a = mkTime(h1!, m1, mer1);
      b0 = mkTime(h2!, m2, mer2);
    } else if (hasPrefix && !timey && Number(h1) <= 31 && Number(h2) <= 31) {
      // "from 4-23 …" → day-number pair (scope decides day vs time).
      a = { kind: 'number', value: Number(h1) };
      b0 = { kind: 'number', value: Number(h2) };
    } else {
      jm = null;
    }
    bStart = at;
  }
  let connWord: string | undefined;
  if (!jm) {
    const read = readOperand(tokens, at, ctx);
    if (!read) return undefined;
    a = read.operand;
    at += read.consumed;
    const conn = word(tokens[at]);
    connWord = conn;
    const isConn =
      conn === 'to' || conn === 'until' || conn === 'till' || conn === 'through' || conn === 'thru' ||
      conn === '-' || (conn === 'and' && prefix === 'between');
    if (!isConn) return undefined;
    bStart = at + 1;
  }

  let b: RangeOperand;
  let afterB: number;
  if (jm && b0 && a) {
    b = b0;
    afterB = at + 1;
    // Share B's meridiem with A only when A precedes B within the same half
    // of the day ("5-6pm" → 5pm; "9.30-4.30pm" crosses noon → 9:30am).
    if (
      a.kind === 'time' && b.kind === 'time' &&
      a.time.meridiem === 'unknown' && b.time.meridiem && b.time.meridiem !== 'unknown' &&
      (a.time.hour ?? 0) < (b.time.hour ?? 0)
    ) {
      a = { kind: 'time', time: { ...a.time, meridiem: b.time.meridiem } };
    }
  } else {
    const read = readOperand(tokens, bStart, ctx);
    if (!read || !a) return undefined;
    b = read.operand;
    afterB = bStart + read.consumed;
  }

  // Shared suffix: a date scope ("of Sept", "in next month", "on 1/1/2015",
  // "of April 22") or a day-period ("in the afternoon").
  let scope: TimeExpr | undefined;
  let period: DayPeriod | undefined;
  let end = afterB;
  const ps = readPeriodSuffix(tokens, afterB);
  if (ps) {
    period = ps.period;
    end = afterB + ps.consumed;
  } else {
    let sAt = afterB;
    const lead = word(tokens[sAt]);
    if (lead === 'of' || lead === 'in' || lead === 'on') sAt += 1;
    // A bare year suffix ("26 june to 28 june in 2020") rewrites both ends.
    const suffixYear = yearAt(tokens, sAt);
    if (suffixYear !== undefined) {
      const applyYear = (o: RangeOperand): RangeOperand =>
        o.kind === 'date' && o.expr.op === 'literal' && o.expr.date !== undefined
          ? { kind: 'date', expr: { ...o.expr, date: { ...o.expr.date, year: suffixYear } } }
          : o;
      a = applyYear(a);
      b = applyYear(b);
      end = sAt + 1;
    } else {
      for (const rule of [ruleLastThisNext, ruleDeicticDay, ruleCalendarDate]) {
        const m = rule(tokens, sAt, ctx);
        if (m && m.role === 'date') {
          scope = m.expr;
          end = sAt + m.consumed;
          break;
        }
      }
    }
  }

  const expr = buildRange(a, b, scope, period, connWord);
  if (!expr) return undefined;
  // Unprefixed spelled-out number pairs need an explicit "to"/"-" connector
  // (joined tokens like "11-4" are already explicit ranges).
  if (!hasPrefix && !jm && a.kind === 'number' && b.kind === 'number' && !period && !scope) {
    const conn = word(tokens[i + (a.kind === 'number' ? 1 : 0)]);
    if (conn !== 'to' && conn !== '-') return undefined;
  }
  return { expr, consumed: end - i, confidence: 0.95, role: rangeRole(a, b) };
};

type RangeOperand =
  | { kind: 'number'; value: number }
  | { kind: 'time'; time: PartialTime }
  | { kind: 'date'; expr: TimeExpr };

function readOperand(
  tokens: Token[],
  i: number,
  ctx: TimeContext,
): { operand: RangeOperand; consumed: number } | undefined {
  // "between the end of 2007 and the end of 2008" — inside a range, "end of
  // YEAR" means the year's end boundary (a point), not its final third.
  const w0 = word(tokens[i]);
  if ((w0 === 'end' || w0 === 'beginning' || w0 === 'start') && word(tokens[i + 1]) === 'of') {
    let yAt = i + 2;
    if (word(tokens[yAt]) === 'the') yAt += 1;
    const year = yearAt(tokens, yAt);
    if (year !== undefined) {
      return {
        operand: {
          kind: 'date',
          expr: {
            op: 'snap',
            base: { op: 'literal', date: { year } },
            unit: 'year',
            edge: w0 === 'end' ? 'end' : 'start',
          },
        },
        consumed: yAt + 1 - i,
      };
    }
  }
  const rel = ruleLastThisNext(tokens, i, ctx);
  if (rel && rel.role === 'date') {
    // "this friday 5/12": an explicit date after the weekday supersedes it.
    if (rel.expr.op === 'seek' && rel.expr.target.kind === 'weekday') {
      const refine = ruleCalendarDate(tokens, i + rel.consumed, ctx);
      if (refine && refine.expr.op === 'literal' && refine.expr.date?.day !== undefined) {
        return { operand: { kind: 'date', expr: refine.expr }, consumed: rel.consumed + refine.consumed };
      }
    }
    return { operand: { kind: 'date', expr: rel.expr }, consumed: rel.consumed };
  }
  const date = ruleCalendarDate(tokens, i, ctx);
  if (date) return { operand: { kind: 'date', expr: date.expr }, consumed: date.consumed };
  const clock = ruleClockTime(tokens, i, ctx);
  if (clock && clock.expr.op === 'literal' && clock.expr.time) {
    return { operand: { kind: 'time', time: clock.expr.time }, consumed: clock.consumed };
  }
  const year = yearAt(tokens, i);
  if (year !== undefined) {
    return { operand: { kind: 'date', expr: { op: 'literal', date: { year } } }, consumed: 1 };
  }
  const n = readNumber(tokens, i);
  if (n && Number.isInteger(n.value) && n.value >= 1 && n.value <= 31) {
    return { operand: { kind: 'number', value: n.value }, consumed: n.consumed };
  }
  const deictic = ruleDeicticDay(tokens, i, ctx);
  if (deictic) return { operand: { kind: 'date', expr: deictic.expr }, consumed: deictic.consumed };
  const wd = WEEKDAY_WORDS[word(tokens[i]) ?? ''];
  if (wd && word(tokens[i])!.length > 5) {
    return {
      operand: {
        kind: 'date',
        expr: { op: 'seek', base: NOW, dir: 'nearest', target: { kind: 'weekday', weekday: wd } },
      },
      consumed: 1,
    };
  }
  if (word(tokens[i]) === 'now') {
    // In a date range, "now" means today ("between now and November 15th").
    return {
      operand: { kind: 'date', expr: { op: 'snap', base: NOW, unit: 'day', edge: 'start' } },
      consumed: 1,
    };
  }
  return undefined;
}

function rangeRole(a: RangeOperand, b: RangeOperand): 'date' | 'time' | 'datetime' {
  if (a.kind === 'time' || b.kind === 'time') return 'time';
  if (a.kind === 'date' || b.kind === 'date') return 'date';
  return 'time';
}

/** A scope naming a specific day (vs a month/year) turns number pairs into time ranges. */
function scopeIsDaySized(expr: TimeExpr): boolean {
  if (expr.op === 'literal') return expr.date?.day !== undefined;
  if (expr.op === 'snap') return expr.unit === 'day';
  if (expr.op === 'seek') return expr.target.kind === 'weekday';
  if (expr.op === 'intersect') return expr.parts.some(scopeIsDaySized);
  return false;
}

function buildRange(
  a: RangeOperand,
  b: RangeOperand,
  scope: TimeExpr | undefined,
  period: DayPeriod | undefined,
  connWord?: string,
): TimeExpr | undefined {
  // Day range: numbers scoped by a month/year ("between 3 and 12 of Sept"),
  // or numbers too large to be clock hours. Numbers scoped by a specific DAY
  // ("between 3 and 5 on 1/1/2015", "five to seven today") are clock times.
  const dayRange =
    a.kind === 'number' &&
    b.kind === 'number' &&
    ((scope !== undefined && !scopeIsDaySized(scope)) ||
      (scope === undefined && (a.value > 12 || b.value > 12)));
  if (dayRange && a.kind === 'number' && b.kind === 'number') {
    const between: TimeExpr = {
      op: 'between',
      start: { op: 'literal', date: { day: a.value } },
      end: { op: 'literal', date: { day: b.value } },
    };
    return scope ? { op: 'intersect', parts: [scope, between] } : between;
  }

  const toTime = (o: RangeOperand): PartialTime | undefined => {
    if (o.kind === 'time') return { ...o.time };
    if (o.kind === 'number' && o.value >= 1 && o.value <= 12) {
      return { hour: o.value, meridiem: 'unknown' };
    }
    return undefined;
  };

  if (a.kind !== 'date' && b.kind !== 'date') {
    const ta = toTime(a);
    const tb = toTime(b);
    if (!ta || !tb) return undefined;
    if (period) {
      const m = meridiemFor(period);
      if (ta.meridiem === 'unknown' || ta.meridiem === undefined) ta.meridiem = m;
      if (tb.meridiem === 'unknown' || tb.meridiem === undefined) tb.meridiem = m;
    } else if (
      ta.meridiem === 'unknown' && tb.meridiem && tb.meridiem !== 'unknown' &&
      (ta.hour ?? 0) < (tb.hour ?? 0)
    ) {
      ta.meridiem = tb.meridiem; // "5 to 6pm" (but "9.30 to 4.30pm" crosses noon)
    }
    const between: TimeExpr = {
      op: 'between',
      start: { op: 'literal', time: ta },
      end: { op: 'literal', time: tb },
    };
    return scope ? { op: 'intersect', parts: [scope, between] } : between;
  }

  if (a.kind === 'date' && b.kind === 'date') {
    // "previous week - Monday": a weekday after a week names the day within it.
    if (
      a.expr.op === 'snap' && a.expr.unit === 'week' &&
      b.expr.op === 'seek' && b.expr.target.kind === 'weekday'
    ) {
      return { op: 'seek', base: a.expr, dir: 'next', target: b.expr.target, n: 1 };
    }
    // Past deictic ends are inclusive: "…to yesterday" runs through
    // yesterday ("…to today/tomorrow" stays exclusive at that day's start).
    if (
      b.expr.op === 'snap' && b.expr.unit === 'day' && b.expr.edge === undefined &&
      b.expr.base.op === 'offset' && b.expr.base.amount < 0
    ) {
      b = { kind: 'date', expr: { op: 'snap', base: b.expr, unit: 'day', edge: 'end' } };
    }
    // "Friday-Jun-15": a dash-annotated weekday is redundant next to a full
    // date — but "from Friday to Jun 15" is a genuine range.
    if (
      connWord === '-' &&
      a.expr.op === 'seek' && a.expr.target.kind === 'weekday' &&
      b.expr.op === 'literal' && b.expr.date?.day !== undefined
    ) {
      return b.expr;
    }
    // Year back-propagation: "Nov 18 - Dec 19, 2015", "Nov - Feb 2017".
    let start = a.expr;
    if (
      a.expr.op === 'literal' && b.expr.op === 'literal' &&
      a.expr.date?.month !== undefined && a.expr.date.year === undefined &&
      b.expr.date?.month !== undefined && b.expr.date.year !== undefined
    ) {
      const year =
        a.expr.date.month > b.expr.date.month ? b.expr.date.year - 1 : b.expr.date.year;
      start = { ...a.expr, date: { ...a.expr.date, year } };
    }
    return { op: 'between', start, end: b.expr };
  }
  // Mixed date/number: "May 2 to 7".
  if (a.kind === 'date' && b.kind === 'number') {
    return { op: 'between', start: a.expr, end: { op: 'literal', date: { day: b.value } } };
  }
  // "between 3 and 12 of Sept": B swallowed the month — reuse it as scope.
  if (a.kind === 'number' && b.kind === 'date' && b.expr.op === 'literal' && b.expr.date?.day !== undefined && b.expr.date.month !== undefined) {
    const monthScope: TimeExpr = {
      op: 'literal',
      date: {
        month: b.expr.date.month,
        ...(b.expr.date.year !== undefined ? { year: b.expr.date.year } : {}),
      },
    };
    return {
      op: 'intersect',
      parts: [
        monthScope,
        {
          op: 'between',
          start: { op: 'literal', date: { day: a.value } },
          end: { op: 'literal', date: { day: b.expr.date.day } },
        },
      ],
    };
  }
  return undefined;
}

/**
 * Open-range connectors (#18): "since X" → [start(X), now]; "until X" /
 * "till X" / "through X" / "up to X" / "by X" (deadline) → [now, end(X)].
 * These only fire when the connector opens the range — "A until B" and
 * "from A through B" are consumed earlier by the range rule.
 */
const ruleOpenRange: Rule = (tokens, i, ctx) => {
  const w = word(tokens[i]);
  let mode: 'since' | 'until' | undefined;
  let at = i + 1;
  if (w === 'since') mode = 'since';
  else if (w === 'until' || w === 'till' || w === 'through' || w === 'thru' || w === 'by') {
    mode = 'until';
  } else if (w === 'up' && word(tokens[i + 1]) === 'to') {
    mode = 'until';
    at = i + 2;
  }
  if (!mode) return undefined;
  // "by the 15th": a bare article only before an explicit calendar date —
  // NOT "through the week"-style prose, which stays unmatched.
  if (word(tokens[at]) === 'the' && ruleCalendarDate(tokens, at + 1, ctx)) at += 1;
  const inner =
    ruleDeicticDay(tokens, at, ctx) ??
    ruleLastThisNext(tokens, at, ctx) ??
    ruleHoliday(tokens, at, ctx) ??
    ruleEndOf(tokens, at, ctx) ??
    ruleWeekOf(tokens, at, ctx) ??
    ruleBareYear(tokens, at, ctx) ??
    ruleCalendarDate(tokens, at, ctx) ??
    ruleClockTime(tokens, at, ctx) ??
    ruleWeekdayAlone(tokens, at, ctx);
  if (!inner || inner.role === 'duration') return undefined;
  // Boundary points ("by EOD", "by the end of the month") keep their point
  // reading — the deadline instant is the answer there, not a range.
  if (inner.expr.op === 'snap' && inner.expr.edge !== undefined) return undefined;
  const expr: TimeExpr =
    mode === 'since'
      ? { op: 'between', start: inner.expr, end: NOW }
      : { op: 'between', start: NOW, end: inner.expr };
  return { expr, consumed: at + inner.consumed - i, confidence: 0.9, role: 'datetime' };
};

/** "week of April 10th", "the first/last week of July", "the week starting on Feb 4". */
const ruleWeekOf: Rule = (tokens, i, ctx) => {
  let at = i;
  if (word(tokens[at]) === 'the') at += 1;

  // "w/c Feb 4" (week commencing)
  if (word(tokens[at]) === 'w/c' || word(tokens[at]) === 'wc') {
    const date = ruleCalendarDate(tokens, at + 1, ctx);
    if (date && date.role === 'date') {
      return {
        expr: { op: 'snap', base: date.expr, unit: 'week' },
        consumed: at + 1 + date.consumed - i,
        confidence: 0.95,
        role: 'date',
      };
    }
  }

  // "the week starting/beginning/commencing [on] <date>"
  if (word(tokens[at]) === 'week' && ['starting', 'beginning', 'commencing'].includes(word(tokens[at + 1]) ?? '')) {
    let dAt = at + 2;
    if (word(tokens[dAt]) === 'on' || word(tokens[dAt]) === 'from') dAt += 1;
    const date = ruleCalendarDate(tokens, dAt, ctx) ?? ruleDeicticDay(tokens, dAt, ctx);
    if (date && date.role === 'date') {
      return {
        expr: { op: 'snap', base: date.expr, unit: 'week' },
        consumed: dAt + date.consumed - i,
        confidence: 1,
        role: 'date',
      };
    }
    return undefined;
  }
  let nth: 'first' | 'last' | number | undefined;
  const nw = word(tokens[at]);
  const nt = tokens[at];
  if (nw === 'first') { nth = 'first'; at += 1; }
  else if (nw === 'last') { nth = 'last'; at += 1; }
  else if (nw === 'second') { nth = 2; at += 1; }
  else if (nw === 'third') { nth = 3; at += 1; }
  else if (nt?.type === 'number' && nt.ordinal && nt.value <= 5) { nth = nt.value; at += 1; }
  if (word(tokens[at]) !== 'week' || word(tokens[at + 1]) !== 'of') return undefined;
  at += 2;
  if (word(tokens[at]) === 'the') at += 1;

  // Scope: a date, a month, or a year.
  let scope: TimeExpr | undefined;
  let consumed = 0;
  const year = yearAt(tokens, at);
  const date = ruleCalendarDate(tokens, at, ctx);
  if (date) {
    scope = date.expr;
    consumed = date.consumed;
  } else if (year !== undefined) {
    scope = { op: 'literal', date: { year } };
    consumed = 1;
  } else {
    const rel = ruleLastThisNext(tokens, at, ctx) ?? ruleDeicticDay(tokens, at, ctx);
    if (!rel) return undefined;
    scope = rel.expr;
    consumed = rel.consumed;
  }

  let expr: TimeExpr;
  if (nth === undefined) {
    expr = { op: 'snap', base: scope, unit: 'week' };
  } else if (nth === 'last') {
    // Last week mostly within the scope: the week containing (end − 4 days) —
    // the ISO minDays-4 idea. A week needs ≥4 of its days inside the period
    // to be its last week.
    expr = {
      op: 'snap',
      base: {
        op: 'offset',
        base: { op: 'snap', base: scope, unit: monthOrYearUnit(scope), edge: 'end' },
        amount: -4,
        unit: 'day',
      },
      unit: 'week',
    };
  } else {
    const n = nth === 'first' ? 1 : nth;
    const first: TimeExpr = {
      op: 'snap',
      base: { op: 'snap', base: scope, unit: monthOrYearUnit(scope), edge: 'start' },
      unit: 'week',
    };
    expr = n === 1 ? first : { op: 'offset', base: first, amount: n - 1, unit: 'week' };
  }
  return { expr, consumed: at + consumed - i, confidence: 1, role: 'date' };
};

function monthOrYearUnit(scope: TimeExpr): Unit {
  if (scope.op === 'literal' && scope.date && scope.date.month === undefined) return 'year';
  return 'month';
}

/** "early/earlier/later/late (in) (the) day|this week|this month|today…" → half-splits. */
const ruleEarlyLate: Rule = (tokens, i, ctx) => {
  const w = word(tokens[i]);
  const isEarly = w === 'early' || w === 'earlier';
  const isLate = w === 'later' || w === 'late';
  const isMid = w === 'mid' || w === 'middle';
  // "mid-November", "mid-june" as one token
  const midJoined = w?.match(/^mid-?([a-z]+)$/);
  if (midJoined && MONTH_WORDS[midJoined[1]!] !== undefined) {
    return {
      expr: { op: 'literal', date: { month: MONTH_WORDS[midJoined[1]!]! }, mod: 'mid' },
      consumed: 1,
      confidence: 0.95,
      role: 'date',
    };
  }
  if (!isEarly && !isLate && !isMid) return undefined;
  const mod = isMid ? 'mid' : isEarly ? 'start' : 'end';
  let at = i + 1;
  if (word(tokens[at]) === 'in') at += 1;
  if (word(tokens[at]) === 'of') at += 1;
  if (word(tokens[at]) === 'the') at += 1;
  // "mid today", "mid November", "mid 1989"
  if (isMid) {
    const month = MONTH_WORDS[word(tokens[at]) ?? ''];
    if (month !== undefined) {
      return {
        expr: { op: 'literal', date: { month }, mod: 'mid' },
        consumed: at + 1 - i,
        confidence: 0.95,
        role: 'date',
      };
    }
    const midYear = yearAt(tokens, at);
    if (midYear !== undefined) {
      return {
        expr: {
          op: 'span',
          anchor: { op: 'literal', date: { year: midYear, month: 5 } },
          amount: { months: 4 },
        },
        consumed: at + 1 - i,
        confidence: 0.95,
        role: 'date',
      };
    }
  }

  let base: TimeExpr | undefined;
  let consumed = 0;
  const unitWord = word(tokens[at]);
  const period = unitWord !== undefined ? PERIOD_WORDS[unitWord] : undefined;
  const bareUnit =
    unitWord !== undefined && unitWord !== 'day' && unitWord !== 'night'
      ? UNIT_WORDS[unitWord]
      : undefined;
  if (period) {
    // "late afternoon", "later in the afternoon" → half of the period.
    return {
      expr: {
        op: 'intersect',
        parts: [snapNow('day'), { op: 'literal', dayPeriod: period }],
        mod,
      },
      consumed: at + 1 - i,
      confidence: 0.95,
      role: 'datetime',
    };
  }
  if (bareUnit && bareUnit !== 'second' && bareUnit !== 'minute' && bareUnit !== 'hour') {
    // "earlier in the week", "later in the year"
    base = snapNow(bareUnit);
    consumed = 1;
  } else if (word(tokens[at]) === 'day') {
    // "early in the day Wednesday" — an optional following weekday rebinds the day.
    const wd = WEEKDAY_WORDS[word(tokens[at + 1]) ?? ''];
    if (wd) {
      base = { op: 'seek', base: NOW, dir: 'nearest', target: { kind: 'weekday', weekday: wd } };
      consumed = 2;
    } else {
      base = snapNow('day');
      consumed = 1;
    }
  } else {
    const inner =
      ruleDeicticDay(tokens, at, ctx) ?? ruleLastThisNext(tokens, at, ctx);
    if (!inner || (inner.role !== 'date' && inner.role !== 'datetime')) return undefined;
    base = inner.expr;
    consumed = inner.consumed;
  }
  return {
    expr: { ...base, mod },
    consumed: at + consumed - i,
    confidence: 0.95,
    role: 'date',
  };
};

/** "end of this sunday", "beginning of next month", "the middle of 2000". */
const ruleEndOf: Rule = (tokens, i, ctx) => {
  const w = word(tokens[i]);
  const isEnd = w === 'end';
  const isStart = w === 'beginning' || w === 'start';
  const isMid = w === 'middle';
  if (!isEnd && !isStart && !isMid) return undefined;
  if (word(tokens[i + 1]) !== 'of') return undefined;
  let at = i + 2;
  if (word(tokens[at]) === 'the') at += 1;
  // "end of the sunday": end-of-day points on the (ambiguous) weekday.
  const edgeWd = WEEKDAY_WORDS[word(tokens[at]) ?? ''];
  if (edgeWd && (isEnd || isStart)) {
    return {
      expr: {
        op: 'snap',
        base: { op: 'seek', base: NOW, dir: 'nearest', target: { kind: 'weekday', weekday: edgeWd } },
        unit: 'day',
        edge: isEnd ? 'end' : 'start',
      },
      consumed: at + 1 - i,
      confidence: 0.9,
      role: 'date',
    };
  }

  // Bare units: "end of day" (a point), "end of month/year/week" (late part
  // as a fixed split: week from +3d, month from the 16th, year from July —
  // deliberately NOT reference-clamped, unlike "later this month").
  const bareUnit = UNIT_WORDS[word(tokens[at]) ?? ''];
  if (bareUnit && word(tokens[at]) !== 'night') {
    if (bareUnit === 'day') {
      return {
        expr: { op: 'snap', base: snapNow('day'), unit: 'day', edge: isEnd ? 'end' : 'start' },
        consumed: at + 1 - i,
        confidence: 0.9,
        role: 'time',
      };
    }
    if (bareUnit === 'week' || bareUnit === 'month' || bareUnit === 'year' || bareUnit === 'quarter') {
      const startPoint: TimeExpr = { op: 'snap', base: NOW, unit: bareUnit, edge: 'start' };
      const endPoint: TimeExpr = { op: 'snap', base: NOW, unit: bareUnit, edge: 'end' };
      const midOffset: TimeExpr =
        bareUnit === 'week'
          ? { op: 'offset', base: startPoint, amount: 3, unit: 'day' }
          : bareUnit === 'month'
            ? { op: 'offset', base: startPoint, amount: 15, unit: 'day' }
            : bareUnit === 'year'
              ? { op: 'offset', base: startPoint, amount: 6, unit: 'month' }
              : { op: 'offset', base: startPoint, amount: 45, unit: 'day' };
      const expr2: TimeExpr = isEnd
        ? { op: 'between', start: midOffset, end: endPoint }
        : { op: 'between', start: startPoint, end: midOffset };
      return { expr: expr2, consumed: at + 1 - i, confidence: 0.9, role: 'date' };
    }
  }

  const inner =
    ruleDeicticDay(tokens, at, ctx) ??
    ruleLastThisNext(tokens, at, ctx) ??
    ruleBareYear(tokens, at, ctx) ??
    ruleCalendarDate(tokens, at, ctx);
  if (!inner || inner.role !== 'date') return undefined;

  // Year scopes split into thirds: beginning = Jan–Apr, middle = May–Aug,
  // end = Sep–Dec (Recognizers convention).
  if (inner.expr.op === 'literal' && inner.expr.date?.year !== undefined && inner.expr.date.month === undefined) {
    const year = inner.expr.date.year;
    const startMonth = isStart ? 1 : isMid ? 5 : 9;
    return {
      expr: {
        op: 'span',
        anchor: { op: 'literal', date: { year, month: startMonth } },
        amount: { months: 4 },
      },
      consumed: at + inner.consumed - i,
      confidence: 0.95,
      role: 'date',
    };
  }

  const dayScoped =
    inner.expr.op === 'seek' ||
    (inner.expr.op === 'snap' && inner.expr.unit === 'day') ||
    (inner.expr.op === 'literal' && inner.expr.date?.day !== undefined);
  const expr: TimeExpr = dayScoped
    ? { op: 'snap', base: inner.expr, unit: 'day', edge: isEnd ? 'end' : 'start' }
    : { ...inner.expr, mod: isEnd ? 'end' : isMid ? 'mid' : 'start' };
  return { expr, consumed: at + inner.consumed - i, confidence: 0.95, role: 'date' };
};

const REL_SYNONYMS: Record<string, 'last' | 'this' | 'next'> = {
  last: 'last', previous: 'last', prior: 'last',
  this: 'this', current: 'this', present: 'this', that: 'this',
  next: 'next', coming: 'next', upcoming: 'next', following: 'next',
};

function weekendExpr(dir: 'next' | 'prev' | 'nearest'): TimeExpr {
  // Weekend = Saturday 00:00 → Monday 00:00.
  return {
    op: 'span',
    anchor: { op: 'seek', base: NOW, dir, target: { kind: 'weekday', weekday: 'sat' } },
    amount: { days: 2 },
  };
}

/** last/this/next (+synonyms) + unit | weekday | weekend | day-period | month name. */
const ruleLastThisNext: Rule = (tokens, i, ctx) => {
  const w = REL_SYNONYMS[word(tokens[i]) ?? ''];
  if (w === undefined) return undefined;
  // "this calendar year" — 'calendar' is transparent.
  const skip = word(tokens[i + 1]) === 'calendar' ? 1 : 0;
  const nextWord = word(tokens[i + 1 + skip]);
  if (nextWord === undefined) {
    // "this 5/12" / "next 5/19" (numdate token follows).
    const dated = ruleCalendarDate(tokens, i + 1, ctx);
    if (dated && dated.expr.op === 'literal' && dated.expr.date?.day !== undefined && dated.expr.date.year === undefined) {
      const expr2: TimeExpr =
        w === 'this'
          ? dated.expr
          : { op: 'offset', base: dated.expr, amount: w === 'next' ? 1 : -1, unit: 'year' };
      return { expr: expr2, consumed: 1 + dated.consumed, confidence: 0.95, role: 'date' };
    }
    return undefined;
  }
  if (skip) {
    const unit = UNIT_WORDS[nextWord];
    if (unit && unit !== 'day') {
      const delta = w === 'last' ? -1 : w === 'next' ? 1 : 0;
      const expr = delta === 0 ? snapNow(unit) : snapOffset(delta, unit);
      return { expr, consumed: 3, confidence: 1, role: 'date' };
    }
    return undefined;
  }

  if (nextWord === 'weekend') {
    const dir = w === 'last' ? 'prev' : w === 'next' ? 'next' : 'nearest';
    return { expr: weekendExpr(dir), consumed: 2, confidence: 1, role: 'date' };
  }

  if (nextWord === 'workweek' || ((nextWord === 'work' || nextWord === 'working') && word(tokens[i + 2]) === 'week')) {
    // Monday 00:00 → Saturday 00:00 of the relevant week.
    const delta = w === 'last' ? -1 : w === 'next' ? 1 : 0;
    const weekExpr = delta === 0 ? snapNow('week') : snapOffset(delta, 'week');
    return {
      expr: {
        op: 'span',
        anchor: { op: 'snap', base: weekExpr, unit: 'week', edge: 'start' },
        amount: { days: 5 },
      },
      consumed: nextWord === 'workweek' ? 2 : 3,
      confidence: 1,
      role: 'date',
    };
  }

  const unit = UNIT_WORDS[nextWord];
  if (unit && nextWord !== 'night' && nextWord !== 'nights') {
    const delta = w === 'last' ? -1 : w === 'next' ? 1 : 0;
    // Sub-day units are rolling windows ("next hour" = the coming 60 min).
    if (unit === 'second' || unit === 'minute' || unit === 'hour') {
      if (delta === 0) return { expr: snapNow(unit), consumed: 2, confidence: 1, role: 'datetime' };
      return {
        expr: { op: 'span', anchor: NOW, amount: amountFor(unit, delta) },
        consumed: 2,
        confidence: 1,
        role: 'datetime',
      };
    }
    const expr = delta === 0 ? snapNow(unit) : snapOffset(delta, unit);
    return { expr, consumed: 2, confidence: 1, role: 'date' };
  }

  const weekday = WEEKDAY_WORDS[nextWord];
  if (weekday) {
    const dir = w === 'last' ? 'prev' : w === 'next' ? 'next' : 'nearest';
    // Only the literal words "next"/"last" carry the dialect ambiguity;
    // "upcoming Friday" is strictly the adjacent occurrence (n: 1).
    const literalWord = word(tokens[i]);
    const strict = (literalWord === 'upcoming' || literalWord === 'coming') && dir !== 'nearest';
    return {
      expr: {
        op: 'seek',
        base: NOW,
        dir,
        target: { kind: 'weekday', weekday },
        ...(strict ? { n: 1 } : {}),
      },
      consumed: 2,
      confidence: 1,
      role: 'date',
    };
  }

  if (nextWord === 'fortnight') {
    // "the next fortnight" = the two whole weeks after the current one.
    const weekDelta = w === 'last' ? -2 : w === 'next' ? 2 : 0;
    return {
      expr: {
        op: 'span',
        anchor: {
          op: 'snap',
          base: { op: 'offset', base: NOW, amount: weekDelta, unit: 'week' },
          unit: 'week',
          edge: 'start',
        },
        amount: { days: 14 },
      },
      consumed: 2,
      confidence: 0.95,
      role: 'date',
    };
  }

  const period = PERIOD_WORDS[nextWord];
  if (period) {
    const dayExpr =
      w === 'last' ? snapOffset(-1, 'day') : w === 'next' ? snapOffset(1, 'day') : snapNow('day');
    return {
      expr: { op: 'intersect', parts: [dayExpr, { op: 'literal', dayPeriod: period }] },
      consumed: 2,
      confidence: 1,
      role: 'datetime',
    };
  }

  const month = MONTH_WORDS[nextWord];
  if (month !== undefined) {
    const dir = w === 'last' ? 'prev' : w === 'next' ? 'next' : 'nearest';
    return {
      expr: { op: 'seek', base: NOW, dir, target: { kind: 'month', month } },
      consumed: 2,
      confidence: 1,
      role: 'date',
    };
  }

  // "this 5/12" / "next 5/19": a dated literal shifted by a year for next/last.
  const dated = ruleCalendarDate(tokens, i + 1, ctx);
  if (dated && dated.expr.op === 'literal' && dated.expr.date?.day !== undefined && dated.expr.date.year === undefined) {
    const expr: TimeExpr =
      w === 'this'
        ? dated.expr
        : { op: 'offset', base: dated.expr, amount: w === 'next' ? 1 : -1, unit: 'year' };
    return { expr, consumed: 1 + dated.consumed, confidence: 0.95, role: 'date' };
  }
  return undefined;
};

/** "N units ago" / "in N units" — day-and-coarser results snap to the day. */
const ruleAgoIn: Rule = (tokens, i) => {
  const w = word(tokens[i]);

  const mkExpr = (n: number, unit: Unit, sign: 1 | -1): TimeExpr => {
    const shifted: TimeExpr = { op: 'offset', base: NOW, amount: sign * n, unit };
    const coarse = unit !== 'second' && unit !== 'minute' && unit !== 'hour';
    return coarse ? { op: 'snap', base: shifted, unit: 'day' } : shifted;
  };

  if (w === 'in') {
    // "in half an hour"
    if (word(tokens[i + 1]) === 'half' && (word(tokens[i + 2]) === 'an' || word(tokens[i + 2]) === 'a')) {
      const hUnit = UNIT_WORDS[word(tokens[i + 3]) ?? ''];
      if (hUnit === 'hour') {
        return {
          expr: { op: 'offset', base: NOW, amount: 30, unit: 'minute' },
          consumed: 4,
          confidence: 1,
          role: 'datetime',
        };
      }
    }
    // "in a fortnight['s time]"
    if (word(tokens[i + 1]) === 'a' && word(tokens[i + 2]) === 'fortnight') {
      const extra = word(tokens[i + 3]) === 'time' ? 4 : 3;
      return { expr: mkExpr(14, 'day', 1), consumed: extra, confidence: 1, role: 'date' };
    }
    const n = readNumber(tokens, i + 1);
    if (!n || !Number.isInteger(n.value)) return undefined;
    const unit = UNIT_WORDS[word(tokens[i + 1 + n.consumed]) ?? ''];
    if (unit) {
      // "in two years since 2011" belongs to the anchored-offset rule.
      const after = word(tokens[i + 2 + n.consumed]);
      if (after === 'since' || after === 'after' || after === 'from') return undefined;
      return { expr: mkExpr(n.value, unit, 1), consumed: 2 + n.consumed, confidence: 1, role: 'datetime' };
    }
    return undefined;
  }

  const n = readNumber(tokens, i);
  if (!n || !Number.isInteger(n.value)) return undefined;
  const unit = UNIT_WORDS[word(tokens[i + n.consumed]) ?? ''];
  const tail = word(tokens[i + n.consumed + 1]);
  if (unit && (tail === 'ago' || tail === 'earlier' || tail === 'before')) {
    return { expr: mkExpr(n.value, unit, -1), consumed: n.consumed + 2, confidence: 1, role: 'datetime' };
  }
  if (unit && tail === 'later') {
    return { expr: mkExpr(n.value, unit, 1), consumed: n.consumed + 2, confidence: 1, role: 'datetime' };
  }
  return undefined;
};

/** "N units after/before <date>": offset; "within N units after X": span. */
const ruleNAfterDate: Rule = (tokens, i, ctx) => {
  let at = i;
  let spanMode = false;
  const lead = word(tokens[at]);
  if (lead === 'within') { spanMode = true; at += 1; }
  else if (lead === 'less' && word(tokens[at + 1]) === 'than') { spanMode = true; at += 2; }

  const n = readNumber(tokens, at);
  if (!n || !Number.isInteger(n.value)) return undefined;
  const unit = UNIT_WORDS[word(tokens[at + n.consumed]) ?? ''];
  if (!unit) return undefined;
  const dirWord = word(tokens[at + n.consumed + 1]);
  if (dirWord !== 'after' && dirWord !== 'before' && dirWord !== 'from' && dirWord !== 'since') return undefined;
  const dAt = at + n.consumed + 2;
  const inner =
    ruleDeicticDay(tokens, dAt, ctx) ??
    ruleNow(tokens, dAt, ctx) ??
    ruleLastThisNext(tokens, dAt, ctx) ??
    ruleHoliday(tokens, dAt, ctx) ??
    ruleTheUnit(tokens, dAt, ctx) ??
    ruleBareYear(tokens, dAt, ctx) ??
    ruleCalendarDate(tokens, dAt, ctx);
  if (!inner) return undefined;
  const sign = dirWord === 'before' ? -1 : 1;
  const subDay = unit === 'second' || unit === 'minute' || unit === 'hour';
  const offset: TimeExpr = { op: 'offset', base: inner.expr, amount: sign * n.value, unit };
  const expr: TimeExpr = spanMode
    ? { op: 'span', anchor: inner.expr, amount: amountFor(unit, sign * n.value) }
    : subDay
      ? offset
      : { op: 'snap', base: offset, unit: 'day' };
  return { expr, consumed: dAt + inner.consumed - i, confidence: 1, role: subDay ? 'datetime' : 'date' };
};

/** "<unit> after next": the unit interval two steps out. */
const ruleUnitAfterNext: Rule = (tokens, i) => {
  const unit = UNIT_WORDS[word(tokens[i]) ?? ''];
  if (!unit) return undefined;
  if (word(tokens[i + 1]) !== 'after' || word(tokens[i + 2]) !== 'next') return undefined;
  return { expr: snapOffset(2, unit), consumed: 3, confidence: 1, role: 'date' };
};

/** "[the] <weekday> before last" → two occurrences back; "the week before last" → two units back (#21). */
const ruleBeforeLast: Rule = (tokens, i) => {
  let at = i;
  if (word(tokens[at]) === 'the') at += 1;
  const w = word(tokens[at]);
  if (w === undefined) return undefined;
  if (word(tokens[at + 1]) !== 'before' || word(tokens[at + 2]) !== 'last') return undefined;
  const consumed = at + 3 - i;
  const weekday = WEEKDAY_WORDS[w];
  if (weekday) {
    // Strict occurrence counting: the second one strictly in the past.
    return {
      expr: { op: 'seek', base: NOW, dir: 'prev', target: { kind: 'weekday', weekday }, n: 2 },
      consumed,
      confidence: 1,
      role: 'date',
    };
  }
  const unit = w !== 'night' ? UNIT_WORDS[w] : undefined;
  if (unit && unit !== 'second' && unit !== 'minute' && unit !== 'hour') {
    return { expr: snapOffset(-2, unit), consumed, confidence: 1, role: 'date' };
  }
  return undefined;
};

/** "last/past/previous N units" → span backwards; "the past week" → trailing 7 days. */
const rulePastN: Rule = (tokens, i) => {
  const w = word(tokens[i]);
  if (w !== 'last' && w !== 'past' && w !== 'previous' && w !== 'prior') return undefined;
  const n = readNumber(tokens, i + 1);
  if (n && Number.isInteger(n.value)) {
    let uAt = i + 1 + n.consumed;
    const biz = word(tokens[uAt]) === 'business' || word(tokens[uAt]) === 'working';
    if (biz) uAt += 1;
    const unit = UNIT_WORDS[word(tokens[uAt]) ?? ''];
    if (unit) {
      if (biz && unit !== 'day') return undefined;
      return {
        expr: {
          op: 'span',
          anchor: NOW,
          amount: amountFor(unit, -n.value),
          ...(biz ? { business: true } : {}),
        },
        consumed: uAt + 1 - i,
        confidence: 1,
        role: 'date',
      };
    }
  }
  if (w === 'past') {
    const soloUnit = UNIT_WORDS[word(tokens[i + 1]) ?? ''];
    if (soloUnit && word(tokens[i + 1]) !== 'night') {
      // "the past week" is the trailing 7 days, but "the past quarter/month/
      // year" reads as the previous calendar period.
      if (soloUnit === 'month' || soloUnit === 'quarter' || soloUnit === 'year') {
        return { expr: snapOffset(-1, soloUnit), consumed: 2, confidence: 1, role: 'date' };
      }
      return {
        expr: { op: 'span', anchor: NOW, amount: amountFor(soloUnit, -1) },
        consumed: 2,
        confidence: 1,
        role: 'date',
      };
    }
  }
  return undefined;
};

/** "next/coming/following N units" / "over the next couple weeks" → span forward. */
const ruleNextN: Rule = (tokens, i) => {
  const w0 = word(tokens[i]);
  if (w0 !== 'next' && w0 !== 'coming' && w0 !== 'upcoming' && w0 !== 'following') return undefined;
  const n = readNumber(tokens, i + 1);
  if (!n || !Number.isInteger(n.value)) return undefined;
  let at = i + 1 + n.consumed;
  const biz = word(tokens[at]) === 'business' || word(tokens[at]) === 'working';
  if (biz) at += 1;
  const unit = UNIT_WORDS[word(tokens[at]) ?? ''];
  if (!unit || (biz && unit !== 'day')) return undefined;
  return {
    expr: {
      op: 'span',
      anchor: NOW,
      amount: amountFor(unit, n.value),
      ...(biz ? { business: true } : {}),
    },
    consumed: at + 1 - i,
    confidence: 1,
    role: 'date',
  };
};

/** "the year [2008]", "the week [31]", "the month", "the day" — with ISO week numbers. */
const ruleTheUnit: Rule = (tokens, i) => {
  if (word(tokens[i]) !== 'the') return undefined;
  // "the same week/month/year (that it happened)" → the current one.
  if (word(tokens[i + 1]) === 'same') {
    const unit = UNIT_WORDS[word(tokens[i + 2]) ?? ''];
    if (unit && unit !== 'second' && unit !== 'minute' && unit !== 'hour') {
      return { expr: snapNow(unit), consumed: 3, confidence: 0.85, role: 'date' };
    }
    return undefined;
  }
  const uw = word(tokens[i + 1]);
  if (uw === 'fortnight') {
    // Week-aligned: the current and following week.
    return {
      expr: {
        op: 'span',
        anchor: { op: 'snap', base: NOW, unit: 'week', edge: 'start' },
        amount: { days: 14 },
      },
      consumed: 2,
      confidence: 0.85,
      role: 'date',
    };
  }
  if (uw === undefined || uw === 'day' || uw === 'night') {
    // "the day" only as "for/of the day" (too ambiguous otherwise).
    if (uw === 'day' && (word(tokens[i - 1]) === 'for' || word(tokens[i - 1]) === 'of')) {
      return { expr: snapNow('day'), consumed: 2, confidence: 0.85, role: 'date' };
    }
    return undefined;
  }
  const unit = UNIT_WORDS[uw];
  if (!unit || unit === 'second' || unit === 'minute' || unit === 'hour') return undefined;
  // "the year to date", "the month to date"
  if (word(tokens[i + 2]) === 'to' && word(tokens[i + 3]) === 'date') {
    return {
      expr: {
        op: 'between',
        start: { op: 'snap', base: NOW, unit, edge: 'start' },
        end: { op: 'snap', base: NOW, unit: 'day', edge: 'start' },
      },
      consumed: 4,
      confidence: 1,
      role: 'date',
    };
  }
  const numAt = word(tokens[i + 2]) === 'of' ? i + 3 : i + 2;
  const numTok = tokens[numAt];
  if (numTok?.type === 'number' && !numTok.ordinal) {
    if (unit === 'year' && numTok.value >= 1000 && numTok.value <= 9999) {
      return {
        expr: { op: 'literal', date: { year: numTok.value } },
        consumed: numAt + 1 - i,
        confidence: 1,
        role: 'date',
      };
    }
    if (unit === 'week' && numTok.value >= 1 && numTok.value <= 53) {
      // ISO week n = week containing Jan 4, plus (n-1) weeks.
      return {
        expr: {
          op: 'offset',
          base: { op: 'snap', base: { op: 'literal', date: { month: 1, day: 4 } }, unit: 'week' },
          amount: numTok.value - 1,
          unit: 'week',
        },
        consumed: 3,
        confidence: 0.95,
        role: 'date',
      };
    }
  }
  // Bare "the week"/"the month"/"the year" — only after a preposition, and
  // never when a modifier follows ("the week after next", "the week starting…",
  // "the week before last" — but "the year before independence" is current).
  const follow = word(tokens[i + 2]);
  if (follow === 'after' || follow === 'starting' || follow === 'of') return undefined;
  if (follow === 'before') {
    const anchorish = word(tokens[i + 3]);
    if (anchorish === 'last' || anchorish === 'next' || anchorish === 'yesterday' || anchorish === 'that') {
      return undefined;
    }
  }
  return { expr: snapNow(unit), consumed: 2, confidence: 0.8, role: 'date' };
};

/** Holidays: "christmas [eve] [2019]", "new year", "last easter", "mother's day". */
const ruleHoliday: Rule = (tokens, i) => {
  const w = word(tokens[i]);
  if (w === undefined) return undefined;

  let name: HolidayName | undefined;
  let consumed = 1;
  const next = word(tokens[i + 1]);

  if (w === 'black' && next === 'friday') {
    name = 'black-friday';
    consumed = 2;
  } else if (w === 'christmas' || w === 'xmas') {
    if (next === 'eve') { name = 'christmas-eve'; consumed = 2; }
    else name = 'christmas';
  } else if (w === 'new' && (next === 'year' || next === 'years')) {
    const third = word(tokens[i + 2]);
    if (third === 'eve') { name = 'new-year-eve'; consumed = 3; }
    else if (third === 'day') { name = 'new-year'; consumed = 3; }
    else { name = 'new-year'; consumed = 2; }
  } else if (w === 'thanksgiving') {
    name = 'thanksgiving';
    if (next === 'day') consumed = 2;
  } else if (w === 'halloween') name = 'halloween';
  else if (w === 'easter') {
    name = 'easter';
    if (next === 'day' || next === 'sunday') consumed = 2;
  } else if (w === 'valentine' || w === 'valentines') {
    name = 'valentines';
    if (next === 'day') consumed = 2;
  } else if ((w === 'saint' || w === 'st') && (next === 'patrick' || next === 'patricks')) {
    name = 'st-patricks';
    consumed = word(tokens[i + 2]) === 'day' ? 3 : 2;
  } else if (w === 'international' && next === 'workers' && word(tokens[i + 2]) === 'day') {
    name = 'workers-day';
    consumed = 3;
  } else if (next === 'day') {
    const twoWord: Record<string, HolidayName> = {
      independence: 'independence-day',
      labor: 'labor-day',
      memorial: 'memorial-day',
      mother: 'mothers-day',
      mothers: 'mothers-day',
      father: 'fathers-day',
      fathers: 'fathers-day',
      earth: 'earth-day',
      workers: 'workers-day',
      may: 'workers-day',
    };
    if (twoWord[w]) { name = twoWord[w]; consumed = 2; }
  }
  if (!name) return undefined;

  const year = yearAt(tokens, i + consumed);
  if (year !== undefined) consumed += 1;

  const prev = word(tokens[i - 1]);
  const dir = prev === 'last' || prev === 'previous' ? 'prev' : prev === 'next' || prev === 'coming' ? 'next' : undefined;
  const holiday: TimeExpr = {
    op: 'holiday',
    name,
    ...(year !== undefined ? { year } : {}),
    ...(dir !== undefined ? { dir } : {}),
  };

  // "labor day weekend": Saturday before through the end of the holiday span.
  if (word(tokens[i + consumed]) === 'weekend') {
    return {
      expr: {
        op: 'between',
        start: { op: 'seek', base: holiday, dir: 'prev', target: { kind: 'weekday', weekday: 'sat' }, n: 1 },
        end: { op: 'snap', base: holiday, unit: 'day', edge: 'end' },
      },
      consumed: consumed + 1,
      confidence: 0.95,
      role: 'date',
    };
  }
  return { expr: holiday, consumed, confidence: 0.95, role: 'date' };
};

/** "the weekend of halloween" / "the weekend of <date>". */
const ruleWeekendOf: Rule = (tokens, i, ctx) => {
  let at = i;
  if (word(tokens[at]) === 'the') at += 1;
  if (word(tokens[at]) !== 'weekend' || word(tokens[at + 1]) !== 'of') return undefined;
  at += 2;
  const inner = ruleHoliday(tokens, at, ctx) ?? ruleCalendarDate(tokens, at, ctx);
  if (!inner || inner.role !== 'date') return undefined;
  return {
    expr: {
      op: 'between',
      start: { op: 'seek', base: inner.expr, dir: 'prev', target: { kind: 'weekday', weekday: 'sat' }, n: 1 },
      end: { op: 'snap', base: inner.expr, unit: 'day', edge: 'end' },
    },
    consumed: at + inner.consumed - i,
    confidence: 0.95,
    role: 'date',
  };
};

/** "the 15th [day] of next month" → that day within the scope. */
const ruleDayOfScope: Rule = (tokens, i, ctx) => {
  let at = i;
  if (word(tokens[at]) === 'the') at += 1;
  const t = tokens[at];
  let day: number | undefined;
  let dc = 0;
  if (t?.type === 'number' && t.ordinal && t.value >= 1 && t.value <= 31) {
    day = t.value;
    dc = 1;
  } else {
    const ord = readOrdinalDayWord(tokens, at);
    if (ord) {
      day = ord.value;
      dc = ord.consumed;
    }
  }
  if (day === undefined) return undefined;
  let oAt = at + dc;
  if (word(tokens[oAt]) === 'day') oAt += 1;
  if (word(tokens[oAt]) !== 'of') return undefined;
  oAt += 1;
  const scope = ruleLastThisNext(tokens, oAt, ctx) ?? ruleCalendarDate(tokens, oAt, ctx);
  if (!scope || scope.role !== 'date') return undefined;
  return {
    expr: { op: 'intersect', parts: [scope.expr, { op: 'literal', date: { day } }] },
    consumed: oAt + scope.consumed - i,
    confidence: 1,
    role: 'date',
  };
};

/** "now", "right now", "at the moment", "at present", "at this time", "otd". */
const ruleNow: Rule = (tokens, i) => {
  const w = word(tokens[i]);
  if (w === 'now') return { expr: NOW, consumed: 1, confidence: 0.85, role: 'datetime' };
  if (w === 'right' && word(tokens[i + 1]) === 'now') {
    return { expr: NOW, consumed: 2, confidence: 0.95, role: 'datetime' };
  }
  if (w === 'otd') {
    return { expr: snapNow('day'), consumed: 1, confidence: 0.85, role: 'date' };
  }
  if (w === 'at') {
    const a = word(tokens[i + 1]);
    const b = word(tokens[i + 2]);
    const c = word(tokens[i + 3]);
    if (a === 'present') return { expr: NOW, consumed: 2, confidence: 0.9, role: 'datetime' };
    if (a === 'the' && (b === 'moment' || b === 'minute')) {
      return { expr: NOW, consumed: 3, confidence: 0.9, role: 'datetime' };
    }
    if (a === 'the' && b === 'present' && c === 'time') {
      return { expr: NOW, consumed: 4, confidence: 0.9, role: 'datetime' };
    }
    if (a === 'this' && b === 'time') {
      return { expr: NOW, consumed: 3, confidence: 0.9, role: 'datetime' };
    }
  }
  return undefined;
};

/** "the 5 past minutes", "the 2 next days" → rolling/complete spans. */
const ruleTheNPastNext: Rule = (tokens, i) => {
  // Require the article: without it, "…counted 13 last minute" would misparse.
  if (word(tokens[i - 1]) !== 'the') return undefined;
  const n = readNumber(tokens, i);
  if (!n || !Number.isInteger(n.value)) return undefined;
  const dirWord = word(tokens[i + n.consumed]);
  const DIR: Record<string, 1 | -1> = {
    past: -1, last: -1, previous: -1, prior: -1,
    next: 1, upcoming: 1, coming: 1, following: 1,
  };
  const sign = dirWord !== undefined ? DIR[dirWord] : undefined;
  if (sign === undefined) return undefined;
  const unit = UNIT_WORDS[word(tokens[i + n.consumed + 1]) ?? ''];
  if (!unit) return undefined;
  return {
    expr: { op: 'span', anchor: NOW, amount: amountFor(unit, sign * n.value) },
    consumed: n.consumed + 2,
    confidence: 1,
    role: 'date',
  };
};

const ORDINAL_WORDS: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5 };

const ORDINAL_DAY_WORDS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7,
  eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13,
  fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17,
  eighteenth: 18, nineteenth: 19, twentieth: 20, thirtieth: 30,
};

/** "first", "twenty first" → day-of-month. */
function readOrdinalDayWord(tokens: Token[], i: number): NumRead | undefined {
  const w = word(tokens[i]);
  if (w === undefined) return undefined;
  if (w === 'twenty' || w === 'thirty') {
    const next = word(tokens[i + 1]);
    if (next !== undefined && next in ORDINAL_DAY_WORDS && ORDINAL_DAY_WORDS[next]! <= 9) {
      return { value: (w === 'twenty' ? 20 : 30) + ORDINAL_DAY_WORDS[next]!, consumed: 2 };
    }
    return undefined;
  }
  if (w in ORDINAL_DAY_WORDS) return { value: ORDINAL_DAY_WORDS[w]!, consumed: 1 };
  return undefined;
}

/** "the first Monday [evening] of next month", "the last Friday of March". */
const ruleNthWeekdayOf: Rule = (tokens, i, ctx) => {
  let at = i;
  const ow = word(tokens[at]);
  const t = tokens[at];
  let n: number | 'last' | undefined;
  if (ow !== undefined && ow in ORDINAL_WORDS) n = ORDINAL_WORDS[ow];
  else if (ow === 'last') n = 'last';
  else if (t?.type === 'number' && t.ordinal && t.value <= 5) n = t.value;
  if (n === undefined) return undefined;
  const weekday = WEEKDAY_WORDS[word(tokens[at + 1]) ?? ''];
  if (!weekday) return undefined;
  at += 2;
  // Optional day-period or time range between weekday and "of" ("first
  // Monday evening of…", "first Monday 1pm to 3pm of next month").
  let period: DayPeriod | undefined;
  let timeRange: TimeExpr | undefined;
  const pw = word(tokens[at]);
  if (pw !== undefined && PERIOD_WORDS[pw]) {
    period = PERIOD_WORDS[pw];
    at += 1;
  } else {
    // Bound the range attempt at the next "of" so it can't swallow the scope.
    let ofIdx = -1;
    for (let k = at; k < Math.min(at + 8, tokens.length); k += 1) {
      if (word(tokens[k]) === 'of') { ofIdx = k; break; }
    }
    const scoped = ofIdx >= 0 ? tokens.slice(0, ofIdx) : tokens;
    const range = ruleRange(scoped, at, ctx);
    if (range && range.role === 'time') {
      timeRange = range.expr;
      at += range.consumed;
    }
  }
  if (word(tokens[at]) !== 'of') return undefined;
  at += 1;
  if (word(tokens[at]) === 'the') at += 1;
  const scope =
    ruleLastThisNext(tokens, at, ctx) ?? ruleCalendarDate(tokens, at, ctx);
  if (!scope || scope.role !== 'date') return undefined;

  const seek: TimeExpr =
    n === 'last'
      ? {
          op: 'seek',
          base: { op: 'snap', base: scope.expr, unit: 'month', edge: 'end' },
          dir: 'prev',
          target: { kind: 'weekday', weekday },
        }
      : { op: 'seek', base: scope.expr, dir: 'next', target: { kind: 'weekday', weekday }, n };
  const expr: TimeExpr = period
    ? { op: 'intersect', parts: [seek, { op: 'literal', dayPeriod: period }] }
    : timeRange
      ? { op: 'intersect', parts: [seek, timeRange] }
      : seek;
  return {
    expr,
    consumed: at + scope.consumed - i,
    confidence: 1,
    role: period || timeRange ? 'datetime' : 'date',
  };
};

/** "Monday the twenty seventh" / "Monday 21" → the day number (weekday is redundant). */
const ruleWeekdayDay: Rule = (tokens, i) => {
  const w = word(tokens[i]);
  const weekday = w !== undefined ? WEEKDAY_WORDS[w] : undefined;
  if (!weekday || WEEKDAY_WORDS[w!] === undefined) return undefined;
  if (w!.length <= 5 && !['friday','monday','sunday'].includes(w!)) {
    // abbreviations handled elsewhere
  }
  let at = i + 1;
  const hasThe = word(tokens[at]) === 'the';
  if (hasThe) at += 1;
  const t = tokens[at];
  let day: number | undefined;
  let dc = 0;
  // A bare cardinal ≤ 12 after a weekday reads as a clock hour ("Wednesday
  // 4"), not a day — require an ordinal, "the", or a value above 12.
  if (
    t?.type === 'number' && t.value >= 1 && t.value <= 31 &&
    (t.ordinal || hasThe || t.value > 12) &&
    yearAt(tokens, at) === undefined
  ) {
    day = t.value;
    dc = 1;
  } else {
    const ord = readOrdinalDayWord(tokens, at);
    if (ord) {
      day = ord.value;
      dc = ord.consumed;
    }
  }
  if (day === undefined) return undefined;
  return {
    expr: { op: 'literal', date: { day } },
    consumed: at + dc - i,
    confidence: 0.95,
    role: 'date',
  };
};

/** Bare weekday: "Friday" → both directions, bias-ordered (engine). */
const ruleWeekdayAlone: Rule = (tokens, i) => {
  const prev = word(tokens[i - 1]);
  if (prev !== undefined && REL_SYNONYMS[prev]) return undefined;
  const w = word(tokens[i]);
  if (w === 'weekend') {
    return { expr: weekendExpr('nearest'), consumed: 1, confidence: 0.85, role: 'date' };
  }
  const weekday = w !== undefined ? WEEKDAY_WORDS[w] : undefined;
  if (!weekday) return undefined;
  // Abbreviated forms ("sat", "tue") are too collision-prone without a
  // preposition ("(Tue)" annotations, "sat down", …).
  const isAbbrev = w !== undefined && w.length <= 5 && WEEKDAY_WORDS[w] !== undefined &&
    !['monday','tuesday','wednesday','thursday','friday','saturday','sunday'].includes(w);
  if (isAbbrev && !['on', 'for', 'until', 'till', 'by', 'next', 'last', 'this'].includes(prev ?? '')) {
    return undefined;
  }
  return {
    expr: { op: 'seek', base: NOW, dir: 'nearest', target: { kind: 'weekday', weekday } },
    consumed: 1,
    confidence: 0.9,
    role: 'date',
  };
};

/** A bare year after a temporal preposition: "in 2150", "since 1990". */
const ruleBareYear: Rule = (tokens, i) => {
  const y = readYear(tokens, i);
  if (!y || y.value < 1500 || y.value > 2199) return undefined;
  const prev = word(tokens[i - 1]);
  if (prev !== undefined && !['in', 'since', 'by', 'until', 'during', 'year', 'of', 'from'].includes(prev)) {
    return undefined;
  }
  return { expr: { op: 'literal', date: { year: y.value } }, consumed: y.consumed, confidence: 0.85, role: 'date' };
};

/** Decades ("1990s", "the 90s") and centuries ("21st century"). */
const ruleDecadeCentury: Rule = (tokens, i) => {
  const t = tokens[i];
  const w = word(t);
  const dm = w?.match(/^(\d{2,4})'?s$/);
  if (dm) {
    let year = Number(dm[1]);
    if (year < 100) year += year >= 30 ? 1900 : 2000;
    return {
      expr: { op: 'span', anchor: { op: 'literal', date: { year } }, amount: { years: 10 } },
      consumed: 1,
      confidence: 0.9,
      role: 'date',
    };
  }
  if (t?.type === 'number' && word(tokens[i + 1]) === 's' && t.value >= 1000) {
    return {
      expr: { op: 'span', anchor: { op: 'literal', date: { year: t.value } }, amount: { years: 10 } },
      consumed: 2,
      confidence: 0.9,
      role: 'date',
    };
  }
  if (t?.type === 'number' && t.ordinal && word(tokens[i + 1]) === 'century') {
    return {
      expr: {
        op: 'span',
        anchor: { op: 'literal', date: { year: (t.value - 1) * 100 } },
        amount: { years: 100 },
      },
      consumed: 2,
      confidence: 0.95,
      role: 'date',
    };
  }
  return undefined;
};

/** "May 29", "May 29, 2026", "29 May", "the 3rd", "May", "Q3 2026", "2017 april", "Oct/2", "mar4". */
const ruleCalendarDate: Rule = (tokens, i, ctx) => {
  const w = word(tokens[i]);

  const hLead = w?.match(/^h([12])$/);
  if (hLead) {
    let yAt = i + 1;
    if (word(tokens[yAt]) === 'of') yAt += 1;
    const year = yearAt(tokens, yAt);
    if (year !== undefined) {
      return {
        expr: {
          op: 'span',
          anchor: { op: 'literal', date: { year, month: hLead[1] === '1' ? 1 : 7 } },
          amount: { months: 6 },
        },
        consumed: yAt + 1 - i,
        confidence: 1,
        role: 'date',
      };
    }
  }

  if (w && /^q[1-4]$/.test(w)) {
    const q = Number(w[1]);
    // "q1 2017" / "q1 of 2017"
    let yAt = i + 1;
    if (word(tokens[yAt]) === 'of') yAt += 1;
    const year = yearAt(tokens, yAt);
    const date: { month: number; year?: number } = { month: (q - 1) * 3 + 1 };
    if (year !== undefined) date.year = year;
    return {
      expr: { op: 'snap', base: { op: 'literal', date }, unit: 'quarter' },
      consumed: year !== undefined ? yAt + 1 - i : 1,
      confidence: 1,
      role: 'date',
    };
  }

  // "2017 april" / "2017 apr" / "2017 q1" / "2019-aug-1" (dash-split)
  const yr = yearAt(tokens, i);
  if (yr !== undefined) {
    let mAt = i + 1;
    if (word(tokens[mAt]) === '-') mAt += 1;
    const m = MONTH_WORDS[word(tokens[mAt]) ?? ''];
    if (m !== undefined) {
      let dAt = mAt + 1;
      if (word(tokens[dAt]) === '-') dAt += 1;
      const dTok = tokens[dAt];
      if (dTok?.type === 'number' && !dTok.ordinal && dTok.value >= 1 && dTok.value <= 31) {
        return {
          expr: { op: 'literal', date: { year: yr, month: m, day: dTok.value } },
          consumed: dAt + 1 - i,
          confidence: 1,
          role: 'date',
        };
      }
      return { expr: { op: 'literal', date: { year: yr, month: m } }, consumed: mAt + 1 - i, confidence: 1, role: 'date' };
    }
    const hw = word(tokens[i + 1])?.match(/^h([12])$/);
    if (hw) {
      return {
        expr: {
          op: 'span',
          anchor: { op: 'literal', date: { year: yr, month: hw[1] === '1' ? 1 : 7 } },
          amount: { months: 6 },
        },
        consumed: 2,
        confidence: 1,
        role: 'date',
      };
    }
    const qw = word(tokens[i + 1])?.match(/^q([1-4])$/);
    if (qw) {
      return {
        expr: {
          op: 'snap',
          base: { op: 'literal', date: { year: yr, month: (Number(qw[1]) - 1) * 3 + 1 } },
          unit: 'quarter',
        },
        consumed: 2,
        confidence: 1,
        role: 'date',
      };
    }
  }

  // "2019-h2" joined
  const yh = w?.match(/^(\d{4})-h([12])$/);
  if (yh) {
    return {
      expr: {
        op: 'span',
        anchor: { op: 'literal', date: { year: Number(yh[1]), month: yh[2] === '1' ? 1 : 7 } },
        amount: { months: 6 },
      },
      consumed: 1,
      confidence: 1,
      role: 'date',
    };
  }
  // "q1-2019" joined
  const qy = w?.match(/^q([1-4])-(\d{4})$/);
  if (qy) {
    return {
      expr: {
        op: 'snap',
        base: { op: 'literal', date: { year: Number(qy[2]), month: (Number(qy[1]) - 1) * 3 + 1 } },
        unit: 'quarter',
      },
      consumed: 1,
      confidence: 1,
      role: 'date',
    };
  }

  // "2017-q1" joined, "cy 2008", "cy18"
  const yq = w?.match(/^(\d{4})-q([1-4])$/);
  if (yq) {
    return {
      expr: {
        op: 'snap',
        base: { op: 'literal', date: { year: Number(yq[1]), month: (Number(yq[2]) - 1) * 3 + 1 } },
        unit: 'quarter',
      },
      consumed: 1,
      confidence: 1,
      role: 'date',
    };
  }
  const cy = w?.match(/^cy(\d{2}|\d{4})?$/);
  if (cy) {
    if (cy[1] !== undefined) {
      const year = cy[1].length === 2 ? 2000 + Number(cy[1]) : Number(cy[1]);
      return { expr: { op: 'literal', date: { year } }, consumed: 1, confidence: 0.9, role: 'date' };
    }
    const yTok = yearAt(tokens, i + 1);
    if (yTok !== undefined) {
      return { expr: { op: 'literal', date: { year: yTok } }, consumed: 2, confidence: 0.9, role: 'date' };
    }
    return undefined;
  }

  // "2015-3" / "12-2015" → month+year
  const ymJoined = w?.match(/^(\d{4})-(\d{1,2})$/) ?? null;
  const myJoined = w?.match(/^(\d{1,2})-(\d{4})$/) ?? null;
  if (ymJoined || myJoined) {
    const year = Number(ymJoined ? ymJoined[1] : myJoined![2]);
    const m = Number(ymJoined ? ymJoined[2] : myJoined![1]);
    if (m >= 1 && m <= 12) {
      return {
        expr: { op: 'literal', date: { year, month: m } },
        consumed: 1,
        confidence: 0.9,
        role: 'date',
      };
    }
  }

  // "friday-jun-15" (weekday prefix is redundant), "this friday 7.6" (day.month or month.day)
  const wmd = w?.match(/^([a-z]{3,9})-([a-z]{3,9})-?(\d{1,2})$/);
  if (wmd && WEEKDAY_WORDS[wmd[1]!] && MONTH_WORDS[wmd[2]!] !== undefined) {
    return {
      expr: { op: 'literal', date: { month: MONTH_WORDS[wmd[2]!]!, day: Number(wmd[3]) } },
      consumed: 1,
      confidence: 0.9,
      role: 'date',
    };
  }
  const dotted = w?.match(/^(\d{1,2})\.(\d{1,2})$/);
  if (dotted) {
    const prev = word(tokens[i - 1]);
    const prevIsDay = prev !== undefined && (WEEKDAY_WORDS[prev] !== undefined || prev === 'on');
    if (prevIsDay) {
      const date = numericDate([Number(dotted[1]), Number(dotted[2])], ctx.dateOrder);
      if (date) {
        return { expr: { op: 'literal', date }, consumed: 1, confidence: 0.85, role: 'date' };
      }
    }
  }

  // "20161016"
  const packed = w?.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (packed) {
    const date = valid({ year: Number(packed[1]), month: Number(packed[2]), day: Number(packed[3]) });
    if (date) {
      return { expr: { op: 'literal', date }, consumed: 1, confidence: 0.85, role: 'date' };
    }
  }
  // "2016 10 16"
  const spacedY = yearAt(tokens, i);
  if (spacedY !== undefined && tokens[i + 1]?.type === 'number' && tokens[i + 2]?.type === 'number') {
    const m1 = (tokens[i + 1] as { value: number }).value;
    const d1 = (tokens[i + 2] as { value: number }).value;
    const date = valid({ year: spacedY, month: m1, day: d1 });
    if (date && m1 <= 12) {
      return { expr: { op: 'literal', date }, consumed: 3, confidence: 0.8, role: 'date' };
    }
  }
  // "2020/23/Sep"
  const ydm = w?.match(/^(\d{4})\/(\d{1,2})\/([a-z]{3,9})$/);
  if (ydm && MONTH_WORDS[ydm[3]!] !== undefined) {
    return {
      expr: { op: 'literal', date: { year: Number(ydm[1]), month: MONTH_WORDS[ydm[3]!]!, day: Number(ydm[2]) } },
      consumed: 1,
      confidence: 0.9,
      role: 'date',
    };
  }

  // "2019/aug/01"
  const ymd2 = w?.match(/^(\d{4})\/([a-z]{3,9})\/(\d{1,2})$/);
  if (ymd2 && MONTH_WORDS[ymd2[2]!] !== undefined) {
    return {
      expr: { op: 'literal', date: { year: Number(ymd2[1]), month: MONTH_WORDS[ymd2[2]!]!, day: Number(ymd2[3]) } },
      consumed: 1,
      confidence: 0.95,
      role: 'date',
    };
  }

  // "22/Jan/2019"
  const dmy = w?.match(/^(\d{1,2})\/([a-z]{3,9})\/(\d{4})$/);
  if (dmy && MONTH_WORDS[dmy[2]!] !== undefined) {
    return {
      expr: { op: 'literal', date: { year: Number(dmy[3]), month: MONTH_WORDS[dmy[2]!]!, day: Number(dmy[1]) } },
      consumed: 1,
      confidence: 0.95,
      role: 'date',
    };
  }

  // "oct/2", "mar4", "mar.4"
  // "Dec/2018" → month+year
  const attachedYear = w?.match(/^([a-z]{3,9})\/(\d{4})$/);
  if (attachedYear && MONTH_WORDS[attachedYear[1]!] !== undefined) {
    return {
      expr: { op: 'literal', date: { month: MONTH_WORDS[attachedYear[1]!]!, year: Number(attachedYear[2]) } },
      consumed: 1,
      confidence: 0.9,
      role: 'date',
    };
  }

  const attached = w?.match(/^([a-z]{3,9})[/.]?(\d{1,2})$/);
  if (attached && MONTH_WORDS[attached[1]!] !== undefined) {
    const day = Number(attached[2]);
    if (day >= 1 && day <= 31) {
      const year = yearAt(tokens, i + 1);
      const date: { month: number; day: number; year?: number } = {
        month: MONTH_WORDS[attached[1]!]!,
        day,
      };
      if (year !== undefined) date.year = year;
      return {
        expr: { op: 'literal', date },
        consumed: year !== undefined ? 2 : 1,
        confidence: 0.9,
        role: 'date',
      };
    }
  }

  const month = w !== undefined ? MONTH_WORDS[w] : undefined;
  if (month !== undefined) {
    // "November 18-19": day range within the month.
    const dayPair = word(tokens[i + 1])?.match(/^(\d{1,2})-(\d{1,2})$/);
    if (dayPair && Number(dayPair[1]) <= 31 && Number(dayPair[2]) <= 31 && Number(dayPair[1]) < Number(dayPair[2])) {
      return {
        expr: {
          op: 'between',
          start: { op: 'literal', date: { month, day: Number(dayPair[1]) } },
          end: { op: 'literal', date: { month, day: Number(dayPair[2]) } },
        },
        consumed: 2,
        confidence: 0.95,
        role: 'date',
      };
    }

    // "Jun 15" / "Jun-15" (dash-split)
    const dashSkip = word(tokens[i + 1]) === '-' && tokens[i + 2]?.type === 'number' ? 1 : 0;
    const dayTok = tokens[i + 1 + dashSkip];
    let day: number | undefined;
    let dayConsumed = 0;
    if (dayTok?.type === 'number' && dayTok.value >= 1 && dayTok.value <= 31) {
      day = dayTok.value;
      dayConsumed = 1 + dashSkip;
    } else {
      const ord = readOrdinalDayWord(tokens, i + 1);
      if (ord) {
        day = ord.value;
        dayConsumed = ord.consumed;
      } else {
        const wn = readNumber(tokens, i + 1);
        const isWordNum = word(dayTok) !== undefined && !(word(dayTok)! in FUZZY);
        if (wn && isWordNum && Number.isInteger(wn.value) && wn.value >= 1 && wn.value <= 31) {
          day = wn.value;
          dayConsumed = wn.consumed;
        }
      }
    }
    if (day !== undefined) {
      const yearRead = readYear(tokens, i + 1 + dayConsumed);
      const date: { month: number; day: number; year?: number } = { month, day };
      if (yearRead) date.year = yearRead.value;
      return {
        expr: { op: 'literal', date },
        consumed: 1 + dayConsumed + (yearRead ? yearRead.consumed : 0),
        confidence: 1,
        role: 'date',
      };
    }
    // "Dec 2018" / "Dec-2018" (dash-split) / "april in 2016"
    let yAt = i + 1;
    if (word(tokens[yAt]) === '-' || word(tokens[yAt]) === 'in' || word(tokens[yAt]) === 'of') yAt += 1;
    const year = yearAt(tokens, yAt);
    if (year !== undefined) {
      return { expr: { op: 'literal', date: { month, year } }, consumed: yAt + 1 - i, confidence: 1, role: 'date' };
    }
    return { expr: { op: 'literal', date: { month } }, consumed: 1, confidence: 0.85, role: 'date' };
  }

  // "29 May [2026]" / "3rd of May" / "05-Aug-2016" (dash-split tokens)
  const n = tokens[i];
  if (n?.type === 'number' && n.value >= 1 && n.value <= 31) {
    let at = i + 1;
    if (word(tokens[at]) === 'of' || word(tokens[at]) === '-') at += 1;
    const m2 = MONTH_WORDS[word(tokens[at]) ?? ''];
    if (m2 !== undefined) {
      let yAt = at + 1;
      if (word(tokens[yAt]) === '-' || word(tokens[yAt]) === 'in' || word(tokens[yAt]) === 'of') yAt += 1;
      const year = yearAt(tokens, yAt);
      const date: { month: number; day: number; year?: number } = { month: m2, day: n.value };
      if (year !== undefined) date.year = year;
      return {
        expr: { op: 'literal', date },
        consumed: (year !== undefined ? yAt + 1 : at + 1) - i,
        confidence: 1,
        role: 'date',
      };
    }
    if (n.ordinal) {
      return { expr: { op: 'literal', date: { day: n.value } }, consumed: 1, confidence: 0.8, role: 'date' };
    }
  }

  const nd = tokens[i];
  if (nd?.type === 'numdate') {
    const date = numericDate(nd.parts, ctx.dateOrder);
    if (date) {
      return { expr: { op: 'literal', date }, consumed: 1, confidence: 0.9, role: 'date' };
    }
  }
  return undefined;
};

function numericDate(
  parts: number[],
  order: 'MDY' | 'DMY' | 'YMD',
): { year?: number; month: number; day: number } | undefined {
  const [a, b, c] = [parts[0]!, parts[1], parts[2]];
  if (a >= 1000) {
    if (b === undefined || c === undefined) return undefined;
    return valid({ year: a, month: b, day: c });
  }
  const withYear = (m: number, d: number): { year?: number; month: number; day: number } | undefined => {
    if (c === undefined) return valid({ month: m, day: d });
    const year = c < 100 ? 2000 + c : c;
    return valid({ year, month: m, day: d });
  };
  if (b === undefined) return undefined;
  // Primary order first; an impossible month falls back to the swapped
  // reading ("22/04" is April 22 even under MDY).
  const primary = order === 'DMY' ? withYear(b, a) : withYear(a, b);
  if (primary) return primary;
  return order === 'DMY' ? withYear(a, b) : withYear(b, a);
}

function valid(d: { year?: number; month: number; day: number }): typeof d | undefined {
  if (d.month < 1 || d.month > 12 || d.day < 1 || d.day > 31) return undefined;
  return d;
}

/** Clock times, incl. "half past seven", "20 min past eight", "10 to eight", period suffixes. */
const ruleClockTime: Rule = (tokens, i, ctx) => {
  void ctx;
  const t = tokens[i];

  const withPeriodSuffix = (
    time: PartialTime,
    consumed: number,
  ): RuleMatch => {
    const ps = readPeriodSuffix(tokens, i + consumed);
    if (ps && (time.meridiem === 'unknown' || time.meridiem === undefined)) {
      time.meridiem = meridiemFor(ps.period);
      consumed += ps.consumed;
    }
    return { expr: { op: 'literal', time }, consumed, confidence: 1, role: 'time' };
  };

  if (t?.type === 'clock') {
    const after = word(tokens[i + 1]);
    const meridiem = t.meridiem ?? (after === 'am' || after === 'pm' ? after : undefined);
    let consumed = !t.meridiem && (after === 'am' || after === 'pm') ? 2 : 1;
    const time: PartialTime = { hour: t.hour };
    if (t.explicitMinute) time.minute = t.minute;
    if (t.second !== undefined) time.second = t.second;
    if (meridiem) time.meridiem = meridiem;
    else if (t.hour <= 12) time.meridiem = 'unknown';
    return withPeriodSuffix(time, consumed);
  }

  const w = word(t);
  if (w === 'noon' || w === 'midday' || w === 'noonish') {
    return { expr: { op: 'literal', time: { hour: 12, meridiem: 'pm' } }, consumed: 1, confidence: 1, role: 'time' };
  }
  if (w === 'midnight') {
    return { expr: { op: 'literal', time: { hour: 12, meridiem: 'am' } }, consumed: 1, confidence: 1, role: 'time' };
  }
  // "11.00am" — dotted time with explicit meridiem.
  const dottedMer = w?.match(/^(\d{1,2})\.(\d{2})(am|pm)$/);
  if (dottedMer) {
    const h = Number(dottedMer[1]);
    const min = Number(dottedMer[2]);
    if (h >= 1 && h <= 12 && min <= 59) {
      return {
        expr: { op: 'literal', time: { hour: h, minute: min, meridiem: dottedMer[3] as 'am' | 'pm' } },
        consumed: 1,
        confidence: 1,
        role: 'time',
      };
    }
  }

  // "at 6.45" / "8.10 pm" — dot as minute separator.
  const dottedTime = w?.match(/^(\d{1,2})\.(\d{2})$/);
  if (dottedTime) {
    const after = word(tokens[i + 1]);
    const prevOk = ['at', 'around', 'about'].includes(word(tokens[i - 1]) ?? '');
    const merAfter = after === 'am' || after === 'pm' ? after : undefined;
    if (prevOk || merAfter) {
      const h = Number(dottedTime[1]);
      const min = Number(dottedTime[2]);
      if (h >= 1 && h <= 23 && min <= 59) {
        const time: PartialTime = { hour: h, minute: min };
        if (merAfter) time.meridiem = merAfter;
        else if (h <= 12) time.meridiem = 'unknown';
        return { expr: { op: 'literal', time }, consumed: merAfter ? 2 : 1, confidence: 0.9, role: 'time' };
      }
    }
  }

  // "11ish", "7pmish"
  const ish = w?.match(/^(\d{1,2})(am|pm)?ish$/);
  if (ish) {
    const h = Number(ish[1]);
    if (h >= 1 && h <= 12) {
      return {
        expr: {
          op: 'literal',
          time: { hour: h, meridiem: (ish[2] as 'am' | 'pm' | undefined) ?? 'unknown' },
          mod: 'approx',
        },
        consumed: 1,
        confidence: 0.9,
        role: 'time',
      };
    }
  }

  // "half past seven", "quarter past/to eight", "20 min(utes) past eight"
  let minutes: number | undefined;
  let mConsumed = 0;
  if (w === 'half') { minutes = 30; mConsumed = 1; }
  else if (w === 'quarter') { minutes = 15; mConsumed = 1; }
  else {
    const mn = readNumber(tokens, i);
    if (mn && Number.isInteger(mn.value) && mn.value >= 1 && mn.value <= 59) {
      const uw = word(tokens[i + mn.consumed]);
      if (uw === 'min' || uw === 'mins' || uw === 'minute' || uw === 'minutes') {
        minutes = mn.value;
        mConsumed = mn.consumed + 1;
      }
    }
  }
  if (minutes !== undefined) {
    const dirWord = word(tokens[i + mConsumed]);
    if (dirWord === 'past' || dirWord === 'after' || dirWord === 'to' || dirWord === 'till') {
      const hn = readNumber(tokens, i + mConsumed + 1);
      if (hn && Number.isInteger(hn.value) && hn.value >= 1 && hn.value <= 12) {
        const toMode = dirWord === 'to' || dirWord === 'till';
        const hour = toMode ? (hn.value === 1 ? 12 : hn.value - 1) : hn.value;
        const time: PartialTime = {
          hour,
          minute: toMode ? 60 - minutes : minutes,
          meridiem: 'unknown',
        };
        let consumed = mConsumed + 1 + hn.consumed;
        const oc = word(tokens[i + consumed]);
        if (oc === "o'clock" || oc === 'oclock') consumed += 1;
        return withPeriodSuffix(time, consumed);
      }
    }
  }

  // Military/compact: "1140 am" → 11:40.
  if (t?.type === 'number' && !t.ordinal && t.value >= 100 && t.value <= 1259 && t.value % 100 < 60) {
    const after = word(tokens[i + 1]);
    if (after === 'am' || after === 'pm') {
      return {
        expr: {
          op: 'literal',
          time: { hour: Math.floor(t.value / 100), minute: t.value % 100, meridiem: after },
        },
        consumed: 2,
        confidence: 1,
        role: 'time',
      };
    }
  }

  // "eoy": the later half of the year (a range, unlike the point-like eod).
  if (w === 'eoy') {
    return {
      expr: {
        op: 'between',
        start: { op: 'offset', base: { op: 'snap', base: NOW, unit: 'year', edge: 'start' }, amount: 6, unit: 'month' },
        end: { op: 'snap', base: NOW, unit: 'year', edge: 'end' },
      },
      consumed: 1,
      confidence: 0.9,
      role: 'date',
    };
  }
  // "eod"/"eow"/"eom": end-of-period points.
  if (w === 'eod' || w === 'eow' || w === 'eom') {
    const unit: Unit = w === 'eod' ? 'day' : w === 'eow' ? 'week' : 'month';
    return {
      expr: { op: 'snap', base: NOW, unit, edge: 'end' },
      consumed: 1,
      confidence: 0.9,
      role: w === 'eod' ? 'time' : 'date',
    };
  }

  if (w === 'daytime') {
    return {
      expr: {
        op: 'between',
        start: { op: 'literal', time: { hour: 8, meridiem: 'am' } },
        end: { op: 'literal', time: { hour: 6, meridiem: 'pm' } },
      },
      consumed: 1,
      confidence: 0.9,
      role: 'time',
    };
  }
  if (w === 'dinner' || w === 'dinnertime') {
    const prevOk = ['around', 'at', 'about', 'before', 'after'].includes(word(tokens[i - 1]) ?? '');
    if (prevOk) {
      return { expr: { op: 'literal', dayPeriod: 'evening' }, consumed: 1, confidence: 0.85, role: 'time' };
    }
  }
  if (w === 'lunchtime') {
    return {
      expr: {
        op: 'between',
        start: { op: 'literal', time: { hour: 11, meridiem: 'am' } },
        end: { op: 'literal', time: { hour: 1, meridiem: 'pm' } },
      },
      consumed: 1,
      confidence: 0.9,
      role: 'time',
    };
  }

  // Word-number or digit hours: "eight in the evening", "4 pm", "at 4", "10 tonight"
  const hn = t?.type === 'number' && !t.ordinal ? { value: t.value, consumed: 1 } :
    w !== undefined && w in ONES ? { value: ONES[w]!, consumed: 1 } : undefined;
  if (hn && hn.value >= 1 && hn.value <= 12) {
    // Word minutes: "one thirty [p m]" → 1:30.
    let minute: number | undefined;
    let mc = 0;
    const minWord = word(tokens[i + hn.consumed]);
    if (minWord !== undefined && (minWord in TENS || (minWord in ONES && ONES[minWord]! >= 10))) {
      const mn = readNumber(tokens, i + hn.consumed);
      if (mn && mn.value >= 10 && mn.value <= 59) {
        minute = mn.value;
        mc = mn.consumed;
      }
    }
    let after = word(tokens[i + hn.consumed + mc]);
    let afterLen = 1;
    // "p m" / "a m" as two tokens.
    if ((after === 'p' || after === 'a') && word(tokens[i + hn.consumed + mc + 1]) === 'm') {
      after = after === 'p' ? 'pm' : 'am';
      afterLen = 2;
    }
    if (after === 'am' || after === 'pm') {
      const time: PartialTime = { hour: hn.value, meridiem: after };
      if (minute !== undefined) time.minute = minute;
      return {
        expr: { op: 'literal', time },
        consumed: hn.consumed + mc + afterLen,
        confidence: 1,
        role: 'time',
      };
    }
    if (after === "o'clock" || after === 'oclock') {
      return withPeriodSuffix({ hour: hn.value, meridiem: 'unknown' }, hn.consumed + 1);
    }
    // A BARE number before "this <period>" is only a clock time when the
    // number isn't already bound by a preceding noun — "8 this morning"
    // is 8am, but in "building 4 this afternoon" the 4 is a building
    // number and the period keeps its range reading (Recognizers
    // rt-dtm-0523). Utterance start or a time-preposition before the
    // number licenses the binding; an arbitrary preceding word does not.
    // The in/at forms ("4 in the afternoon") are explicit enough to bind
    // regardless, as before.
    const prevWord = word(tokens[i - 1]);
    const allowThis =
      i === 0 || prevWord === undefined || TIME_PREPOSITIONS.has(prevWord);
    const ps = readPeriodSuffix(tokens, i + hn.consumed + mc, allowThis);
    if (ps) {
      const time: PartialTime = { hour: hn.value, meridiem: meridiemFor(ps.period) };
      if (minute !== undefined) time.minute = minute;
      return {
        expr: { op: 'literal', time },
        consumed: hn.consumed + mc + ps.consumed,
        confidence: 0.95,
        role: 'time',
      };
    }
    // An explicit compound like "three thirty" is a confident bare time.
    if (minute !== undefined) {
      return {
        expr: { op: 'literal', time: { hour: hn.value, minute, meridiem: 'unknown' } },
        consumed: hn.consumed + mc,
        confidence: 0.95,
        role: 'time',
      };
    }
    // "10 tonight" / "10, tonight": keep the time; the deictic day merges next.
    if (word(tokens[i + hn.consumed]) === 'tonight') {
      return {
        expr: { op: 'literal', time: { hour: hn.value, meridiem: 'pm' } },
        consumed: hn.consumed,
        confidence: 0.95,
        role: 'time',
      };
    }
    // Day-shifting period phrases: "10 last night", "8 yesterday morning",
    // "5 tomorrow afternoon" (#10). Emit the bare hour with meridiem
    // 'unknown' and stop — the following day-part matches separately and the
    // refiner merges them, with the period supplying the meridiem and the
    // deictic supplying the day shift. Same noun-guard as "this <period>":
    // "the count was 4 last night" keeps the period's range reading.
    const relNext = word(tokens[i + hn.consumed]);
    const isDayShifter =
      relNext !== undefined &&
      (REL_SYNONYMS[relNext] !== undefined ||
        relNext === 'yesterday' || relNext === 'tomorrow' || relNext === 'today');
    const relPeriodWord = isDayShifter ? word(tokens[i + hn.consumed + 1]) : undefined;
    if (allowThis && relPeriodWord !== undefined && PERIOD_WORDS[relPeriodWord]) {
      return {
        expr: { op: 'literal', time: { hour: hn.value, meridiem: 'unknown' } },
        consumed: hn.consumed,
        confidence: 0.95,
        role: 'time',
      };
    }
    if (['at', 'from', 'around', 'about'].includes(word(tokens[i - 1]) ?? '')) {
      return {
        expr: { op: 'literal', time: { hour: hn.value, meridiem: 'unknown' } },
        consumed: hn.consumed,
        confidence: 0.9,
        role: 'time',
      };
    }
  }
  return undefined;
};

/** "in the morning" (anchors to context day; merges with adjacent dates). */
const rulePeriodAlone: Rule = (tokens, i) => {
  const prev = word(tokens[i - 1]);
  if (prev === 'last' || prev === 'this' || prev === 'next') return undefined;
  const w = word(tokens[i]);
  const period = w !== undefined ? PERIOD_WORDS[w] : undefined;
  if (!period) return undefined;
  // "in the morning" / "at night" / "one morning" are confident; a bare
  // period word is not.
  const strong =
    (prev === 'the' && word(tokens[i - 2]) === 'in') ||
    prev === 'at' ||
    prev === 'one' || prev === 'a' ||
    tokens[i - 1]?.type === 'number';
  return {
    expr: { op: 'literal', dayPeriod: period },
    consumed: 1,
    confidence: strong ? 0.9 : 0.4,
    role: 'time',
  };
};

const DURATION_TRIGGERS = ['for', 'lasts', 'last', 'lasting', 'takes', 'take', 'than', 'over'];

/** Trigger-less fractional durations: "one and a half hour(s)", "one hour and half", "½ hour". */
const ruleFractionDuration: Rule = (tokens, i) => {
  const n = readNumber(tokens, i);
  if (!n) return undefined;
  let at = i + n.consumed;
  let value = n.value;
  if (!Number.isInteger(value)) {
    const fUnit = UNIT_WORDS[word(tokens[at]) ?? ''];
    if (fUnit) {
      const secs = round2(value * unitSeconds(fUnit));
      return { expr: { op: 'duration', iso: `PT${secs}S` }, consumed: at + 1 - i, confidence: 0.95, role: 'duration' };
    }
    return undefined;
  }
  // "one and (a) half hour"
  if (word(tokens[at]) === 'and') {
    const skipA = word(tokens[at + 1]) === 'a' ? 1 : 0;
    const frac = word(tokens[at + 1 + skipA]);
    if (frac === 'half') { value += 0.5; at += 2 + skipA; }
    else if (frac === 'quarter') { value += 0.25; at += 2 + skipA; }
    else return undefined;
    const unit = UNIT_WORDS[word(tokens[at]) ?? ''];
    if (!unit) return undefined;
    const secs = round2(value * unitSeconds(unit));
    return { expr: { op: 'duration', iso: `PT${secs}S` }, consumed: at + 1 - i, confidence: 0.95, role: 'duration' };
  }
  // "one hour and (a) half"
  const unit = UNIT_WORDS[word(tokens[at]) ?? ''];
  if (!unit || word(tokens[at + 1]) !== 'and') return undefined;
  const skipA = word(tokens[at + 2]) === 'a' ? 1 : 0;
  const frac = word(tokens[at + 2 + skipA]);
  if (frac === 'half') value += 0.5;
  else if (frac === 'quarter') value += 0.25;
  else return undefined;
  const secs = round2(value * unitSeconds(unit));
  return {
    expr: { op: 'duration', iso: `PT${secs}S` },
    consumed: at + 3 + skipA - i,
    confidence: 0.95,
    role: 'duration',
  };
};
const COMPACT_DUR: Record<string, Unit> = {
  s: 'second', m: 'minute', h: 'hour', d: 'day', w: 'week',
};
/** "weekend(s)" as a duration = 2 days. */
const DURATION_EXTRA_DAYS: Record<string, number> = { weekend: 2, weekends: 2 };

/** Durations: "for 90 minutes / 2.5 hrs / 3 hours 30 minutes / all day / two nights / 3h", "lasts three weekends", "a one and a quarter year gap". */
const ruleDuration: Rule = (tokens, i) => {
  if (!DURATION_TRIGGERS.includes(word(tokens[i]) ?? '')) return undefined;
  let at = i + 1;
  if (word(tokens[at]) === 'a' && word(tokens[at + 1]) !== undefined && readNumber(tokens, at + 1)) at += 1;
  if (word(tokens[at]) === 'all' || (word(tokens[at]) === 'the' && word(tokens[at + 1]) === 'whole')) {
    const skip = word(tokens[at]) === 'all' ? 1 : 2;
    const unit = UNIT_WORDS[word(tokens[at + skip]) ?? ''];
    if (unit) {
      return {
        expr: { op: 'amount', amount: amountFor(unit, 1) },
        consumed: at + skip + 1 - i,
        confidence: 1,
        role: 'duration',
      };
    }
    return undefined;
  }
  if (word(tokens[at]) === 'the') {
    const theUnit = UNIT_WORDS[word(tokens[at + 1]) ?? ''];
    if (theUnit === 'hour' || theUnit === 'minute' || theUnit === 'second') {
      return {
        expr: { op: 'amount', amount: amountFor(theUnit, 1) },
        consumed: at + 2 - i,
        confidence: 0.95,
        role: 'duration',
      };
    }
  }
  if (word(tokens[at]) === 'another') {
    const unit = UNIT_WORDS[word(tokens[at + 1]) ?? ''];
    if (unit) {
      return {
        expr: { op: 'amount', amount: amountFor(unit, 1) },
        consumed: at + 2 - i,
        confidence: 1,
        role: 'duration',
      };
    }
    return undefined;
  }
  // Compact: "3h", "45min" as a single token.
  const compact = word(tokens[at])?.match(/^(\d+(?:\.\d+)?)(years?|yrs?|months?|weeks?|wks?|days?|hours?|hrs?|minutes?|mins?|seconds?|secs?|s|m|h|d|w)$/);
  if (compact) {
    const cUnit = COMPACT_DUR[compact[2]!] ?? UNIT_WORDS[compact[2]!];
    if (!cUnit) return undefined;
    const secs = round2(Number(compact[1]) * unitSeconds(cUnit));
    return { expr: { op: 'duration', iso: `PT${secs}S` }, consumed: at + 1 - i, confidence: 0.95, role: 'duration' };
  }

  const amount: Record<string, number> = {};
  let fractionalSeconds = 0;
  let any = false;
  while (true) {
    // Compound: "3 hours and 30 minutes".
    if (any && word(tokens[at]) === 'and') at += 1;
    const n = readNumber(tokens, at);
    if (!n) break;
    let value = n.value;
    let uAt = at + n.consumed;
    // "one and a quarter year"
    if (word(tokens[uAt]) === 'and') {
      const skipA = word(tokens[uAt + 1]) === 'a' ? 1 : 0;
      const frac = word(tokens[uAt + 1 + skipA]);
      if (frac === 'half') { value += 0.5; uAt += 2 + skipA; }
      else if (frac === 'quarter') { value += 0.25; uAt += 2 + skipA; }
    }
    const uw = word(tokens[uAt]) ?? '';
    const extraDays = DURATION_EXTRA_DAYS[uw];
    const unit = extraDays !== undefined ? 'day' : UNIT_WORDS[uw];
    if (!unit) break;
    if (extraDays !== undefined) value *= extraDays;
    let consumedUnit = uAt + 1;
    // "one year and a quarter"
    if (word(tokens[consumedUnit]) === 'and') {
      const skipA = word(tokens[consumedUnit + 1]) === 'a' ? 1 : 0;
      const frac = word(tokens[consumedUnit + 1 + skipA]);
      if (frac === 'half') { value += 0.5; consumedUnit += 2 + skipA; }
      else if (frac === 'quarter') { value += 0.25; consumedUnit += 2 + skipA; }
    }
    if (Number.isInteger(value)) {
      const f = unitField(unit);
      amount[f] = (amount[f] ?? 0) + (unit === 'quarter' ? 3 * value : value);
    } else {
      fractionalSeconds += round2(value * unitSeconds(unit));
    }
    any = true;
    at = consumedUnit;
  }
  if (!any) return undefined;
  if (fractionalSeconds > 0) {
    for (const [k, v] of Object.entries(amount)) fractionalSeconds += v * unitSeconds(k.slice(0, -1) as Unit);
    return {
      expr: { op: 'duration', iso: `PT${round2(fractionalSeconds)}S` },
      consumed: at - i,
      confidence: 1,
      role: 'duration',
    };
  }
  return {
    expr: { op: 'amount', amount },
    consumed: at - i,
    confidence: 1,
    role: 'duration',
  };
};

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

function unitSeconds(unit: Unit): number {
  switch (unit) {
    case 'second': return 1;
    case 'minute': return 60;
    case 'hour': return 3600;
    case 'day': return 86400;
    case 'week': return 604800;
    case 'month': return 2592000;
    case 'quarter': return 7776000;
    case 'year': return 31536000;
  }
}

/** "within 5 minutes", "within the next day and 5 hours" → forward span. */
const ruleWithin: Rule = (tokens, i) => {
  if (word(tokens[i]) !== 'within') return undefined;
  let at = i + 1;
  if (word(tokens[at]) === 'the') at += 1;
  if (word(tokens[at]) === 'next') at += 1;
  const compactW = word(tokens[at])?.match(/^(\d+)(s|m|h|d|w)$/);
  if (compactW) {
    const cUnit = COMPACT_DUR[compactW[2]!]!;
    return {
      expr: { op: 'span', anchor: NOW, amount: amountFor(cUnit, Number(compactW[1])) },
      consumed: at + 1 - i,
      confidence: 0.95,
      role: 'datetime',
    };
  }
  const amount: Record<string, number> = {};
  let any = false;
  while (true) {
    if (any && word(tokens[at]) === 'and') at += 1;
    const n = readNumber(tokens, at);
    const nVal = n && Number.isInteger(n.value) ? n.value : 1;
    const uAt = at + (n ? n.consumed : 0);
    const unit = UNIT_WORDS[word(tokens[uAt]) ?? ''];
    if (!unit || (!n && any)) break;
    if (!n && !any && word(tokens[uAt]) === undefined) break;
    const f = unitField(unit);
    amount[f] = (amount[f] ?? 0) + (unit === 'quarter' ? 3 * nVal : nVal);
    any = true;
    at = uAt + 1;
  }
  if (!any) return undefined;
  return {
    expr: { op: 'span', anchor: NOW, amount },
    consumed: at - i,
    confidence: 0.95,
    role: 'datetime',
  };
};

/** "all week"/"all day" without a trigger word → a one-unit duration. */
const ruleAllUnit: Rule = (tokens, i) => {
  if (word(tokens[i]) !== 'all') return undefined;
  const unit = UNIT_WORDS[word(tokens[i + 1]) ?? ''];
  if (!unit || word(tokens[i + 1]) === 'night') return undefined;
  return { expr: { op: 'amount', amount: amountFor(unit, 1) }, consumed: 2, confidence: 0.9, role: 'duration' };
};

/** Rules in priority order (first match at a position wins ties by length then order). */
/**
 * Built-in English rules with stable public names (docs/extending.md).
 * Order matters: the scanner prefers longer matches, then higher confidence,
 * then earlier list position — so names are also the disable/override handle.
 */
export const EN_RULE_ENTRIES: readonly { name: string; rule: Rule }[] = [
  { name: 'range', rule: ruleRange },
  { name: 'open-range', rule: ruleOpenRange },
  { name: 'week-of', rule: ruleWeekOf },
  { name: 'nth-weekday-of', rule: ruleNthWeekdayOf },
  { name: 'day-of-scope', rule: ruleDayOfScope },
  { name: 'weekend-of', rule: ruleWeekendOf },
  { name: 'holiday', rule: ruleHoliday },
  { name: 'early-late', rule: ruleEarlyLate },
  { name: 'end-of', rule: ruleEndOf },
  { name: 'deictic-day', rule: ruleDeicticDay },
  { name: 'within', rule: ruleWithin },
  { name: 'n-after-date', rule: ruleNAfterDate },
  { name: 'unit-after-next', rule: ruleUnitAfterNext },
  { name: 'before-last', rule: ruleBeforeLast },
  { name: 'past-n', rule: rulePastN },
  { name: 'next-n', rule: ruleNextN },
  { name: 'the-n-past-next', rule: ruleTheNPastNext },
  { name: 'the-unit', rule: ruleTheUnit },
  { name: 'last-this-next', rule: ruleLastThisNext },
  { name: 'ago-in', rule: ruleAgoIn },
  { name: 'duration', rule: ruleDuration },
  { name: 'fraction-duration', rule: ruleFractionDuration },
  { name: 'all-unit', rule: ruleAllUnit },
  { name: 'decade-century', rule: ruleDecadeCentury },
  { name: 'bare-year', rule: ruleBareYear },
  { name: 'calendar-date', rule: ruleCalendarDate },
  { name: 'clock-time', rule: ruleClockTime },
  { name: 'weekday-day', rule: ruleWeekdayDay },
  { name: 'weekday-alone', rule: ruleWeekdayAlone },
  { name: 'period-alone', rule: rulePeriodAlone },
  { name: 'now', rule: ruleNow },
];

export const EN_RULES: readonly Rule[] = EN_RULE_ENTRIES.map((e) => e.rule);
