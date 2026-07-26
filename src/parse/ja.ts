/**
 * Japanese rules. CJK text arrives as per-character word tokens (see
 * tokenizer), with ASCII/fullwidth digits normalized to number tokens between
 * them: "2019年1月4日" → number 2019, 年, number 1, 月, number 4, 日. Rules
 * match character sequences; kanji numerals (三十, 二〇一八) are converted
 * locally. Climbed against corpus/forward/imported-recognizers-ja.json
 * (issue #13).
 */
import type { CalendarAmount, DayPeriod, PartialDate, PartialTime, TimeExpr, Unit, Weekday } from '../ir/types.js';
import type { Rule, RuleMatch } from './en.js';
import type { Token } from './tokenizer.js';

const NOW: TimeExpr = { op: 'now' };

function snapNow(unit: Unit): TimeExpr {
  return { op: 'snap', base: NOW, unit };
}

function snapOffset(amount: number, unit: Unit): TimeExpr {
  return { op: 'snap', base: { op: 'offset', base: NOW, amount, unit }, unit };
}

function w(tokens: Token[], i: number): string | undefined {
  const t = tokens[i];
  return t?.type === 'word' ? t.value : undefined;
}

/** Match consecutive single-character word tokens spelling `s`; returns count consumed. */
function seq(tokens: Token[], i: number, s: string): number | undefined {
  let k = i;
  for (const ch of s) {
    if (w(tokens, k) !== ch) return undefined;
    k += 1;
  }
  return k - i;
}

// --- numbers ---------------------------------------------------------------

const KDIGIT: Record<string, number> = {
  '〇': 0, '零': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5,
  '六': 6, '七': 7, '八': 8, '九': 9,
};
const KMULT: Record<string, number> = { '十': 10, '百': 100, '千': 1000 };

interface NumRead {
  value: number;
  consumed: number;
  /** 2-digit year candidate ("１９年") — only valid when a month follows. */
  short?: boolean;
}

/** ASCII number token or kanji numeral run (三十 = 30, 二〇一八 = 2018). */
function readInt(tokens: Token[], i: number): NumRead | undefined {
  const t = tokens[i];
  if (t?.type === 'number' && !t.ordinal) return { value: t.value, consumed: 1 };
  const chars: string[] = [];
  let k = i;
  for (;;) {
    const c = w(tokens, k);
    if (c !== undefined && (KDIGIT[c] !== undefined || KMULT[c] !== undefined)) {
      chars.push(c);
      k += 1;
    } else break;
  }
  if (chars.length === 0) return undefined;
  let value = 0;
  if (chars.some((c) => KMULT[c] !== undefined)) {
    let cur = 0;
    for (const c of chars) {
      if (KDIGIT[c] !== undefined) cur = cur * 10 + KDIGIT[c]!;
      else {
        value += (cur === 0 ? 1 : cur) * KMULT[c]!;
        cur = 0;
      }
    }
    value += cur;
  } else {
    for (const c of chars) value = value * 10 + KDIGIT[c]!;
  }
  return { value, consumed: chars.length };
}

/** Digits, kanji numbers, decimals ("123.45"), 数 = "several" (3). */
function readCount(tokens: Token[], i: number): NumRead | undefined {
  const r = readInt(tokens, i);
  if (r) return r;
  const t = tokens[i];
  if (t?.type === 'word' && /^\d+\.\d+$/.test(t.value)) return { value: Number(t.value), consumed: 1 };
  if (w(tokens, i) === '数') return { value: 3, consumed: 1 };
  return undefined;
}

// --- years / eras ----------------------------------------------------------

const ERAS: { name: string; base: number }[] = [
  { name: '令和', base: 2018 },
  { name: '平成', base: 1988 },
  { name: '昭和', base: 1925 },
  { name: '大正', base: 1911 },
  { name: '明治', base: 1867 },
];

/** A year value (before the 年 marker): 4-digit, era+N (平成13 → 2001), era+元. */
function readYear(tokens: Token[], i: number): NumRead | undefined {
  for (const era of ERAS) {
    const c = seq(tokens, i, era.name);
    if (c === undefined) continue;
    if (w(tokens, i + c) === '元') return { value: era.base + 1, consumed: c + 1 };
    const n = readInt(tokens, i + c);
    if (n && n.value >= 1 && n.value <= 99) return { value: era.base + n.value, consumed: c + n.consumed };
    return undefined;
  }
  const n = readInt(tokens, i);
  if (n && n.value >= 1000 && n.value <= 9999) return n;
  if (n && n.value >= 10 && n.value <= 99) return { value: 2000 + n.value, consumed: n.consumed, short: true };
  return undefined;
}

// --- dates -----------------------------------------------------------------

const WEEKDAY_CHARS: Record<string, Weekday> = {
  '月': 'mon', '火': 'tue', '水': 'wed', '木': 'thu', '金': 'fri', '土': 'sat', '日': 'sun',
};

function readWeekdayName(tokens: Token[], i: number): { weekday: Weekday; consumed: number } | undefined {
  const c = w(tokens, i);
  if (c === undefined || WEEKDAY_CHARS[c] === undefined) return undefined;
  if (w(tokens, i + 1) !== '曜') return undefined;
  return { weekday: WEEKDAY_CHARS[c]!, consumed: w(tokens, i + 2) === '日' ? 3 : 2 };
}

interface DateRead {
  date: PartialDate;
  consumed: number;
  grain: 'year' | 'month' | 'day';
}

/** [YYYY年|era年] [の] [M月|正月] [の] [D日] [weekday] — at least one component. */
function readDateCore(tokens: Token[], i: number): DateRead | undefined {
  let at = i;
  const date: PartialDate = {};
  let grain: 'year' | 'month' | 'day' | undefined;
  let shortYear = false;

  const y = readYear(tokens, at);
  if (y && w(tokens, at + y.consumed) === '年') {
    date.year = y.value;
    shortYear = y.short === true;
    at += y.consumed + 1;
    grain = 'year';
  }

  // month
  {
    let mAt = at;
    if (grain !== undefined && w(tokens, mAt) === 'の') mAt += 1;
    const mm = readInt(tokens, mAt);
    if (mm && w(tokens, mAt + mm.consumed) === '月' && mm.value >= 1 && mm.value <= 12) {
      date.month = mm.value;
      at = mAt + mm.consumed + 1;
      grain = 'month';
    } else if (w(tokens, mAt) === '正' && w(tokens, mAt + 1) === '月') {
      date.month = 1;
      at = mAt + 2;
      grain = 'month';
    } else if (w(tokens, mAt) === 'お' && seq(tokens, mAt + 1, '正月') !== undefined) {
      date.month = 1;
      at = mAt + 3;
      grain = 'month';
    }
  }
  if (shortYear && date.month === undefined) return undefined;

  // day
  {
    let dAt = at;
    if (grain !== undefined && w(tokens, dAt) === 'の') dAt += 1;
    const dd = readInt(tokens, dAt);
    if (dd && w(tokens, dAt + dd.consumed) === '日' && dd.value >= 1 && dd.value <= 31) {
      // "3日間" belongs to the duration reading, and bare kanji 一日 is the
      // idiomatic "one whole day" — neither is a day-of-month here.
      const after = w(tokens, dAt + dd.consumed + 1);
      const kanjiOne = grain === undefined && w(tokens, dAt) === '一' && dd.consumed === 1;
      if (after !== '間' && !kanjiOne) {
        date.day = dd.value;
        at = dAt + dd.consumed + 1;
        grain = 'day';
      }
    }
  }
  if (grain === undefined) return undefined;

  // Trailing redundant weekday: "7月6日金曜日".
  if (date.day !== undefined) {
    const wd = readWeekdayName(tokens, at);
    if (wd) at += wd.consumed;
  }
  return { date, consumed: at - i, grain };
}

function grainUnit(grain: 'year' | 'month' | 'day'): Unit {
  return grain;
}

// --- deictic tables --------------------------------------------------------

function dayPeriodOn(dayDelta: number, period: DayPeriod): TimeExpr {
  return {
    op: 'intersect',
    parts: [
      dayDelta === 0 ? snapNow('day') : snapOffset(dayDelta, 'day'),
      { op: 'literal', dayPeriod: period },
    ],
  };
}

const DAY_DEICTIC: [string, number][] = [
  ['一昨日', -2], ['明後日', 2], ['今日', 0], ['本日', 0], ['当日', 0], ['この日', 0],
  ['昨日', -1], ['明日', 1], ['前日', -1], ['翌日', 1],
];

const UNIT_DEICTIC: [string, number, Unit][] = [
  ['再来週', 2, 'week'], ['先々週', -2, 'week'], ['次の週', 1, 'week'], ['前の週', -1, 'week'],
  ['その週', 0, 'week'], ['同じ週', 0, 'week'],
  ['今週', 0, 'week'], ['先週', -1, 'week'], ['来週', 1, 'week'], ['翌週', 1, 'week'],
  ['再来月', 2, 'month'], ['その月', 0, 'month'], ['同じ月', 0, 'month'],
  ['今月', 0, 'month'], ['先月', -1, 'month'], ['来月', 1, 'month'], ['翌月', 1, 'month'],
  ['再来年', 2, 'year'], ['一昨年', -2, 'year'], ['前の年', -1, 'year'],
  ['その年', 0, 'year'], ['同じ年', 0, 'year'],
  ['今年', 0, 'year'], ['去年', -1, 'year'], ['昨年', -1, 'year'], ['来年', 1, 'year'],
  ['翌年', 1, 'year'],
];

function readDeicticDay(tokens: Token[], i: number): { expr: TimeExpr; consumed: number } | undefined {
  for (const [s, delta] of DAY_DEICTIC) {
    const c = seq(tokens, i, s);
    if (c !== undefined) {
      return { expr: delta === 0 ? snapNow('day') : snapOffset(delta, 'day'), consumed: c };
    }
  }
  return undefined;
}

function readDeicticUnit(
  tokens: Token[],
  i: number,
): { expr: TimeExpr; unit: Unit; consumed: number } | undefined {
  for (const [s, delta, unit] of UNIT_DEICTIC) {
    const c = seq(tokens, i, s);
    if (c !== undefined) {
      return { expr: delta === 0 ? snapNow(unit) : snapOffset(delta, unit), unit, consumed: c };
    }
  }
  return undefined;
}

// --- amounts (N units) -----------------------------------------------------

interface UnitRead {
  unit: Unit;
  consumed: number;
  business?: boolean;
  /** Bare 日 (no 間) — usually a calendar day-of-month, not a duration. */
  bareDay?: boolean;
}

function readUnitWord(tokens: Token[], i: number): UnitRead | undefined {
  const c = w(tokens, i);
  if (c === undefined) return undefined;
  const kan = (base: number, unit: Unit): UnitRead => ({
    unit,
    consumed: w(tokens, i + base) === '間' ? base + 1 : base,
  });
  if (seq(tokens, i, '営業日') !== undefined) return { unit: 'day', consumed: 3, business: true };
  if (c === '日') {
    const withKan = w(tokens, i + 1) === '間';
    return { unit: 'day', consumed: withKan ? 2 : 1, bareDay: !withKan };
  }
  if (c === '週' && w(tokens, i + 1) === '間') return { unit: 'week', consumed: 2 };
  if ((c === 'か' || c === 'ヶ' || c === 'ケ' || c === 'カ' || c === '箇') && w(tokens, i + 1) === '月') {
    return kan(2, 'month');
  }
  if (c === '月' && w(tokens, i + 1) === '間') return { unit: 'month', consumed: 2 };
  if (c === '時' && w(tokens, i + 1) === '間') return { unit: 'hour', consumed: 2 };
  if (c === '年') return kan(1, 'year');
  if (c === '分') return kan(1, 'minute');
  if (c === '秒') return kan(1, 'second');
  return undefined;
}

const UNIT_RANK: Record<Unit, number> = {
  year: 0, quarter: 1, month: 2, week: 3, day: 4, hour: 5, minute: 6, second: 7,
};

function amountField(unit: Unit): keyof CalendarAmount {
  return `${unit}s` as keyof CalendarAmount;
}

interface AmountRead {
  amount: CalendarAmount;
  consumed: number;
  smallest: Unit;
  business: boolean;
  bareDay: boolean;
  /** Exact kanji 一日 — idiomatic "one whole day" duration. */
  kanjiOneDay: boolean;
}

/** N unit [半] [M finer-unit …]: 3年半, 1年3か月, 1時間30分, 半年, 数日間. */
function readAmount(tokens: Token[], i: number): AmountRead | undefined {
  let at = i;
  const amount: CalendarAmount = {};
  let smallest: Unit | undefined;
  let business = false;
  let bareDay = false;
  let kanjiOneDay = false;
  for (let part = 0; part < 3; part += 1) {
    let n: number;
    let nc: number;
    let kanjiOne = false;
    if (w(tokens, at) === '半' && part === 0) {
      n = 0.5;
      nc = 1;
    } else {
      const r = readCount(tokens, at);
      if (!r) break;
      n = r.value;
      nc = r.consumed;
      kanjiOne = r.consumed === 1 && w(tokens, at) === '一';
    }
    const u = readUnitWord(tokens, at + nc);
    if (!u) break;
    if (u.unit === 'year' && n >= 1000) break; // "2018年" is a date, not 2018 years
    if (smallest !== undefined && UNIT_RANK[u.unit] <= UNIT_RANK[smallest]) break;
    let half = 0;
    let hc = 0;
    if (w(tokens, at + nc + u.consumed) === '半' && Number.isInteger(n)) {
      half = 0.5;
      hc = 1;
    }
    amount[amountField(u.unit)] = (amount[amountField(u.unit)] ?? 0) + n + half;
    if (u.business) business = true;
    if (u.bareDay === true && u.business !== true) {
      bareDay = true;
      kanjiOneDay = kanjiOne;
    }
    smallest = u.unit;
    at += nc + u.consumed + hc;
    if (half > 0) break;
  }
  if (smallest === undefined) return undefined;
  return { amount, consumed: at - i, smallest, business, bareDay, kanjiOneDay };
}

function isSubDay(unit: Unit): boolean {
  return unit === 'hour' || unit === 'minute' || unit === 'second';
}

/** Chain signed offsets for each amount field; snap to day for coarse results. */
function offsetExpr(base: TimeExpr, amount: CalendarAmount, sign: 1 | -1, smallest: Unit): TimeExpr {
  let expr = base;
  for (const [field, value] of Object.entries(amount)) {
    if (typeof value !== 'number' || value === 0) continue;
    const unit = field.slice(0, -1) as Unit;
    expr = { op: 'offset', base: expr, amount: sign * value, unit };
  }
  return isSubDay(smallest) ? expr : { op: 'snap', base: expr, unit: 'day' };
}

function signedAmount(amount: CalendarAmount, sign: 1 | -1): CalendarAmount {
  if (sign === 1) return amount;
  const out: CalendarAmount = {};
  for (const [field, value] of Object.entries(amount)) {
    if (typeof value === 'number') out[field as keyof CalendarAmount] = -value;
  }
  return out;
}

// --- clock times -----------------------------------------------------------

const MERIDIEM_PREFIXES: [string, 'am' | 'pm'][] = [
  ['午前', 'am'], ['午後', 'pm'], ['朝の', 'am'], ['朝', 'am'],
  ['夜の', 'pm'], ['夜', 'pm'], ['晩の', 'pm'], ['晩', 'pm'],
  ['深夜', 'pm'], ['夕方の', 'pm'], ['夕方', 'pm'],
];

interface ClockRead {
  time: PartialTime;
  consumed: number;
}

/** [午前|午後|朝|夜…] N時 [半|M分] [S秒] · 正午 · 真夜中. */
function readClock(tokens: Token[], i: number): ClockRead | undefined {
  {
    const c = seq(tokens, i, '正午');
    if (c !== undefined) {
      // "正午12時" — redundant hour after noon.
      const n = readInt(tokens, i + c);
      const extra = n && n.value === 12 && w(tokens, i + c + n.consumed) === '時' ? n.consumed + 1 : 0;
      return { time: { hour: 12, meridiem: 'pm' }, consumed: c + extra };
    }
  }
  {
    const c = seq(tokens, i, '真夜中');
    if (c !== undefined) return { time: { hour: 0 }, consumed: c };
  }
  let at = i;
  let meridiem: 'am' | 'pm' | undefined;
  for (const [prefix, m] of MERIDIEM_PREFIXES) {
    const c = seq(tokens, at, prefix);
    if (c !== undefined) {
      meridiem = m;
      at += c;
      break;
    }
  }
  const h = readInt(tokens, at);
  if (!h || h.value > 23 || w(tokens, at + h.consumed) !== '時') return undefined;
  if (w(tokens, at + h.consumed + 1) === '間') return undefined; // duration ("1時間")
  at += h.consumed + 1;
  const time: PartialTime = { hour: h.value };
  if (h.value >= 1 && h.value <= 12) time.meridiem = meridiem ?? 'unknown';
  if (w(tokens, at) === '半') {
    time.minute = 30;
    at += 1;
  } else {
    const m = readInt(tokens, at);
    if (m && m.value <= 59 && w(tokens, at + m.consumed) === '分') {
      time.minute = m.value;
      at += m.consumed + 1;
    }
  }
  const s = readInt(tokens, at);
  if (s && s.value <= 59 && w(tokens, at + s.consumed) === '秒') {
    time.second = s.value;
    if (time.minute === undefined) time.minute = 0;
    at += s.consumed + 1;
  }
  return { time, consumed: at - i };
}

// --- scoped weeks / nth weekdays -------------------------------------------

function readScope(
  tokens: Token[],
  i: number,
): { expr: TimeExpr; unit: 'year' | 'month'; consumed: number } | undefined {
  const d = readDateCore(tokens, i);
  if (d && d.grain !== 'day') {
    return { expr: { op: 'literal', date: d.date }, unit: d.grain, consumed: d.consumed };
  }
  const du = readDeicticUnit(tokens, i);
  if (du && (du.unit === 'month' || du.unit === 'year')) {
    return { expr: du.expr, unit: du.unit, consumed: du.consumed };
  }
  return undefined;
}

function firstWeekOf(scope: TimeExpr, unit: Unit): TimeExpr {
  return { op: 'snap', base: { op: 'snap', base: scope, unit, edge: 'start' }, unit: 'week' };
}

function lastWeekOf(scope: TimeExpr, unit: Unit): TimeExpr {
  return {
    op: 'snap',
    base: {
      op: 'offset',
      base: { op: 'snap', base: scope, unit, edge: 'end' },
      amount: -4,
      unit: 'day',
    },
    unit: 'week',
  };
}

/** "[scopeの]第N週 / 第N月曜日 / 最終月曜日 / 最初の週 / 最後の週 / <date>の週". */
function readWeekOf(tokens: Token[], i: number): { expr: TimeExpr; consumed: number } | undefined {
  let at = i;
  let scope: { expr: TimeExpr; unit: Unit } | undefined;
  const s = readScope(tokens, i);
  if (s) {
    const after = i + s.consumed;
    if (w(tokens, after) === 'の') {
      scope = s;
      at = after + 1;
    } else if (w(tokens, after) === '最' || w(tokens, after) === '第') {
      // "四月最後の月曜日" — the の after the scope is optional.
      scope = s;
      at = after;
    }
  }
  if (scope) {
    const first = seq(tokens, at, '最初の週');
    if (first !== undefined) return { expr: firstWeekOf(scope.expr, scope.unit), consumed: at + first - i };
    const last = seq(tokens, at, '最後の週');
    if (last !== undefined) return { expr: lastWeekOf(scope.expr, scope.unit), consumed: at + last - i };
  }
  // 最終月曜日 / 最後の月曜日 (scope required)
  if (scope) {
    for (const lead of ['最終', '最後の']) {
      const c = seq(tokens, at, lead);
      if (c === undefined) continue;
      const wd = readWeekdayName(tokens, at + c);
      if (!wd) continue;
      return {
        expr: {
          op: 'seek',
          base: { op: 'snap', base: scope.expr, unit: scope.unit, edge: 'end' },
          dir: 'prev',
          target: { kind: 'weekday', weekday: wd.weekday },
          n: 1,
        },
        consumed: at + c + wd.consumed - i,
      };
    }
  }
  // 第N週 / 第N月曜日 (scope optional; weeks default to the current year,
  // nth weekdays to the current month)
  if (w(tokens, at) === '第') {
    const n = readInt(tokens, at + 1);
    if (n && n.value >= 1) {
      const uAt = at + 1 + n.consumed;
      if (w(tokens, uAt) === '週' && n.value <= 53) {
        const base = scope?.expr ?? snapNow('year');
        const baseUnit = scope?.unit ?? 'year';
        // ISO-style week 1: the week containing (period start + 3 days) — the
        // first week with 4+ days inside the period.
        const week1: TimeExpr = {
          op: 'snap',
          base: {
            op: 'offset',
            base: { op: 'snap', base, unit: baseUnit, edge: 'start' },
            amount: 3,
            unit: 'day',
          },
          unit: 'week',
        };
        const shifted: TimeExpr =
          n.value === 1 ? week1 : { op: 'offset', base: week1, amount: n.value - 1, unit: 'week' };
        return { expr: shifted, consumed: uAt + 1 - i };
      }
      const wd = readWeekdayName(tokens, uAt);
      if (wd && n.value <= 5) {
        return {
          expr: {
            op: 'seek',
            base: scope?.expr ?? snapNow('month'),
            dir: 'next',
            target: { kind: 'weekday', weekday: wd.weekday },
            n: n.value,
          },
          consumed: uAt + wd.consumed - i,
        };
      }
    }
  }
  // "<date>の週" — the week containing that date.
  const d = readDateCore(tokens, i);
  if (d && d.grain === 'day') {
    const c = seq(tokens, i + d.consumed, 'の週');
    if (c !== undefined) {
      return {
        expr: { op: 'snap', base: { op: 'literal', date: d.date }, unit: 'week' },
        consumed: d.consumed + c,
      };
    }
  }
  return undefined;
}

// --- range operands --------------------------------------------------------

type Operand =
  | { kind: 'date'; expr: TimeExpr; grain: 'year' | 'month' | 'day'; date?: PartialDate }
  | { kind: 'time'; time: PartialTime }
  | { kind: 'datetime'; dateExpr: TimeExpr; time: PartialTime };

function readOperand(
  tokens: Token[],
  i: number,
  prev?: Operand,
): { op: Operand; consumed: number } | undefined {
  // Scoped nth/last weekday or week ("4月の最終月曜日").
  const wo = readWeekOf(tokens, i);
  if (wo) return { op: { kind: 'date', expr: wo.expr, grain: 'day' }, consumed: wo.consumed };

  // Deictic unit + の + partial date ("来年の2月", "来月の4日").
  const du = readDeicticUnit(tokens, i);
  if (du) {
    const at = i + du.consumed;
    if (w(tokens, at) === 'の') {
      const inner = readDateCore(tokens, at + 1);
      if (inner && inner.date.year === undefined) {
        return {
          op: {
            kind: 'date',
            expr: { op: 'intersect', parts: [du.expr, { op: 'literal', date: inner.date }] },
            grain: inner.grain,
            date: inner.date,
          },
          consumed: at + 1 + inner.consumed - i,
        };
      }
    }
    return { op: { kind: 'date', expr: du.expr, grain: du.unit === 'year' ? 'year' : 'month' }, consumed: du.consumed };
  }

  // Deictic day, optionally with a time ("昨日午後2時", "明日四時").
  const dd = readDeicticDay(tokens, i);
  if (dd) {
    let at = i + dd.consumed;
    if (w(tokens, at) === 'の') {
      const t = readClock(tokens, at + 1);
      if (t) return { op: { kind: 'datetime', dateExpr: dd.expr, time: t.time }, consumed: at + 1 + t.consumed - i };
    }
    const t = readClock(tokens, at);
    if (t) return { op: { kind: 'datetime', dateExpr: dd.expr, time: t.time }, consumed: at + t.consumed - i };
    return { op: { kind: 'date', expr: dd.expr, grain: 'day' }, consumed: dd.consumed };
  }

  // Date literal, optionally with a time ("1月15日4時", "2015年1月1日の10時30分").
  const d = readDateCore(tokens, i);
  if (d) {
    const date = { ...d.date };
    // Bare day after a month-bearing left side inherits its month/year.
    if (prev?.kind === 'date' && prev.date?.month !== undefined && date.month === undefined && date.day !== undefined) {
      date.month = prev.date.month;
      if (prev.date.year !== undefined) date.year = prev.date.year;
    }
    const expr: TimeExpr = { op: 'literal', date };
    if (d.grain === 'day') {
      let at = i + d.consumed;
      let sep = 0;
      if (w(tokens, at) === 'の') sep = 1;
      const t = readClock(tokens, at + sep);
      if (t) return { op: { kind: 'datetime', dateExpr: expr, time: t.time }, consumed: at + sep + t.consumed - i };
    }
    return { op: { kind: 'date', expr, grain: d.grain, date }, consumed: d.consumed };
  }

  // Clock time.
  const t = readClock(tokens, i);
  if (t) return { op: { kind: 'time', time: t.time }, consumed: t.consumed };
  return undefined;
}

function timeLit(time: PartialTime): TimeExpr {
  return { op: 'literal', time };
}

function operandExpr(o: Operand): TimeExpr {
  if (o.kind === 'date') return o.expr;
  if (o.kind === 'time') return timeLit(o.time);
  return { op: 'intersect', parts: [o.dateExpr, timeLit(o.time)] };
}

// === rules =================================================================

/** AからB(まで|の間) ranges over dates, times, and datetimes. */
const ruleRange: Rule = (tokens, i) => {
  const a = readOperand(tokens, i);
  if (!a) return undefined;
  let at = i + a.consumed;
  const kara = seq(tokens, at, 'から');
  if (kara === undefined) return undefined;
  at += kara;
  const b = readOperand(tokens, at, a.op);
  if (!b) return undefined;
  at += b.consumed;
  for (const suffix of ['までの間', 'まで', 'の間']) {
    const c = seq(tokens, at, suffix);
    if (c !== undefined) {
      at += c;
      break;
    }
  }

  const A = a.op;
  const B = b.op;
  let expr: TimeExpr | undefined;
  let role: RuleMatch['role'] = 'date';

  const shareMeridiem = (ta: PartialTime, tb: PartialTime): PartialTime => {
    // "午前10時から12時" — hour 12 stays noon-ish, never 12am.
    if (ta.meridiem !== undefined && ta.meridiem !== 'unknown' && tb.meridiem === 'unknown' && tb.hour !== 12) {
      return { ...tb, meridiem: ta.meridiem };
    }
    return tb;
  };
  // In dated から-ranges an ambiguous hour reads as the small-hours/24h clock
  // ("1月15日4時から2月3日9時" is 04:00 → 09:00).
  const dawnify = (o: Operand): Operand =>
    o.kind === 'datetime' && o.time.meridiem === 'unknown'
      ? { ...o, time: { ...o.time, meridiem: 'am' } }
      : o;

  if (A.kind === 'time' && B.kind === 'time') {
    expr = { op: 'between', start: timeLit(A.time), end: timeLit(shareMeridiem(A.time, B.time)) };
    role = 'time';
  } else if (A.kind === 'datetime' && B.kind === 'time') {
    expr = {
      op: 'intersect',
      parts: [A.dateExpr, { op: 'between', start: timeLit(A.time), end: timeLit(shareMeridiem(A.time, B.time)) }],
    };
  } else if (A.kind === 'datetime' && B.kind === 'datetime') {
    expr = { op: 'between', start: operandExpr(dawnify(A)), end: operandExpr(dawnify(B)) };
  } else if (A.kind === 'datetime' || B.kind === 'datetime') {
    expr = { op: 'between', start: operandExpr(A), end: operandExpr(B) };
  } else if (A.kind === 'date' && B.kind === 'date') {
    // Scoped bare-day pair with unknown month ("来月の4日から23日"): the day
    // distance is known even though the month is contextual.
    if (
      B.date !== undefined && B.date.month === undefined && B.date.day !== undefined &&
      A.date === undefined && A.grain === 'day'
    ) {
      return undefined;
    }
    if (
      A.expr.op === 'intersect' && A.date?.day !== undefined &&
      B.date?.month === undefined && B.date?.day !== undefined && B.date.day > A.date.day
    ) {
      expr = { op: 'span', anchor: A.expr, amount: { days: B.date.day - A.date.day } };
    } else {
      // Year back-propagation: "11月から2017年2月まで" starts in 2016.
      let start = A.expr;
      if (
        A.expr.op === 'literal' && A.date?.month !== undefined && A.date.year === undefined &&
        B.date?.month !== undefined && B.date.year !== undefined
      ) {
        const year = A.date.month > B.date.month ? B.date.year - 1 : B.date.year;
        start = { op: 'literal', date: { ...A.date, year } };
      }
      // `between` treats non-point ends as exclusive at their start, which is
      // exactly the まで convention ("22日まで" runs to the 22nd's 00:00).
      expr = { op: 'between', start, end: B.expr };
    }
  } else if (A.kind === 'date' && B.kind === 'time') {
    expr = { op: 'between', start: A.expr, end: timeLit(B.time) };
  } else if (A.kind === 'time' && B.kind === 'date') {
    return undefined;
  }
  if (!expr) return undefined;
  return { expr, consumed: at - i, confidence: 1, role };
};

/** Scoped weeks & nth weekdays as standalone matches. */
const ruleWeekOf: Rule = (tokens, i) => {
  const wo = readWeekOf(tokens, i);
  if (!wo) return undefined;
  return { expr: wo.expr, consumed: wo.consumed, confidence: 1, role: 'date' };
};

/** "<deictic day>[から|の] N units 前/後/以内" — offsets anchored on that day. */
const ruleRelDayOffset: Rule = (tokens, i) => {
  const d = readDeicticDay(tokens, i);
  if (!d) return undefined;
  let at = i + d.consumed;
  const kara = seq(tokens, at, 'から');
  if (kara !== undefined) at += kara;
  else if (w(tokens, at) === 'の') at += 1;
  else return undefined;
  const amt = readAmount(tokens, at);
  if (!amt) return undefined;
  at += amt.consumed;
  // "明日から3週間" with no 前/後 marker: the amount measures forward from
  // the named day.
  if (kara !== undefined && w(tokens, at) !== '前' && w(tokens, at) !== '後' && seq(tokens, at, '以内') === undefined) {
    return {
      expr: offsetExpr(d.expr, amt.amount, 1, amt.smallest),
      consumed: at - i,
      confidence: 0.9,
      role: 'date',
    };
  }
  const within = seq(tokens, at, '以内');
  if (within !== undefined) {
    return {
      expr: { op: 'span', anchor: d.expr, amount: amt.amount, ...(amt.business ? { business: true } : {}) },
      consumed: at + within - i,
      confidence: 1,
      role: 'date',
    };
  }
  const suffix = w(tokens, at);
  if (suffix !== '前' && suffix !== '後') return undefined;
  return {
    expr: offsetExpr(d.expr, amt.amount, suffix === '後' ? 1 : -1, amt.smallest),
    consumed: at + 1 - i,
    confidence: 1,
    role: 'date',
  };
};

/** Calendar dates: 2019年1月4日 · 4月22日 · 12日 · 平成13年 · 1990年代 · 15世紀. */
const ruleDate: Rule = (tokens, i) => {
  const n = readInt(tokens, i);
  if (n) {
    const century = seq(tokens, i + n.consumed, '世紀');
    if (century !== undefined && n.value >= 1 && n.value <= 21) {
      return {
        expr: {
          op: 'span',
          anchor: { op: 'literal', date: { year: (n.value - 1) * 100 } },
          amount: { years: 100 },
        },
        consumed: n.consumed + century,
        confidence: 1,
        role: 'date',
      };
    }
    const decade = seq(tokens, i + n.consumed, '年代');
    if (decade !== undefined && n.value >= 1000 && n.value <= 2999 && n.value % 10 === 0) {
      return {
        expr: { op: 'span', anchor: { op: 'literal', date: { year: n.value } }, amount: { years: 10 } },
        consumed: n.consumed + decade,
        confidence: 1,
        role: 'date',
      };
    }
  }
  const d = readDateCore(tokens, i);
  if (!d) return undefined;
  return { expr: { op: 'literal', date: d.date }, consumed: d.consumed, confidence: 1, role: 'date' };
};

/** N-unit amounts: durations, ago/in offsets, and windows (今後/過去/ここ…). */
const ruleNUnit: Rule = (tokens, i) => {
  let at = i;
  let mode: 1 | -1 | undefined;
  let afterMode = false;
  let forceDuration = false;
  const prefixes: [string, () => void][] = [
    ['今後', () => { mode = 1; }],
    ['過去の', () => { mode = -1; }],
    ['過去', () => { mode = -1; }],
    ['これから', () => { mode = 1; }],
    ['ここ', () => { mode = -1; }],
    ['この', () => { mode = -1; }],
    ['向こう', () => { mode = 1; }],
    ['次の', () => { mode = 1; }],
    ['前の', () => { mode = -1; }],
    ['まる', () => { forceDuration = true; }],
    ['後', () => { afterMode = true; }],
  ];
  for (const [prefix, apply] of prefixes) {
    const c = seq(tokens, at, prefix);
    if (c !== undefined) {
      apply();
      at += c;
      break;
    }
  }
  const amt = readAmount(tokens, at);
  if (!amt) return undefined;
  at += amt.consumed;

  const spanExpr = (sign: 1 | -1): TimeExpr => ({
    op: 'span',
    anchor: NOW,
    amount: signedAmount(amt.amount, sign),
    ...(amt.business ? { business: true } : {}),
  });
  const role: RuleMatch['role'] = isSubDay(amt.smallest) ? 'datetime' : 'date';

  if (afterMode) {
    // 後N分で = in N minutes (point); 後N分間 = the coming N minutes (window).
    if (w(tokens, at) === 'で') {
      return { expr: offsetExpr(NOW, amt.amount, 1, amt.smallest), consumed: at + 1 - i, confidence: 1, role };
    }
    return { expr: spanExpr(1), consumed: at - i, confidence: 1, role };
  }
  if (mode !== undefined) {
    return { expr: spanExpr(mode), consumed: at - i, confidence: 1, role };
  }

  const within = seq(tokens, at, '以内');
  if (within !== undefined) {
    return { expr: spanExpr(1), consumed: at + within - i, confidence: 1, role };
  }
  const orMore = seq(tokens, at, '以上');
  const suffix = w(tokens, at);
  if (orMore === undefined && (suffix === '前' || suffix === '後' || suffix === 'で')) {
    const sign = suffix === '前' ? -1 : 1;
    return {
      expr: offsetExpr(NOW, amt.amount, sign, amt.smallest),
      consumed: at + 1 - i,
      confidence: 1,
      role: 'datetime',
    };
  }
  // Plain duration. Bare "N日" reads as a calendar day-of-month, except the
  // idiomatic 一日 / まる1日 ("a whole day").
  if (amt.bareDay && !forceDuration && !amt.kanjiOneDay) return undefined;
  return {
    expr: { op: 'amount', amount: amt.amount },
    consumed: (orMore !== undefined ? at + orMore : at) - i,
    confidence: 0.95,
    role: 'duration',
  };
};

/** Halves & edges: 年末 · 今月初め · 2018年の前半 · 今週の終わり · 11月半ば. */
const rulePartOf: Rule = (tokens, i) => {
  // 年初来 — year-to-date.
  const ytd = seq(tokens, i, '年初来');
  if (ytd !== undefined) {
    return {
      expr: {
        op: 'between',
        start: { op: 'snap', base: NOW, unit: 'year', edge: 'start' },
        end: { op: 'snap', base: NOW, unit: 'day', edge: 'start' },
      },
      consumed: ytd,
      confidence: 1,
      role: 'date',
    };
  }

  let base: { expr: TimeExpr; unit: Unit; consumed: number } | undefined;
  const du = readDeicticUnit(tokens, i);
  if (du) base = du;
  if (!base) {
    const one = seq(tokens, i, '一日');
    if (one !== undefined) base = { expr: snapNow('day'), unit: 'day', consumed: one };
  }
  if (!base) {
    const d = readDateCore(tokens, i);
    if (d && d.grain !== 'day') {
      base = { expr: { op: 'literal', date: d.date }, unit: d.grain, consumed: d.consumed };
    }
  }
  if (!base) {
    const wd = readWeekdayName(tokens, i);
    if (wd) {
      base = {
        expr: { op: 'seek', base: NOW, dir: 'nearest', target: { kind: 'weekday', weekday: wd.weekday } },
        unit: 'day',
        consumed: wd.consumed,
      };
    }
  }
  if (!base) {
    const bare = w(tokens, i);
    if (bare === '年') base = { expr: snapNow('year'), unit: 'year', consumed: 1 };
    else if (bare === '月') base = { expr: snapNow('month'), unit: 'month', consumed: 1 };
    else if (bare === '週') base = { expr: snapNow('week'), unit: 'week', consumed: 1 };
  }
  if (!base) return undefined;

  let at = i + base.consumed;
  if (w(tokens, at) === 'の') at += 1;

  const startPoint: TimeExpr = { op: 'snap', base: base.expr, unit: base.unit, edge: 'start' };
  const endPoint: TimeExpr = { op: 'snap', base: base.expr, unit: base.unit, edge: 'end' };
  const midPoint: TimeExpr =
    base.unit === 'year'
      ? { op: 'offset', base: startPoint, amount: 6, unit: 'month' }
      : base.unit === 'month'
        ? { op: 'offset', base: startPoint, amount: 15, unit: 'day' }
        : base.unit === 'week'
          ? { op: 'offset', base: startPoint, amount: 3, unit: 'day' }
          : { op: 'offset', base: startPoint, amount: 12, unit: 'hour' };
  const firstHalf: TimeExpr = { op: 'between', start: startPoint, end: midPoint };
  const secondHalf: TimeExpr = { op: 'between', start: midPoint, end: endPoint };

  const suffixes: [string, () => TimeExpr | undefined][] = [
    ['早い時間', () => (base!.unit === 'day' ? firstHalf : undefined)],
    ['早く', () => firstHalf],
    ['終わりごろ', () => (base!.unit === 'day' ? { op: 'snap', base: base!.expr, unit: 'day', edge: 'end' } : secondHalf)],
    ['終わり', () => (base!.unit === 'day' ? { op: 'snap', base: base!.expr, unit: 'day', edge: 'end' } : secondHalf)],
    ['初めごろ', () => firstHalf],
    ['初め', () => firstHalf],
    ['始め', () => firstHalf],
    ['前半', () => firstHalf],
    ['後半', () => secondHalf],
    ['半ば', () => ({ ...base!.expr, mod: 'mid' })],
    ['末', () => (base!.unit === 'week' || base!.unit === 'day' ? undefined : secondHalf)],
  ];
  for (const [suffix, build] of suffixes) {
    const c = seq(tokens, at, suffix);
    if (c === undefined) continue;
    const expr = build();
    if (!expr) return undefined;
    return { expr, consumed: at + c - i, confidence: 1, role: 'date' };
  }
  return undefined;
};

/** Deictic days/weeks/months/years and day-period compounds (今晩, 昨夜…). */
const ruleDeictic: Rule = (tokens, i) => {
  const specials: [string, TimeExpr, RuleMatch['role']][] = [
    ['明日中', { op: 'snap', base: snapOffset(1, 'day'), unit: 'day', edge: 'end' }, 'date'],
    ['今日中', { op: 'snap', base: snapNow('day'), unit: 'day', edge: 'end' }, 'date'],
    ['今朝', dayPeriodOn(0, 'morning'), 'datetime'],
    ['今晩', dayPeriodOn(0, 'evening'), 'datetime'],
    ['今夜', dayPeriodOn(0, 'night'), 'datetime'],
    ['昨晩', dayPeriodOn(-1, 'evening'), 'datetime'],
    ['昨夜', dayPeriodOn(-1, 'night'), 'datetime'],
    ['明晩', dayPeriodOn(1, 'evening'), 'datetime'],
    ['ひと月', snapNow('month'), 'date'],
    ['最近', snapNow('day'), 'date'],
    ['現在', NOW, 'datetime'],
  ];
  for (const [s, expr, role] of specials) {
    const c = seq(tokens, i, s);
    if (c !== undefined) return { expr, consumed: c, confidence: 1, role };
  }
  const dd = readDeicticDay(tokens, i);
  if (dd) return { expr: dd.expr, consumed: dd.consumed, confidence: 1, role: 'date' };
  const du = readDeicticUnit(tokens, i);
  if (du) return { expr: du.expr, consumed: du.consumed, confidence: 1, role: 'date' };
  // 年間/月間/週間 as "this year/month/week" nouns — but never after a number
  // ("5年間" is a duration).
  const prev = tokens[i - 1];
  const prevNumeric =
    prev?.type === 'number' ||
    (prev?.type === 'word' &&
      (KDIGIT[prev.value] !== undefined || KMULT[prev.value] !== undefined || prev.value === '数' || prev.value === '半'));
  if (!prevNumeric) {
    for (const [s, unit] of [['年間', 'year'], ['月間', 'month'], ['週間', 'week']] as [string, Unit][]) {
      const c = seq(tokens, i, s);
      if (c !== undefined) return { expr: snapNow(unit), consumed: c, confidence: 0.8, role: 'date' };
    }
  }
  if (w(tokens, i) === '今') return { expr: NOW, consumed: 1, confidence: 0.9, role: 'datetime' };
  return undefined;
};

/** 週末 (weekend), optionally prefixed: 今週末 / 来週末 / 先週末 / その週末. */
const ruleWeekend: Rule = (tokens, i) => {
  let at = i;
  let dir: 'next' | 'prev' | 'nearest' = 'nearest';
  // 今週末 = 今 + 週末 (single-char prefix), unlike 今週の月曜日.
  for (const [prefix, d] of [['来', 'next'], ['先', 'prev'], ['今', 'nearest'], ['この', 'nearest'], ['その', 'nearest']] as [string, 'next' | 'prev' | 'nearest'][]) {
    const c = seq(tokens, at, prefix);
    if (c !== undefined) {
      dir = d;
      at += c;
      break;
    }
  }
  const wk = seq(tokens, at, '週末');
  if (wk === undefined) return undefined;
  return {
    expr: {
      op: 'span',
      anchor: { op: 'seek', base: NOW, dir, target: { kind: 'weekday', weekday: 'sat' } },
      amount: { days: 2 },
    },
    consumed: at + wk - i,
    confidence: 1,
    role: 'date',
  };
};

/** Weekdays: 月曜日 · 来週の月曜日 · 次の金曜日 · 日曜日の終わり. */
const ruleWeekday: Rule = (tokens, i) => {
  let at = i;
  let base: TimeExpr | undefined;
  let dir: 'next' | 'prev' | 'nearest' = 'nearest';
  const weekPrefixes: [string, TimeExpr][] = [
    ['再来週', snapOffset(2, 'week')],
    ['来週', snapOffset(1, 'week')],
    ['今週', snapNow('week')],
    ['先週', snapOffset(-1, 'week')],
    ['翌週', snapOffset(1, 'week')],
  ];
  for (const [prefix, expr] of weekPrefixes) {
    const c = seq(tokens, at, prefix);
    if (c !== undefined) {
      base = expr;
      at += c;
      break;
    }
  }
  if (!base) {
    const next = seq(tokens, at, '次の');
    if (next !== undefined) {
      dir = 'next';
      at += next;
    } else {
      const prevSeq = seq(tokens, at, '前の');
      if (prevSeq !== undefined) {
        dir = 'prev';
        at += prevSeq;
      } else {
        const sono = seq(tokens, at, 'その');
        if (sono !== undefined) at += sono;
      }
    }
  }
  if (base && w(tokens, at) === 'の') at += 1;
  const wd = readWeekdayName(tokens, at);
  if (!wd) return undefined;
  at += wd.consumed;
  let expr: TimeExpr = base
    ? { op: 'seek', base, dir: 'next', target: { kind: 'weekday', weekday: wd.weekday }, n: 1 }
    : { op: 'seek', base: NOW, dir, target: { kind: 'weekday', weekday: wd.weekday } };
  for (const suffix of ['の終わりごろ', 'の終わり']) {
    const c = seq(tokens, at, suffix);
    if (c !== undefined) {
      expr = { op: 'snap', base: expr, unit: 'day', edge: 'end' };
      at += c;
      break;
    }
  }
  return { expr, consumed: at - i, confidence: 1, role: 'date' };
};

/** Clock times: 午後3時 · 7時半 · 17時49分19秒 · 正午 · 真夜中 · 零時. */
const ruleClock: Rule = (tokens, i) => {
  const t = readClock(tokens, i);
  if (!t) return undefined;
  return { expr: timeLit(t.time), consumed: t.consumed, confidence: 1, role: 'time' };
};

/** Day periods: 午前中 · 午前 · 午後 · 朝 · 夕方 · 夜 · 晩. */
const rulePeriod: Rule = (tokens, i) => {
  const periods: [string, DayPeriod][] = [
    ['午前中', 'morning'], ['午前', 'morning'], ['午後', 'afternoon'],
    ['朝', 'morning'], ['夕方', 'evening'], ['深夜', 'night'],
    ['夜', 'night'], ['晩', 'evening'],
  ];
  for (const [s, period] of periods) {
    const c = seq(tokens, i, s);
    if (c !== undefined) {
      return { expr: { op: 'literal', dayPeriod: period }, consumed: c, confidence: 0.7, role: 'time' };
    }
  }
  return undefined;
};

/** Fixed dates & other one-offs. */
const ruleMisc: Rule = (tokens, i) => {
  const entries: [string, TimeExpr, RuleMatch['role']][] = [
    ['独立記念日', { op: 'holiday', name: 'independence-day' }, 'date'],
    ['大晦日', { op: 'literal', date: { month: 12, day: 31 } }, 'date'],
    ['元旦', { op: 'literal', date: { month: 1, day: 1 } }, 'date'],
    ['元日', { op: 'literal', date: { month: 1, day: 1 } }, 'date'],
    ['別の日', { op: 'amount', amount: { days: 1 } }, 'duration'],
  ];
  for (const [s, expr, role] of entries) {
    const c = seq(tokens, i, s);
    if (c !== undefined) return { expr, consumed: c, confidence: 1, role };
  }
  return undefined;
};

/** Numeric date tokens: 29/2 · 29/2/2020 (day-first). */
const ruleNumdate: Rule = (tokens, i, ctx) => {
  const t = tokens[i];
  if (t?.type !== 'numdate') return undefined;
  const p = t.parts;
  let date: PartialDate | undefined;
  if (p.length === 3) {
    if (p[0]! > 31) date = { year: p[0]!, month: p[1]!, day: p[2]! };
    else if (p[2]! > 31) {
      date = p[0]! > 12 ? { day: p[0]!, month: p[1]!, year: p[2]! } : ctx.dateOrder === 'MDY'
        ? { month: p[0]!, day: p[1]!, year: p[2]! }
        : { day: p[0]!, month: p[1]!, year: p[2]! };
    }
  } else if (p.length === 2) {
    date = p[0]! > 12 ? { day: p[0]!, month: p[1]! } : { month: p[0]!, day: p[1]! };
  }
  if (!date || (date.month !== undefined && (date.month < 1 || date.month > 12))) return undefined;
  return { expr: { op: 'literal', date }, consumed: 1, confidence: 0.9, role: 'date' };
};

/** ASCII compounds the tokenizer keeps whole: 17:55:23-18:33:02, 2019/2/28-2019/3/1, 2/28-3/1. */
const ruleAsciiRange: Rule = (tokens, i) => {
  const v = w(tokens, i);
  if (v === undefined) return undefined;
  let m = v.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?-(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (m) {
    const mk = (h: string, min: string, s: string | undefined): TimeExpr => {
      const time: PartialTime = { hour: Number(h), minute: Number(min) };
      if (s !== undefined) time.second = Number(s);
      if (time.hour! >= 1 && time.hour! <= 12) time.meridiem = 'unknown';
      return timeLit(time);
    };
    return {
      expr: { op: 'between', start: mk(m[1]!, m[2]!, m[3]), end: mk(m[4]!, m[5]!, m[6]) },
      consumed: 1,
      confidence: 1,
      role: 'time',
    };
  }
  m = v.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})-(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (m) {
    return {
      expr: {
        op: 'between',
        start: { op: 'literal', date: { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) } },
        end: { op: 'literal', date: { year: Number(m[4]), month: Number(m[5]), day: Number(m[6]) } },
      },
      consumed: 1,
      confidence: 1,
      role: 'date',
    };
  }
  m = v.match(/^(\d{1,2})\/(\d{1,2})-(\d{1,2})\/(\d{1,2})$/);
  if (m) {
    const mk = (a: number, b: number): PartialDate => (a > 12 ? { day: a, month: b } : { month: a, day: b });
    return {
      expr: {
        op: 'between',
        start: { op: 'literal', date: mk(Number(m[1]), Number(m[2])) },
        end: { op: 'literal', date: mk(Number(m[3]), Number(m[4])) },
      },
      consumed: 1,
      confidence: 1,
      role: 'date',
    };
  }
  return undefined;
};

/** A lone 4-digit year ("2019"). */
const ruleBareYear: Rule = (tokens, i) => {
  const t = tokens[i];
  if (t?.type !== 'number' || t.ordinal || t.value < 1500 || t.value > 2199) return undefined;
  return { expr: { op: 'literal', date: { year: t.value } }, consumed: 1, confidence: 0.7, role: 'date' };
};

export const JA_RULE_ENTRIES: readonly { name: string; rule: Rule }[] = [
  { name: 'ja-range', rule: ruleRange },
  { name: 'ja-week-of', rule: ruleWeekOf },
  { name: 'ja-rel-day-offset', rule: ruleRelDayOffset },
  { name: 'ja-date', rule: ruleDate },
  { name: 'ja-n-unit', rule: ruleNUnit },
  { name: 'ja-part-of', rule: rulePartOf },
  { name: 'ja-deictic', rule: ruleDeictic },
  { name: 'ja-weekend', rule: ruleWeekend },
  { name: 'ja-weekday', rule: ruleWeekday },
  { name: 'ja-clock', rule: ruleClock },
  { name: 'ja-period', rule: rulePeriod },
  { name: 'ja-misc', rule: ruleMisc },
  { name: 'ja-numdate', rule: ruleNumdate },
  { name: 'ja-ascii-range', rule: ruleAsciiRange },
  { name: 'ja-bare-year', rule: ruleBareYear },
];

/** Particles transparent between merged date & time parts ("明日の朝8時"). */
export const JA_CONNECTORS: string[] = ['の'];
