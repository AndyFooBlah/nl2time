/**
 * English rule set. Each rule inspects the token stream at a position and, on
 * match, emits a TimeExpr plus the number of tokens consumed. Rules are pure
 * pattern → IR translators; all resolution semantics live in the engine.
 */
import type { TimeContext } from '../context.js';
import type { DayPeriod, TimeExpr, Unit, Weekday } from '../ir/types.js';
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
  morning: 'morning',
  afternoon: 'afternoon',
  evening: 'evening',
  night: 'night',
};

const SMALL_NUMBERS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};

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

function numberValue(t: Token | undefined): number | undefined {
  if (t?.type === 'number') return t.value;
  const w = word(t);
  return w !== undefined ? SMALL_NUMBERS[w] : undefined;
}

// --- rules -----------------------------------------------------------------

/** today / yesterday / tomorrow / tonight / day before yesterday / day after tomorrow */
const ruleDeicticDay: Rule = (tokens, i) => {
  const w = word(tokens[i]);
  if (w === 'today') return { expr: snapNow('day'), consumed: 1, confidence: 1, role: 'date' };
  if (w === 'yesterday') return { expr: snapOffset(-1, 'day'), consumed: 1, confidence: 1, role: 'date' };
  if (w === 'tomorrow') return { expr: snapOffset(1, 'day'), consumed: 1, confidence: 1, role: 'date' };
  if (w === 'tonight') {
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
  }
  return undefined;
};

/** last/this/next + unit | weekday | day-period; "last night", "next Tuesday", "this week" */
const ruleLastThisNext: Rule = (tokens, i) => {
  const w = word(tokens[i]);
  if (w !== 'last' && w !== 'this' && w !== 'next') return undefined;
  const nextWord = word(tokens[i + 1]);
  if (nextWord === undefined) return undefined;

  const unit = UNIT_WORDS[nextWord];
  if (unit) {
    const delta = w === 'last' ? -1 : w === 'next' ? 1 : 0;
    const expr = delta === 0 ? snapNow(unit) : snapOffset(delta, unit);
    return { expr, consumed: 2, confidence: 1, role: 'date' };
  }

  const weekday = WEEKDAY_WORDS[nextWord];
  if (weekday) {
    const dir = w === 'last' ? 'prev' : w === 'next' ? 'next' : 'nearest';
    return {
      expr: { op: 'seek', base: NOW, dir, target: { kind: 'weekday', weekday } },
      consumed: 2,
      confidence: 1,
      role: 'date',
    };
  }

  const period = PERIOD_WORDS[nextWord];
  if (period) {
    // "last night" / "this morning" / "this evening": the period of the
    // relevant day. "last night" anchors to yesterday (21:00 → 06:00 wraps
    // into today, which the engine's day-period interval handles).
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
    const n = numberValue(tokens[i + 1]);
    const unit = UNIT_WORDS[word(tokens[i + 2]) ?? ''];
    if (n !== undefined && unit) {
      return { expr: mkExpr(n, unit, 1), consumed: 3, confidence: 1, role: 'datetime' };
    }
    return undefined;
  }

  const n = numberValue(tokens[i]);
  const unit = UNIT_WORDS[word(tokens[i + 1]) ?? ''];
  if (n !== undefined && unit && word(tokens[i + 2]) === 'ago') {
    return { expr: mkExpr(n, unit, -1), consumed: 3, confidence: 1, role: 'datetime' };
  }
  return undefined;
};

/** "last/past N units" → anchored span backwards from now. */
const rulePastN: Rule = (tokens, i) => {
  const w = word(tokens[i]);
  if (w !== 'last' && w !== 'past') return undefined;
  const n = numberValue(tokens[i + 1]);
  const unit = UNIT_WORDS[word(tokens[i + 2]) ?? ''];
  if (n === undefined || !unit) {
    // "the past week" → the trailing 7 days (distinct from "last week").
    if (w === 'past') {
      const soloUnit = UNIT_WORDS[word(tokens[i + 1]) ?? ''];
      if (soloUnit) {
        return {
          expr: { op: 'span', anchor: NOW, amount: { [unitField(soloUnit)]: -1 } },
          consumed: 2,
          confidence: 1,
          role: 'date',
        };
      }
    }
    return undefined;
  }
  return {
    expr: { op: 'span', anchor: NOW, amount: { [unitField(unit)]: -n } },
    consumed: 3,
    confidence: 1,
    role: 'date',
  };
};

/** "next N units" → span forward. */
const ruleNextN: Rule = (tokens, i) => {
  if (word(tokens[i]) !== 'next') return undefined;
  const n = numberValue(tokens[i + 1]);
  const unit = UNIT_WORDS[word(tokens[i + 2]) ?? ''];
  if (n === undefined || !unit) return undefined;
  return {
    expr: { op: 'span', anchor: NOW, amount: { [unitField(unit)]: n } },
    consumed: 3,
    confidence: 1,
    role: 'date',
  };
};

function unitField(unit: Unit): string {
  return unit === 'quarter' ? 'months' : `${unit}s`;
}

/** Bare weekday: "Friday" → nearest occurrence under bias. */
const ruleWeekdayAlone: Rule = (tokens, i) => {
  const prev = word(tokens[i - 1]);
  if (prev === 'last' || prev === 'this' || prev === 'next') return undefined;
  const w = word(tokens[i]);
  const weekday = w !== undefined ? WEEKDAY_WORDS[w] : undefined;
  if (!weekday) return undefined;
  // Skip bare "sat"/"sun" — too ambiguous with the verbs; full names only.
  if (w === 'sat' || w === 'sun' || w === 'mon') return undefined;
  return {
    expr: { op: 'seek', base: NOW, dir: 'nearest', target: { kind: 'weekday', weekday } },
    consumed: 1,
    confidence: 0.9,
    role: 'date',
  };
};

/** "May 29", "May 29, 2026", "29 May", "the 3rd", "May", "Q3 2026". */
const ruleCalendarDate: Rule = (tokens, i, ctx) => {
  const w = word(tokens[i]);

  // Quarter: q1..q4 [year]
  if (w && /^q[1-4]$/.test(w)) {
    const q = Number(w[1]);
    const year = yearAt(tokens, i + 1);
    const date: { month: number; year?: number } = { month: (q - 1) * 3 + 1 };
    if (year !== undefined) date.year = year;
    return {
      expr: { op: 'snap', base: { op: 'literal', date }, unit: 'quarter' },
      consumed: year !== undefined ? 2 : 1,
      confidence: 1,
      role: 'date',
    };
  }

  const month = w !== undefined ? MONTH_WORDS[w] : undefined;
  if (month !== undefined) {
    const dayTok = tokens[i + 1];
    const day = dayTok?.type === 'number' && dayTok.value >= 1 && dayTok.value <= 31 ? dayTok.value : undefined;
    if (day !== undefined) {
      const year = yearAt(tokens, i + 2);
      const date: { month: number; day: number; year?: number } = { month, day };
      if (year !== undefined) date.year = year;
      return {
        expr: { op: 'literal', date },
        consumed: year !== undefined ? 3 : 2,
        confidence: 1,
        role: 'date',
      };
    }
    const year = yearAt(tokens, i + 1);
    if (year !== undefined) {
      return { expr: { op: 'literal', date: { month, year } }, consumed: 2, confidence: 1, role: 'date' };
    }
    return { expr: { op: 'literal', date: { month } }, consumed: 1, confidence: 0.85, role: 'date' };
  }

  // "29 May [2026]" / "3rd of May"
  const n = tokens[i];
  if (n?.type === 'number' && n.value >= 1 && n.value <= 31) {
    let at = i + 1;
    if (word(tokens[at]) === 'of') at += 1;
    const m2 = MONTH_WORDS[word(tokens[at]) ?? ''];
    if (m2 !== undefined) {
      const year = yearAt(tokens, at + 1);
      const date: { month: number; day: number; year?: number } = { month: m2, day: n.value };
      if (year !== undefined) date.year = year;
      return {
        expr: { op: 'literal', date },
        consumed: (year !== undefined ? at + 2 : at + 1) - i,
        confidence: 1,
        role: 'date',
      };
    }
    // "the 3rd" (ordinal only, to avoid eating bare cardinals)
    if (n.ordinal) {
      return { expr: { op: 'literal', date: { day: n.value } }, consumed: 1, confidence: 0.8, role: 'date' };
    }
  }

  // Numeric dates: 5/29, 5/29/2026, 2026-07-19 — honoring ctx.dateOrder.
  const nd = tokens[i];
  if (nd?.type === 'numdate') {
    const date = numericDate(nd.parts, ctx.dateOrder);
    if (date) {
      return { expr: { op: 'literal', date }, consumed: 1, confidence: 0.9, role: 'date' };
    }
  }
  return undefined;
};

function yearAt(tokens: Token[], i: number): number | undefined {
  const t = tokens[i];
  return t?.type === 'number' && !t.ordinal && t.value >= 1000 && t.value <= 9999
    ? t.value
    : undefined;
}

function numericDate(
  parts: number[],
  order: 'MDY' | 'DMY' | 'YMD',
): { year?: number; month: number; day: number } | undefined {
  const [a, b, c] = [parts[0]!, parts[1], parts[2]];
  if (a >= 1000) {
    // 2026-07-19 is unambiguous ISO regardless of dateOrder.
    if (b === undefined || c === undefined) return undefined;
    return valid({ year: a, month: b, day: c });
  }
  const withYear = (m: number, d: number): { year?: number; month: number; day: number } | undefined => {
    if (c === undefined) return valid({ month: m, day: d });
    const year = c < 100 ? 2000 + c : c;
    return valid({ year, month: m, day: d });
  };
  if (b === undefined) return undefined;
  return order === 'DMY' ? withYear(b, a) : withYear(a, b);
}

function valid(d: { year?: number; month: number; day: number }): typeof d | undefined {
  if (d.month < 1 || d.month > 12 || d.day < 1 || d.day > 31) return undefined;
  return d;
}

/** Clock times: "4:30pm", "16:00", "4pm", "noon", "midnight", "4 o'clock", "at 4". */
const ruleClockTime: Rule = (tokens, i) => {
  const t = tokens[i];
  if (t?.type === 'clock') {
    // A following am/pm word attaches ("4:30 pm").
    const after = word(tokens[i + 1]);
    const meridiem = t.meridiem ?? (after === 'am' || after === 'pm' ? after : undefined);
    const consumed = !t.meridiem && (after === 'am' || after === 'pm') ? 2 : 1;
    const time: { hour: number; minute?: number; second?: number; meridiem?: 'am' | 'pm' | 'unknown' } = {
      hour: t.hour,
    };
    if (t.explicitMinute) time.minute = t.minute;
    if (t.second !== undefined) time.second = t.second;
    if (meridiem) time.meridiem = meridiem;
    else if (t.hour <= 12) time.meridiem = 'unknown';
    return { expr: { op: 'literal', time }, consumed, confidence: 1, role: 'time' };
  }

  const w = word(t);
  if (w === 'noon' || w === 'midday') {
    return { expr: { op: 'literal', time: { hour: 12, meridiem: 'pm' } }, consumed: 1, confidence: 1, role: 'time' };
  }
  if (w === 'midnight') {
    return { expr: { op: 'literal', time: { hour: 12, meridiem: 'am' } }, consumed: 1, confidence: 1, role: 'time' };
  }

  if (t?.type === 'number' && t.value >= 1 && t.value <= 12 && !t.ordinal) {
    const after = word(tokens[i + 1]);
    if (after === 'am' || after === 'pm') {
      return {
        expr: { op: 'literal', time: { hour: t.value, meridiem: after } },
        consumed: 2,
        confidence: 1,
        role: 'time',
      };
    }
    if (after === "o'clock" || after === 'oclock') {
      return {
        expr: { op: 'literal', time: { hour: t.value, meridiem: 'unknown' } },
        consumed: 2,
        confidence: 1,
        role: 'time',
      };
    }
    // Bare small number is a time only right after "at" ("at 4").
    if (word(tokens[i - 1]) === 'at') {
      return {
        expr: { op: 'literal', time: { hour: t.value, meridiem: 'unknown' } },
        consumed: 1,
        confidence: 0.9,
        role: 'time',
      };
    }
  }
  return undefined;
};

/** Bare day-period words ("morning") only combine via the refiner; low confidence alone. */
const rulePeriodAlone: Rule = (tokens, i) => {
  const prev = word(tokens[i - 1]);
  if (prev === 'last' || prev === 'this' || prev === 'next') return undefined;
  const w = word(tokens[i]);
  const period = w !== undefined ? PERIOD_WORDS[w] : undefined;
  if (!period) return undefined;
  return { expr: { op: 'literal', dayPeriod: period }, consumed: 1, confidence: 0.4, role: 'time' };
};

/** Durations/amounts: "for 90 minutes", "2 weeks" (as an amount value). */
const ruleDuration: Rule = (tokens, i) => {
  const isFor = word(tokens[i]) === 'for';
  const at = isFor ? i + 1 : i;
  const n = numberValue(tokens[at]);
  const unit = UNIT_WORDS[word(tokens[at + 1]) ?? ''];
  if (n === undefined || !unit) return undefined;
  // Without "for", require that this isn't part of "N units ago" / "in N units".
  if (!isFor && (word(tokens[at + 2]) === 'ago' || word(tokens[i - 1]) === 'in')) return undefined;
  if (!isFor) return undefined; // conservative in v1: bare "2 weeks" stays unparsed
  return {
    expr: { op: 'amount', amount: { [unitField(unit)]: n } },
    consumed: at + 2 - i,
    confidence: 1,
    role: 'duration',
  };
};

/** Rules in priority order (first match at a position wins ties by length then order). */
export const EN_RULES: readonly Rule[] = [
  ruleDeicticDay,
  rulePastN,
  ruleNextN,
  ruleLastThisNext,
  ruleAgoIn,
  ruleDuration,
  ruleCalendarDate,
  ruleClockTime,
  ruleWeekdayAlone,
  rulePeriodAlone,
];
