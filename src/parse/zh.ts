/**
 * Chinese (Simplified + common Traditional variants) rules. CJK text arrives
 * as per-character word tokens (see tokenizer); ASCII/fullwidth digit runs
 * arrive as number/clock tokens between them. Rules therefore match character
 * sequences with `seq`. Developed against
 * corpus/forward/imported-recognizers-zh.json (issue #13).
 */
import type { TimeContext } from '../context.js';
import type { PartialDate, PartialTime, TimeExpr, Unit, Weekday } from '../ir/types.js';
import type { Rule, RuleMatch } from './en.js';
import type { Token } from './tokenizer.js';

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

/** Match consecutive single-char word tokens spelling `s`; returns end index. */
function seq(tokens: Token[], i: number, s: string): number | undefined {
  let at = i;
  for (const c of s) {
    if (word(tokens[at]) !== c) return undefined;
    at += 1;
  }
  return at;
}

/** First phrase from `list` matching at i (list should be longest-first). */
function seqAny(tokens: Token[], i: number, list: readonly string[]): { end: number; text: string } | undefined {
  for (const s of list) {
    const end = seq(tokens, i, s);
    if (end !== undefined) return { end, text: s };
  }
  return undefined;
}

// --- numbers ---------------------------------------------------------------

const HAN_DIGIT: Record<string, number> = {
  零: 0, 〇: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 两: 2, 兩: 2,
};

interface NumRead {
  value: number;
  consumed: number;
  hanzi: boolean;
  /** For positional forms (ASCII "08", hanzi 零八/二零零四): digit count. */
  digitCount?: number;
}

/** Hanzi numeral: 十, 十五, 三十, 二十三, or positional digit runs 二零零四. */
function readHanNum(tokens: Token[], i: number): NumRead | undefined {
  const w0 = word(tokens[i]);
  if (w0 === '十') {
    const d1 = HAN_DIGIT[word(tokens[i + 1]) ?? ''];
    if (d1 !== undefined && d1 >= 1 && d1 <= 9) return { value: 10 + d1, consumed: 2, hanzi: true };
    return { value: 10, consumed: 1, hanzi: true };
  }
  const d0 = w0 !== undefined ? HAN_DIGIT[w0] : undefined;
  if (d0 === undefined) return undefined;
  if (word(tokens[i + 1]) === '十') {
    const d2 = HAN_DIGIT[word(tokens[i + 2]) ?? ''];
    if (d2 !== undefined && d2 >= 1 && d2 <= 9) return { value: d0 * 10 + d2, consumed: 3, hanzi: true };
    return { value: d0 * 10, consumed: 2, hanzi: true };
  }
  // Positional digit run (year style): 二零零四 → 2004, 零八 → 8 (2 digits).
  const digits = [d0];
  let at = i + 1;
  for (;;) {
    const w = word(tokens[at]);
    const d = w !== undefined ? HAN_DIGIT[w] : undefined;
    if (d === undefined || w === '两' || w === '兩') break;
    digits.push(d);
    at += 1;
  }
  if (digits.length >= 2) {
    return {
      value: digits.reduce((a, b) => a * 10 + b, 0),
      consumed: digits.length,
      hanzi: true,
      digitCount: digits.length,
    };
  }
  return { value: d0, consumed: 1, hanzi: true };
}

/** ASCII number token or hanzi numeral. */
function readNum(tokens: Token[], i: number): NumRead | undefined {
  const t = tokens[i];
  if (t?.type === 'number' && !t.ordinal) {
    return { value: t.value, consumed: 1, hanzi: false, digitCount: t.end - t.start };
  }
  // A range dash glued to the following number ("6月1日-6月30日" → word "-6")
  // reads as the plain number; the dash is the (absorbed) range connector.
  const w = word(t);
  const dashed = w?.match(/^[-~](\d{1,4})$/);
  if (dashed) return { value: Number(dashed[1]), consumed: 1, hanzi: false, digitCount: dashed[1]!.length };
  return readHanNum(tokens, i);
}

function expandYear2(v: number): number {
  return v >= 70 ? 1900 + v : 2000 + v;
}

// --- calendar date reading -------------------------------------------------

/** Regnal eras seen in the corpus: era + N年 → gregorian year (era start + N − 1). */
const ERAS: readonly [string, number][] = [
  ['神龙', 705], ['神龍', 705],
  ['康熙', 1662],
  ['雍正', 1723],
  ['民国', 1912], ['民國', 1912],
];

const YEAR_WORDS = ['年'];
const DAY_SUFFIXES = ['日', '号', '號'];

/** Year (incl. era years and positional hanzi) ending with 年; consumed includes 年. */
function readYearMarked(tokens: Token[], i: number): { year: number; consumed: number } | undefined {
  for (const [era, start] of ERAS) {
    const afterEra = seq(tokens, i, era);
    if (afterEra === undefined) continue;
    let n: NumRead | undefined;
    if (word(tokens[afterEra]) === '元') n = { value: 1, consumed: 1, hanzi: true };
    else n = readNum(tokens, afterEra);
    if (!n || n.value < 1 || n.value > 99) continue;
    const end = seqAny(tokens, afterEra + n.consumed, YEAR_WORDS);
    if (!end) continue;
    return { year: start + n.value - 1, consumed: end.end - i };
  }
  const n = readNum(tokens, i);
  if (!n) return undefined;
  const end = seqAny(tokens, i + n.consumed, YEAR_WORDS);
  if (!end) return undefined;
  // Years need at least two written digits: 2016年, 18年, 零八年, 二零零四年.
  // Plain counting numerals (一年, 二十年) are durations, not years.
  if (n.digitCount === undefined || n.digitCount < 2) return undefined;
  if (n.digitCount <= 2 && n.value < 100) return { year: expandYear2(n.value), consumed: end.end - i };
  if (n.value >= 1000 && n.value <= 9999) return { year: n.value, consumed: end.end - i };
  return undefined;
}

/** Month number (1-12, 正 = 1) followed by 月. */
function readMonthMarked(tokens: Token[], i: number): { month: number; consumed: number } | undefined {
  if (word(tokens[i]) === '正' && word(tokens[i + 1]) === '月') return { month: 1, consumed: 2 };
  const n = readNum(tokens, i);
  if (!n || n.value < 1 || n.value > 12) return undefined;
  if (word(tokens[i + n.consumed]) !== '月') return undefined;
  return { month: n.value, consumed: n.consumed + 1 };
}

/**
 * Day of month. Suffixed (10日 / 19号) always; hanzi numerals may be bare
 * (八月十五, 正月三十) or 初-prefixed lunar style (初一).
 */
function readDay(
  tokens: Token[],
  i: number,
  requireSuffix: boolean,
): { day: number; consumed: number } | undefined {
  let at = i;
  let chu = false;
  if (word(tokens[at]) === '初') {
    chu = true;
    at += 1;
  }
  const n = readNum(tokens, at);
  if (!n || n.value < 1 || n.value > 31) return undefined;
  const suffix = seqAny(tokens, at + n.consumed, DAY_SUFFIXES);
  if (suffix) return { day: n.value, consumed: suffix.end - i };
  if (chu) return { day: n.value, consumed: at + n.consumed - i };
  if (!requireSuffix && n.hanzi) return { day: n.value, consumed: at + n.consumed - i };
  return undefined;
}

interface DateRead {
  date: PartialDate;
  consumed: number;
}

/** [农历] [year年] [M月 [D日]] | [year年] 大年三十 | D日-alone. */
function readDateParts(tokens: Token[], i: number): DateRead | undefined {
  let at = i;
  const date: PartialDate = {};
  const lunar = seqAny(tokens, at, ['农历', '農曆']);
  if (lunar) at = lunar.end;
  const y = readYearMarked(tokens, at);
  if (y) {
    date.year = y.year;
    at += y.consumed;
  }
  const nye = seq(tokens, at, '大年三十');
  if (nye !== undefined) {
    // Lunar new year's eve, mapped like Recognizers to month 1 day 30.
    return { date: { ...date, month: 1, day: 30 }, consumed: nye - i };
  }
  const m = readMonthMarked(tokens, at);
  if (m) {
    date.month = m.month;
    at += m.consumed;
    const d = readDay(tokens, at, false);
    if (d) {
      date.day = d.day;
      at += d.consumed;
    }
  } else if (date.year === undefined) {
    const d = readDay(tokens, at, true);
    if (!d) return undefined;
    date.day = d.day;
    at += d.consumed;
  }
  if (at === i || (lunar && at === lunar.end)) return undefined;
  return { date, consumed: at - i };
}

// --- clock reading ---------------------------------------------------------

type MerKind = 'am' | 'pm' | 'small-am' | 'noon' | 'midnight';
type PeriodName = 'morning' | 'afternoon' | 'evening' | 'night';

const TIME_PREFIXES: readonly { words: string; mer?: MerKind; period?: PeriodName }[] = [
  { words: '上午', mer: 'am', period: 'morning' },
  { words: '早上', mer: 'am', period: 'morning' },
  { words: '早晨', mer: 'am', period: 'morning' },
  { words: '清晨', mer: 'am', period: 'morning' },
  { words: '早间', mer: 'am', period: 'morning' },
  { words: '早間', mer: 'am', period: 'morning' },
  { words: '凌晨', mer: 'small-am', period: 'night' },
  { words: '中午', mer: 'noon' },
  { words: '正午', mer: 'noon' },
  { words: '下午', mer: 'pm', period: 'afternoon' },
  { words: '午后', mer: 'pm', period: 'afternoon' },
  { words: '午後', mer: 'pm', period: 'afternoon' },
  { words: '晚上', mer: 'pm', period: 'evening' },
  { words: '傍晚', mer: 'pm', period: 'evening' },
  { words: '晚间', mer: 'pm', period: 'evening' },
  { words: '晚間', mer: 'pm', period: 'evening' },
  { words: '夜里', mer: 'pm', period: 'night' },
  { words: '夜裡', mer: 'pm', period: 'night' },
  { words: '夜间', mer: 'pm', period: 'night' },
  { words: '深夜', mer: 'pm', period: 'night' },
  { words: '半夜', mer: 'midnight' },
  { words: '午夜', mer: 'midnight' },
];

function matchTimePrefix(
  tokens: Token[],
  i: number,
): { end: number; mer?: MerKind; period?: PeriodName } | undefined {
  for (const p of TIME_PREFIXES) {
    const end = seq(tokens, i, p.words);
    if (end !== undefined) {
      const out: { end: number; mer?: MerKind; period?: PeriodName } = { end };
      if (p.mer !== undefined) out.mer = p.mer;
      if (p.period !== undefined) out.period = p.period;
      return out;
    }
  }
  return undefined;
}

const AMPM_WORDS: Record<string, 'am' | 'pm'> = {
  'am': 'am', 'a.m': 'am', 'a.m.': 'am', 'a': 'am',
  'pm': 'pm', 'p.m': 'pm', 'p.m.': 'pm', 'p': 'pm',
};

const HOUR_MARKERS = ['点', '點', '时', '時'];

interface TimeRead {
  time: PartialTime;
  consumed: number;
}

/** A clock time: ASCII clock token [+ a.m./p.m. word] or N点/N时 forms. */
function readClock(tokens: Token[], i: number): TimeRead | undefined {
  const t = tokens[i];
  if (t?.type === 'clock') {
    let at = i + 1;
    let mer = t.meridiem;
    const w = word(tokens[at]);
    if (!mer && w !== undefined && AMPM_WORDS[w] !== undefined) {
      mer = AMPM_WORDS[w];
      at += 1;
    }
    const time: PartialTime = { hour: t.hour };
    if (t.explicitMinute) time.minute = t.minute;
    if (t.second !== undefined) time.second = t.second;
    if (mer) time.meridiem = mer;
    return { time, consumed: at - i };
  }
  const h = readNum(tokens, i);
  if (!h || h.value > 24 || !Number.isInteger(h.value)) return undefined;
  let at = i + h.consumed;
  if (seqAny(tokens, at, HOUR_MARKERS) === undefined) return undefined;
  at += 1;
  const time: PartialTime = { hour: h.value };
  if (word(tokens[at]) === '半') {
    time.minute = 30;
    at += 1;
  } else {
    const q = seqAny(tokens, at, ['一刻', '三刻', '二刻']);
    if (q) {
      time.minute = q.text === '一刻' ? 15 : q.text === '二刻' ? 30 : 45;
      at = q.end;
    } else if (word(tokens[at]) === '整') {
      time.minute = 0;
      at += 1;
    } else {
      const m = readNum(tokens, at);
      if (m && m.value <= 59 && Number.isInteger(m.value)) {
        let mAt = at + m.consumed;
        const isFen = word(tokens[mAt]) === '分';
        if (isFen) {
          mAt += 1;
          time.minute = m.value;
          const s = readNum(tokens, mAt);
          if (s && s.value <= 59 && word(tokens[mAt + s.consumed]) === '秒') {
            time.second = s.value;
            mAt += s.consumed + 1;
          }
          at = mAt;
        } else {
          // Bare trailing minutes: 九点二十 → 9:20.
          time.minute = m.value;
          at += m.consumed;
        }
      }
    }
  }
  return { time, consumed: at - i };
}

/** Apply a meridiem prefix to an hour reading, Recognizers-style. */
function applyMeridiem(time: PartialTime, mer: MerKind | undefined): PartialTime {
  const out: PartialTime = { ...time };
  const hour = out.hour ?? 0;
  if (out.meridiem !== undefined) return out;
  if (mer === undefined) {
    if (hour >= 1 && hour <= 12) out.meridiem = 'unknown';
    return out;
  }
  if (hour >= 13) return out; // already 24-hour
  if (mer === 'am') {
    if (hour >= 1 && hour <= 11) out.meridiem = 'am';
    // 上午12点 stays 12:00.
  } else if (mer === 'pm' || mer === 'noon') {
    if (hour >= 1 && hour <= 12) out.meridiem = 'pm';
  } else if (mer === 'small-am' || mer === 'midnight') {
    if (hour >= 1 && hour <= 11) out.meridiem = 'am';
  }
  return out;
}

/** [大约] [meridiem/period prefix] clock — the combined time reader. */
function readClockWithPrefix(
  tokens: Token[],
  i: number,
): { time: PartialTime; consumed: number; period?: PeriodName } | undefined {
  let at = i;
  const approx = seqAny(tokens, at, ['大约', '大約', '大概', '差不多']);
  if (approx) at = approx.end;
  const pfx = matchTimePrefix(tokens, at);
  const clockAt = pfx ? pfx.end : at;
  const clk = readClock(tokens, clockAt);
  if (!clk) return undefined;
  const time = applyMeridiem(clk.time, pfx?.mer);
  const out: { time: PartialTime; consumed: number; period?: PeriodName } = {
    time,
    consumed: clockAt + clk.consumed - i,
  };
  if (pfx?.period !== undefined) out.period = pfx.period;
  return out;
}

// --- deictic days / weeks / months / years ---------------------------------

const DEICTIC_DAYS: readonly [string, number][] = [
  ['大后天', 3], ['大後天', 3], ['大前天', -3],
  ['今天', 0], ['今日', 0],
  ['昨天', -1], ['昨日', -1],
  ['明天', 1], ['明日', 1],
  ['前天', -2],
  ['后天', 2], ['後天', 2],
];

const DEICTIC_DAY_PERIODS: readonly [string, number, PeriodName][] = [
  ['今晚', 0, 'evening'],
  ['明晚', 1, 'evening'],
  ['昨晚', -1, 'evening'],
  ['今晨', 0, 'morning'],
  ['今早', 0, 'morning'],
  ['明早', 1, 'morning'],
  ['明晨', 1, 'morning'],
  ['昨晨', -1, 'morning'],
];

function dayExprFor(delta: number): TimeExpr {
  return delta === 0 ? snapNow('day') : snapOffset(delta, 'day');
}

/** Deictic day for use in composites: returns delta + consumed. */
function readDeicticDay(tokens: Token[], i: number): { delta: number; consumed: number } | undefined {
  for (const [s, delta] of DEICTIC_DAYS) {
    const end = seq(tokens, i, s);
    if (end !== undefined) return { delta, consumed: end - i };
  }
  return undefined;
}

const WEEKDAY_CHARS: Record<string, Weekday> = {
  一: 'mon', 二: 'tue', 三: 'wed', 四: 'thu', 五: 'fri', 六: 'sat', 日: 'sun', 天: 'sun',
};

const WEEK_MARKERS = ['星期', '礼拜', '禮拜', '周', '週'];

function weekendOf(delta: number): TimeExpr {
  if (delta === 0) {
    return {
      op: 'span',
      anchor: { op: 'seek', base: NOW, dir: 'nearest', target: { kind: 'weekday', weekday: 'sat' } },
      amount: { days: 2 },
    };
  }
  return {
    op: 'span',
    anchor: {
      op: 'seek',
      base: snapOffset(delta, 'week'),
      dir: 'next',
      target: { kind: 'weekday', weekday: 'sat' },
      n: 1,
    },
    amount: { days: 2 },
  };
}

// --- duration units --------------------------------------------------------

const MULTI_UNITS: readonly [string, Unit][] = [
  ['星期', 'week'],
  ['小时', 'hour'], ['小時', 'hour'],
  ['钟头', 'hour'], ['鐘頭', 'hour'],
  ['分钟', 'minute'], ['分鐘', 'minute'],
  ['秒钟', 'second'], ['秒鐘', 'second'],
];

/** [个] unit-word. 月 requires the 个 classifier (三月 is March, 三个月 is 3 months). */
function readDurUnit(tokens: Token[], i: number): { unit: Unit; consumed: number } | undefined {
  let at = i;
  let ge = false;
  const w0 = word(tokens[at]);
  if (w0 === '个' || w0 === '個') {
    ge = true;
    at += 1;
  }
  let unit: Unit | undefined;
  let end = at;
  for (const [s, u] of MULTI_UNITS) {
    const e = seq(tokens, at, s);
    if (e !== undefined) {
      unit = u;
      end = e;
      break;
    }
  }
  if (unit === undefined) {
    const c = word(tokens[at]);
    if (c === '年') unit = 'year';
    else if (c === '天') unit = 'day';
    else if (c === '周' || c === '週') unit = 'week';
    else if (c === '时' || c === '時') unit = 'hour';
    else if (c === '秒') unit = 'second';
    else if ((c === '月') && ge) unit = 'month';
    if (unit !== undefined) end = at + 1;
  }
  if (unit === undefined) return undefined;
  // "18周岁" is an age, not 18 weeks.
  const after = word(tokens[end]);
  if (after === '岁' || after === '歲') return undefined;
  return { unit, consumed: end - i };
}

function unitField(unit: Unit): keyof Record<string, number> {
  return `${unit}s`;
}

function amountFor(unit: Unit, n: number): Record<string, number> {
  return { [unitField(unit)]: n };
}

const SUB_DAY = new Set<Unit>(['second', 'minute', 'hour']);

// === rules =================================================================

/** 今天/昨天/明天/前天/后天…, 最近, and day+period compounds 今晚/昨晚/今早. */
const ruleDeicticDay: Rule = (tokens, i) => {
  for (const [s, delta, period] of DEICTIC_DAY_PERIODS) {
    const end = seq(tokens, i, s);
    if (end !== undefined) {
      return {
        expr: { op: 'intersect', parts: [dayExprFor(delta), { op: 'literal', dayPeriod: period }] },
        consumed: end - i,
        confidence: 1,
        role: 'datetime',
      };
    }
  }
  const d = readDeicticDay(tokens, i);
  if (d) return { expr: dayExprFor(d.delta), consumed: d.consumed, confidence: 1, role: 'date' };
  const recent = seqAny(tokens, i, ['最近']);
  if (recent) return { expr: snapNow('day'), consumed: recent.end - i, confidence: 0.9, role: 'date' };
  return undefined;
};

/** 今年 / 去年 / 明年 / 前年 / 后年. */
const ruleDeicticYear: Rule = (tokens, i) => {
  const YEARS: readonly [string, number][] = [
    ['今年', 0], ['去年', -1], ['明年', 1], ['前年', -2], ['后年', 2], ['後年', 2],
  ];
  for (const [s, delta] of YEARS) {
    const end = seq(tokens, i, s);
    if (end !== undefined) {
      // Standalone 今年 reads as year-to-date (Recognizers convention);
      // scoped uses (今年的最后3周, 今年下半年) go through readYearScope.
      const expr: TimeExpr =
        delta === 0
          ? {
              op: 'between',
              start: { op: 'snap', base: NOW, unit: 'year', edge: 'start' },
              end: { op: 'snap', base: NOW, unit: 'day', edge: 'start' },
            }
          : snapOffset(delta, 'year');
      return { expr, consumed: end - i, confidence: 1, role: 'date' };
    }
  }
  return undefined;
};

/** Deictic year as a sub-reader for scoped rules. */
function readYearScope(
  tokens: Token[],
  i: number,
): { expr: TimeExpr; year?: number; consumed: number } | undefined {
  const y = readYearMarked(tokens, i);
  if (y) return { expr: { op: 'literal', date: { year: y.year } }, year: y.year, consumed: y.consumed };
  const YEARS: readonly [string, number][] = [
    ['今年', 0], ['去年', -1], ['明年', 1], ['前年', -2], ['后年', 2], ['後年', 2],
  ];
  for (const [s, delta] of YEARS) {
    const end = seq(tokens, i, s);
    if (end !== undefined) {
      return { expr: delta === 0 ? snapNow('year') : snapOffset(delta, 'year'), consumed: end - i };
    }
  }
  return undefined;
}

/**
 * (上|下)+ / 这 / 本 [个] 周|星期|月|小时… with optional weekday / 末 tail:
 * 上周三, 下下周末, 这个月, 上个小时, 本月十日.
 */
const ruleRelPeriod: Rule = (tokens, i) => {
  let at = i;
  let delta = 0;
  let matched = false;
  const first = word(tokens[at]);
  if (first === '上' || first === '下') {
    const sign = first === '上' ? -1 : 1;
    while (word(tokens[at]) === first) {
      delta += sign;
      at += 1;
      matched = true;
    }
  } else if (first === '这' || first === '這' || first === '本') {
    at += 1;
    matched = true;
  }
  if (!matched) return undefined;
  const ge = word(tokens[at]);
  if (ge === '个' || ge === '個') at += 1;

  // Week nouns, with optional weekday or 末 suffix.
  const wk = seqAny(tokens, at, WEEK_MARKERS);
  if (wk) {
    at = wk.end;
    if (word(tokens[at]) === '末') {
      return { expr: weekendOf(delta), consumed: at + 1 - i, confidence: 1, role: 'date' };
    }
    const wdChar = word(tokens[at]);
    const wd = wdChar !== undefined ? WEEKDAY_CHARS[wdChar] : undefined;
    if (wd !== undefined) {
      const base = delta === 0 ? snapNow('week') : snapOffset(delta, 'week');
      return {
        expr: { op: 'seek', base, dir: 'next', target: { kind: 'weekday', weekday: wd }, n: 1 },
        consumed: at + 1 - i,
        confidence: 1,
        role: 'date',
      };
    }
    return {
      expr: delta === 0 ? snapNow('week') : snapOffset(delta, 'week'),
      consumed: at - i,
      confidence: 1,
      role: 'date',
    };
  }

  const c = word(tokens[at]);
  if (c === '月') {
    at += 1;
    const monthExpr = delta === 0 ? snapNow('month') : snapOffset(delta, 'month');
    // 本月十日 — a day within the relative month.
    const d = readDay(tokens, at, true);
    if (d) {
      return {
        expr: { op: 'intersect', parts: [monthExpr, { op: 'literal', date: { day: d.day } }] },
        consumed: at + d.consumed - i,
        confidence: 1,
        role: 'date',
      };
    }
    return { expr: monthExpr, consumed: at - i, confidence: 1, role: 'date' };
  }
  if (c === '年') {
    return {
      expr: delta === 0 ? snapNow('year') : snapOffset(delta, 'year'),
      consumed: at + 1 - i,
      confidence: 0.9,
      role: 'date',
    };
  }
  const hour = seqAny(tokens, at, ['小时', '小時', '钟头', '鐘頭']);
  if (hour) {
    const expr: TimeExpr =
      delta === 0 ? snapNow('hour') : { op: 'span', anchor: NOW, amount: { hours: delta } };
    return { expr, consumed: hour.end - i, confidence: 1, role: 'datetime' };
  }
  const min = seqAny(tokens, at, ['分钟', '分鐘']);
  if (min) {
    const expr: TimeExpr =
      delta === 0 ? snapNow('minute') : { op: 'span', anchor: NOW, amount: { minutes: delta } };
    return { expr, consumed: min.end - i, confidence: 1, role: 'datetime' };
  }
  return undefined;
};

/** Bare 周末 / 週末. */
const ruleWeekend: Rule = (tokens, i) => {
  const m = seqAny(tokens, i, ['周末', '週末']);
  if (!m) return undefined;
  return { expr: weekendOf(0), consumed: m.end - i, confidence: 0.9, role: 'date' };
};

/** Bare weekday: 星期一 / 周三 / 禮拜五 / 星期天 → nearest (dual candidates). */
const ruleBareWeekday: Rule = (tokens, i) => {
  const mk = seqAny(tokens, i, WEEK_MARKERS);
  if (!mk) return undefined;
  const wdChar = word(tokens[mk.end]);
  const wd = wdChar !== undefined ? WEEKDAY_CHARS[wdChar] : undefined;
  if (wd === undefined) return undefined;
  return {
    expr: { op: 'seek', base: NOW, dir: 'nearest', target: { kind: 'weekday', weekday: wd } },
    consumed: mk.end + 1 - i,
    confidence: 0.9,
    role: 'date',
  };
};

/** Calendar dates: [农历] [Y年] [M月 [D日]], 29日, 正月三十, 康熙三年五月. */
const ruleDate: Rule = (tokens, i) => {
  const dp = readDateParts(tokens, i);
  if (!dp) return undefined;
  const conf =
    dp.date.day !== undefined ? (dp.date.month !== undefined ? 0.95 : 0.9)
    : dp.date.month !== undefined ? (dp.date.year !== undefined ? 0.95 : 0.8)
    : 0.95;
  return { expr: { op: 'literal', date: dp.date }, consumed: dp.consumed, confidence: conf, role: 'date' };
};

/** Numeric-date tokens: 2010/01/29 (YMD), 1/2/2020 (DMY), 12-11-10, 12/1. */
const ruleNumDate: Rule = (tokens, i) => {
  const t = tokens[i];
  if (t?.type !== 'numdate') return undefined;
  const date = numDateParts(t.parts);
  if (!date) return undefined;
  return { expr: { op: 'literal', date }, consumed: 1, confidence: 0.9, role: 'date' };
};

function numDateParts(parts: number[]): PartialDate | undefined {
  const valid = (d: PartialDate): PartialDate | undefined =>
    d.month !== undefined && d.month >= 1 && d.month <= 12 &&
    (d.day === undefined || (d.day >= 1 && d.day <= 31))
      ? d
      : undefined;
  if (parts.length === 3) {
    const [a, b, c] = parts as [number, number, number];
    if (a >= 1000) return valid({ year: a, month: b, day: c });
    if (c >= 1000) return valid({ year: c, month: b, day: a });
    if (a <= 99 && b <= 12 && c <= 31) return valid({ year: expandYear2(a), month: b, day: c });
    return undefined;
  }
  if (parts.length === 2) {
    const [a, b] = parts as [number, number];
    return valid({ month: a, day: b });
  }
  return undefined;
}

/** Bare 4-digit year (e.g. "= 2019"). */
const ruleBareYear: Rule = (tokens, i) => {
  const t = tokens[i];
  if (t?.type !== 'number' || t.ordinal || t.value < 1500 || t.value > 2199) return undefined;
  if (t.end - t.start !== 4) return undefined;
  return { expr: { op: 'literal', date: { year: t.value } }, consumed: 1, confidence: 0.7, role: 'date' };
};

/** Clock times & day periods: 下午5:00, 凌晨2点半, 15时20分, 上午, 晚上. */
const ruleClock: Rule = (tokens, i) => {
  const clk = readClockWithPrefix(tokens, i);
  if (clk) {
    return {
      expr: { op: 'literal', time: clk.time },
      consumed: clk.consumed,
      confidence: 1,
      role: 'time',
    };
  }
  // Prefix alone: 上午 → morning period; 中午 → 12:00; 半夜 → 00:00.
  let at = i;
  const approx = seqAny(tokens, at, ['大约', '大約', '大概', '差不多']);
  if (approx) at = approx.end;
  const pfx = matchTimePrefix(tokens, at);
  if (!pfx) return undefined;
  if (pfx.mer === 'noon') {
    return {
      expr: { op: 'literal', time: { hour: 12, minute: 0 } },
      consumed: pfx.end - i,
      confidence: 0.9,
      role: 'time',
    };
  }
  if (pfx.mer === 'midnight') {
    return {
      expr: { op: 'literal', time: { hour: 0, minute: 0 } },
      consumed: pfx.end - i,
      confidence: 0.9,
      role: 'time',
    };
  }
  if (pfx.period !== undefined) {
    return {
      expr: { op: 'literal', dayPeriod: pfx.period },
      consumed: pfx.end - i,
      confidence: 0.8,
      role: 'time',
    };
  }
  return undefined;
};

/** N单位前/后 (offsets): 5年前, 10分钟之前, 2小时后. Day+ snaps to the day. */
const ruleNAgoLater: Rule = (tokens, i) => {
  const n = readNum(tokens, i);
  if (!n || !Number.isInteger(n.value)) return undefined;
  const u = readDurUnit(tokens, i + n.consumed);
  if (!u) return undefined;
  const tailAt = i + n.consumed + u.consumed;
  const tail = seqAny(tokens, tailAt, ['之前', '以前', '之后', '之後', '以后', '以後', '前', '后', '後']);
  if (!tail) return undefined;
  const sign = tail.text.includes('前') ? -1 : 1;
  const shifted: TimeExpr = { op: 'offset', base: NOW, amount: sign * n.value, unit: u.unit };
  const expr: TimeExpr = SUB_DAY.has(u.unit) ? shifted : { op: 'snap', base: shifted, unit: 'day' };
  return { expr, consumed: tail.end - i, confidence: 1, role: 'datetime' };
};

/**
 * Prefixed spans: 前1周 / 后1年 / 过去十年 / 之前3小时 / 之后5分钟 / 还剩5分钟.
 * Day-and-coarser anchors at day boundaries (Recognizers convention).
 */
const rulePrefixSpan: Rule = (tokens, i) => {
  const pfx = seqAny(tokens, i, [
    '过去', '過去', '之前', '以前', '之后', '之後', '以后', '以後',
    '还剩下', '还剩', '还有', '還剩', '還有', '前', '后', '後',
  ]);
  if (!pfx) return undefined;
  const guarded = ['还剩下', '还剩', '还有', '還剩', '還有'].includes(pfx.text);
  const past = ['过去', '過去', '之前', '以前', '前'].includes(pfx.text);
  const n = readNum(tokens, pfx.end);
  if (!n || !Number.isInteger(n.value)) return undefined;
  const u = readDurUnit(tokens, pfx.end + n.consumed);
  if (!u) return undefined;
  const end = pfx.end + n.consumed + u.consumed;
  // 还剩8天20时 is a compound duration, not a span — leave it to the duration rule.
  if (guarded) {
    const next = tokens[end];
    if (next?.type === 'number') return undefined;
    const w = word(next);
    if (w !== undefined && (HAN_DIGIT[w] !== undefined || w === '又' || w === '半' || w === '十')) {
      return undefined;
    }
  }
  const sign = past ? -1 : 1;
  let anchor: TimeExpr;
  if (SUB_DAY.has(u.unit)) {
    anchor = NOW;
  } else if (past) {
    anchor = { op: 'snap', base: NOW, unit: 'day', edge: 'start' };
  } else {
    anchor = { op: 'snap', base: { op: 'offset', base: NOW, amount: 1, unit: 'day' }, unit: 'day', edge: 'start' };
  }
  return {
    expr: { op: 'span', anchor, amount: amountFor(u.unit, sign * n.value) },
    consumed: end - i,
    confidence: 0.95,
    role: SUB_DAY.has(u.unit) ? 'datetime' : 'date',
  };
};

/** Compound durations: 两年, 半个月, 三年半, 8天20小时, 一年又一个月21天. */
const ruleDuration: Rule = (tokens, i) => {
  const amount: Record<string, number> = {};
  let at = i;
  let segments = 0;
  for (;;) {
    let value: number | undefined;
    let numEnd = at;
    if (word(tokens[at]) === '半') {
      value = 0.5;
      numEnd = at + 1;
    } else {
      const n = readNum(tokens, at);
      if (n && Number.isInteger(n.value) && n.value >= 1) {
        value = n.value;
        numEnd = at + n.consumed;
      }
    }
    if (value === undefined) break;
    const u = readDurUnit(tokens, numEnd);
    if (!u) break;
    let segEnd = numEnd + u.consumed;
    if (word(tokens[segEnd]) === '半' && Number.isInteger(value)) {
      // 三年半 → 3.5 years.
      value += 0.5;
      segEnd += 1;
    }
    amount[unitField(u.unit)] = (amount[unitField(u.unit)] ?? 0) + value;
    segments += 1;
    at = segEnd;
    const conn = word(tokens[at]);
    if (conn === '又' || conn === '多' || conn === '余' || conn === '零') at += 1;
  }
  if (segments === 0) return undefined;
  return {
    expr: { op: 'amount', amount },
    consumed: at - i,
    confidence: 0.8,
    role: 'duration',
  };
};

/** Half periods: [year] 上半年/下半年, 上半月, 下半周, 上个半年. */
const ruleHalf: Rule = (tokens, i) => {
  let at = i;
  let baseYear: TimeExpr | undefined;
  const scope = readYearScope(tokens, at);
  if (scope) {
    baseYear = scope.expr;
    at = scope.consumed + i;
  }
  const half = seqAny(tokens, at, [
    '上半年', '前半年', '下半年', '后半年', '後半年',
    '上半月', '下半月', '上半周', '上半週', '下半周', '下半週',
    '上个半年', '上個半年',
  ]);
  if (!half) return undefined;
  const h = half.text;
  const consumed = half.end - i;
  const mk = (expr: TimeExpr): RuleMatch => ({ expr, consumed, confidence: 0.95, role: 'date' });

  if (h.endsWith('半年') && h.length === 3) {
    const base = baseYear ?? snapNow('year');
    const start: TimeExpr = { op: 'snap', base, unit: 'year', edge: 'start' };
    if (h.startsWith('上') || h.startsWith('前')) {
      return mk({ op: 'span', anchor: start, amount: { months: 6 } });
    }
    return mk({
      op: 'span',
      anchor: { op: 'offset', base: start, amount: 6, unit: 'month' },
      amount: { months: 6 },
    });
  }
  if (baseYear !== undefined) return undefined; // 2017年上半月 — not a thing
  if (h === '上个半年' || h === '上個半年') {
    return mk({
      op: 'span',
      anchor: { op: 'snap', base: NOW, unit: 'year', edge: 'start' },
      amount: { months: 6 },
    });
  }
  if (h === '上半月') {
    return mk({
      op: 'span',
      anchor: { op: 'snap', base: NOW, unit: 'month', edge: 'start' },
      amount: { days: 15 },
    });
  }
  if (h === '下半月') {
    return mk({
      op: 'between',
      start: { op: 'offset', base: { op: 'snap', base: NOW, unit: 'month', edge: 'start' }, amount: 15, unit: 'day' },
      end: { op: 'snap', base: NOW, unit: 'month', edge: 'end' },
    });
  }
  const weekStart: TimeExpr = { op: 'snap', base: NOW, unit: 'week', edge: 'start' };
  if (h === '上半周' || h === '上半週') {
    return mk({ op: 'span', anchor: weekStart, amount: { days: 3 } });
  }
  return mk({
    op: 'span',
    anchor: { op: 'offset', base: weekStart, amount: 3, unit: 'day' },
    amount: { days: 4 },
  });
};

// --- scoped ordinals: X的第N周, 前N天, 最后N个月, 最后一个星期一 --------------

function readMonthScope(tokens: Token[], i: number): { expr: TimeExpr; consumed: number } | undefined {
  const m = readMonthMarked(tokens, i);
  if (!m) return undefined;
  return { expr: { op: 'literal', date: { month: m.month } }, consumed: m.consumed };
}

const ruleScopedOrdinal: Rule = (tokens, i) => {
  let at = i;
  let base: TimeExpr;
  let baseYearValue: number | undefined;
  let baseUnit: Unit;
  const y = readYearScope(tokens, at);
  if (y) {
    base = y.expr;
    baseYearValue = y.year;
    baseUnit = 'year';
    at += y.consumed;
  } else {
    const m = readMonthScope(tokens, at);
    if (!m) return undefined;
    base = m.expr;
    baseUnit = 'month';
    at += m.consumed;
  }
  if (word(tokens[at]) === '的') at += 1;

  const baseStart: TimeExpr = { op: 'snap', base, unit: baseUnit, edge: 'start' };
  const baseEnd: TimeExpr = { op: 'snap', base, unit: baseUnit, edge: 'end' };
  // First week mostly inside the scope: week containing (start + 3 days).
  const firstWeek: TimeExpr = {
    op: 'snap',
    base: { op: 'offset', base: baseStart, amount: 3, unit: 'day' },
    unit: 'week',
  };
  const lastWeekEnd: TimeExpr = {
    op: 'snap',
    base: { op: 'offset', base: baseEnd, amount: -4, unit: 'day' },
    unit: 'week',
    edge: 'end',
  };
  const done = (expr: TimeExpr, end: number): RuleMatch => ({
    expr,
    consumed: end - i,
    confidence: 0.95,
    role: 'date',
  });

  const kind = seqAny(tokens, at, ['第', '前', '最后', '最後']);
  if (!kind) return undefined;
  const isNth = kind.text === '第';
  const isFirstN = kind.text === '前';
  at = kind.end;

  // 最后一个星期一 (last weekday of a month scope).
  if (!isNth && !isFirstN) {
    const one = seqAny(tokens, at, ['一个', '一個']);
    const wkAt = one ? one.end : at;
    const mk = seqAny(tokens, wkAt, WEEK_MARKERS);
    if (mk) {
      const wdChar = word(tokens[mk.end]);
      const wd = wdChar !== undefined ? WEEKDAY_CHARS[wdChar] : undefined;
      if (wd !== undefined) {
        // n:1 pins strict occurrence counting (the nextWeekday dialect policy
        // must not skip a week when walking back from the scope end).
        return done(
          { op: 'seek', base: baseEnd, dir: 'prev', target: { kind: 'weekday', weekday: wd }, n: 1 },
          mk.end + 1,
        );
      }
    }
  }

  const n = readNum(tokens, at);
  if (!n || !Number.isInteger(n.value) || n.value < 1 || n.value > 60) return undefined;
  at += n.consumed;
  const ge = word(tokens[at]);
  const hasGe = ge === '个' || ge === '個';
  if (hasGe) at += 1;

  const wk = seqAny(tokens, at, ['星期', '周', '週']);
  if (wk) {
    const end = wk.end;
    if (isNth) {
      const expr: TimeExpr =
        n.value === 1 ? firstWeek : { op: 'offset', base: firstWeek, amount: n.value - 1, unit: 'week' };
      return done(expr, end);
    }
    if (isFirstN) {
      return done(
        { op: 'span', anchor: { ...firstWeek, edge: 'start' }, amount: { weeks: n.value } },
        end,
      );
    }
    return done({ op: 'span', anchor: lastWeekEnd, amount: { weeks: -n.value } }, end);
  }
  if (word(tokens[at]) === '月' && baseUnit === 'year') {
    const end = at + 1;
    if (isNth) {
      if (n.value > 12) return undefined;
      const expr: TimeExpr =
        baseYearValue !== undefined
          ? { op: 'literal', date: { year: baseYearValue, month: n.value } }
          : { op: 'intersect', parts: [base, { op: 'literal', date: { month: n.value } }] };
      return done(expr, end);
    }
    if (isFirstN) return done({ op: 'span', anchor: baseStart, amount: { months: n.value } }, end);
    return done({ op: 'span', anchor: baseEnd, amount: { months: -n.value } }, end);
  }
  if ((word(tokens[at]) === '天' || word(tokens[at]) === '日') && !hasGe) {
    const end = at + 1;
    if (isNth) return undefined;
    if (isFirstN) return done({ op: 'span', anchor: baseStart, amount: { days: n.value } }, end);
    return done({ op: 'span', anchor: baseEnd, amount: { days: -n.value } }, end);
  }
  return undefined;
};

/** Decades: 十九世纪七十年代 → the 1870s. */
const ruleDecade: Rule = (tokens, i) => {
  const c = readNum(tokens, i);
  if (!c || c.value < 1 || c.value > 21) return undefined;
  const cent = seqAny(tokens, i + c.consumed, ['世纪', '世紀']);
  if (!cent) return undefined;
  const d = readNum(tokens, cent.end);
  if (!d || d.value < 10 || d.value > 90 || d.value % 10 !== 0) return undefined;
  const era = seqAny(tokens, cent.end + d.consumed, ['年代']);
  if (!era) return undefined;
  const year = (c.value - 1) * 100 + d.value;
  return {
    expr: { op: 'span', anchor: { op: 'literal', date: { year } }, amount: { years: 10 } },
    consumed: era.end - i,
    confidence: 0.95,
    role: 'date',
  };
};

// --- ranges ----------------------------------------------------------------

type RangeOperand =
  | { kind: 'date'; date: PartialDate; consumed: number }
  | { kind: 'dateExpr'; expr: TimeExpr; consumed: number }
  | { kind: 'time'; time: PartialTime; consumed: number }
  | { kind: 'datetime'; dayExpr: TimeExpr; date?: PartialDate; time: PartialTime; consumed: number };

function readRangeOperand(tokens: Token[], i: number): RangeOperand | undefined {
  // Month scope + 最后一个星期X ("四月的最后一个星期一").
  const m = readMonthScope(tokens, i);
  if (m) {
    let at = i + m.consumed;
    if (word(tokens[at]) === '的') at += 1;
    const last = seqAny(tokens, at, ['最后一个', '最後一個', '最后一個', '最後一个', '最后', '最後']);
    if (last) {
      const mk = seqAny(tokens, last.end, WEEK_MARKERS);
      const wdChar = mk ? word(tokens[mk.end]) : undefined;
      const wd = wdChar !== undefined ? WEEKDAY_CHARS[wdChar] : undefined;
      if (mk && wd !== undefined) {
        return {
          kind: 'dateExpr',
          expr: {
            op: 'seek',
            base: { op: 'snap', base: m.expr, unit: 'month', edge: 'end' },
            dir: 'prev',
            target: { kind: 'weekday', weekday: wd },
            n: 1,
          },
          consumed: mk.end + 1 - i,
        };
      }
    }
  }
  const dp = readDateParts(tokens, i);
  if (dp) {
    const clk = readClockWithPrefix(tokens, i + dp.consumed);
    if (clk) {
      return {
        kind: 'datetime',
        dayExpr: { op: 'literal', date: dp.date },
        date: dp.date,
        time: clk.time,
        consumed: dp.consumed + clk.consumed,
      };
    }
    return { kind: 'date', date: dp.date, consumed: dp.consumed };
  }
  const deictic = readDeicticDay(tokens, i);
  if (deictic) {
    const dayExpr = dayExprFor(deictic.delta);
    const clk = readClockWithPrefix(tokens, i + deictic.consumed);
    if (clk) {
      return { kind: 'datetime', dayExpr, time: clk.time, consumed: deictic.consumed + clk.consumed };
    }
    return { kind: 'dateExpr', expr: dayExpr, consumed: deictic.consumed };
  }
  const clk = readClockWithPrefix(tokens, i);
  if (clk) return { kind: 'time', time: clk.time, consumed: clk.consumed };
  // Bare 4-digit year ("1995 - 1997年").
  const t = tokens[i];
  if (t?.type === 'number' && !t.ordinal && t.value >= 1000 && t.value <= 2999 && t.end - t.start === 4) {
    return { kind: 'date', date: { year: t.value }, consumed: 1 };
  }
  return undefined;
}

const RANGE_CONNECTORS = ['到', '至', '-', '~', '～'];
const AND_CONNECTORS = ['和', '与', '與', '跟'];

/** Range ends: `between` treats non-point ends as exclusive at their start,
 * which is exactly the Chinese (and Recognizers) convention — 6月1日到6月30日
 * ends at 06-30T00:00. A plain literal is the right end operand. */
function rangeEndExpr(date: PartialDate): TimeExpr {
  return { op: 'literal', date };
}

/** Share meridiem across a same-day time pair; 12 with am context stays 12:00. */
function shareMeridiem(ta: PartialTime, tb: PartialTime, rangeMer?: MerKind): [PartialTime, PartialTime] {
  let a = { ...ta };
  let b = { ...tb };
  const bare = (t: PartialTime): PartialTime => {
    const { meridiem: _m, ...rest } = t;
    return rest;
  };
  if (rangeMer !== undefined) {
    if (a.meridiem === 'unknown' || a.meridiem === undefined) a = applyMeridiem(bare(a), rangeMer);
    if (b.meridiem === 'unknown' || b.meridiem === undefined) b = applyMeridiem(bare(b), rangeMer);
  }
  if (a.meridiem !== undefined && a.meridiem !== 'unknown' && b.meridiem === 'unknown') {
    if (b.hour === 12) delete b.meridiem;
    else b.meridiem = a.meridiem;
  } else if (b.meridiem !== undefined && b.meridiem !== 'unknown' && a.meridiem === 'unknown') {
    if ((a.hour ?? 0) < (b.hour ?? 0)) a.meridiem = b.meridiem;
  }
  return [a, b];
}

function datesCompatibleForAdjacency(a: PartialDate, b: PartialDate): boolean {
  const yearOnly = (d: PartialDate): boolean =>
    d.year !== undefined && d.month === undefined && d.day === undefined;
  const monthOnly = (d: PartialDate): boolean =>
    d.month !== undefined && d.day === undefined && d.year === undefined;
  const monthDay = (d: PartialDate): boolean => d.month !== undefined && d.day !== undefined;
  if (yearOnly(a) && yearOnly(b)) return true;
  if (monthOnly(a) && monthOnly(b)) return true;
  if (monthDay(a) && monthDay(b) && b.year === undefined) return true;
  return false;
}

/** Joined range words the tokenizer can't split: 17:55:23-18:33:02, 1995-1997年. */
function joinedRange(tokens: Token[], i: number): RuleMatch | undefined {
  const w = word(tokens[i]);
  if (w === undefined) return undefined;
  let m = w.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?[-~](\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (m) {
    const mkTime = (h: string, mi: string, s: string | undefined): TimeExpr => {
      const time: PartialTime = { hour: Number(h), minute: Number(mi) };
      if (s !== undefined) time.second = Number(s);
      if (time.hour !== undefined && time.hour >= 1 && time.hour <= 12) time.meridiem = 'unknown';
      return { op: 'literal', time };
    };
    return {
      expr: { op: 'between', start: mkTime(m[1]!, m[2]!, m[3]), end: mkTime(m[4]!, m[5]!, m[6]) },
      consumed: 1,
      confidence: 0.95,
      role: 'time',
    };
  }
  m = w.match(/^(\d{4})[-~](\d{4})$/);
  if (m) {
    const y1 = Number(m[1]);
    const y2 = Number(m[2]);
    if (y1 >= 1000 && y1 <= 2999 && y2 > y1 && y2 <= 2999) {
      const hasNian = word(tokens[i + 1]) === '年';
      return {
        expr: {
          op: 'between',
          start: { op: 'literal', date: { year: y1 } },
          end: { op: 'literal', date: { year: y2 } },
        },
        consumed: hasNian ? 2 : 1,
        confidence: hasNian ? 0.95 : 0.85,
        role: 'date',
      };
    }
  }
  m = w.match(/^(\d{1,4})\/(\d{1,2})\/(\d{1,4})[-~](\d{1,4})\/(\d{1,2})\/(\d{1,4})$/);
  if (m) {
    const d1 = numDateParts([Number(m[1]), Number(m[2]), Number(m[3])]);
    const d2 = numDateParts([Number(m[4]), Number(m[5]), Number(m[6])]);
    if (d1 && d2) {
      return {
        expr: { op: 'between', start: { op: 'literal', date: d1 }, end: rangeEndExpr(d2) },
        consumed: 1,
        confidence: 0.95,
        role: 'date',
      };
    }
  }
  return undefined;
}

const ruleRange: Rule = (tokens, i) => {
  let at = i;
  const cong = word(tokens[at]);
  const hasCong = cong === '从' || cong === '從' || cong === '自';
  if (hasCong) at += 1;

  const joined = joinedRange(tokens, at);
  if (joined) return { ...joined, consumed: at + joined.consumed - i };

  // Range-level day-period prefix over a bare-hour start: 早上五到六点.
  let rangeMer: MerKind | undefined;
  let a: RangeOperand | undefined;
  const pfx = matchTimePrefix(tokens, at);
  if (pfx && readClock(tokens, pfx.end) === undefined) {
    const n = readNum(tokens, pfx.end);
    if (n && Number.isInteger(n.value) && n.value >= 0 && n.value <= 24) {
      const connW = word(tokens[pfx.end + n.consumed]);
      if (connW !== undefined && RANGE_CONNECTORS.includes(connW)) {
        rangeMer = pfx.mer;
        a = { kind: 'time', time: { hour: n.value }, consumed: pfx.end + n.consumed - at };
      }
    }
  }
  if (!a) a = readRangeOperand(tokens, at);
  if (!a) return undefined;
  at += a.consumed;

  let needSuffix = false;
  let hasConnector = false;
  const connW = word(tokens[at]);
  if (connW !== undefined && RANGE_CONNECTORS.includes(connW)) {
    hasConnector = true;
    at += 1;
  } else if (connW !== undefined && AND_CONNECTORS.includes(connW)) {
    hasConnector = true;
    needSuffix = true;
    at += 1;
  }

  const b = readRangeOperand(tokens, at);
  if (!b) return undefined;

  if (!hasConnector) {
    // Only dash-absorbed adjacencies: 2019年6月1日[-]6月30日, 5月[-]10月,
    // 1995[–]1997年, 昨天5:00[-]6:00.
    const ok =
      (a.kind === 'date' && b.kind === 'date' && datesCompatibleForAdjacency(a.date, b.date)) ||
      ((a.kind === 'datetime' || a.kind === 'time') && b.kind === 'time');
    if (!ok) return undefined;
  }
  at += b.consumed;

  if (needSuffix) {
    const sfx = seqAny(tokens, at, ['之间', '之間', '间', '間']);
    if (!sfx) return undefined;
    at = sfx.end;
  }

  const mk = (expr: TimeExpr, role: 'date' | 'time' | 'datetime'): RuleMatch => ({
    expr,
    consumed: at - i,
    confidence: 0.95,
    role,
  });

  // time – time
  if (a.kind === 'time' && b.kind === 'time') {
    const [ta, tb] = shareMeridiem(a.time, b.time, rangeMer);
    return mk(
      { op: 'between', start: { op: 'literal', time: ta }, end: { op: 'literal', time: tb } },
      'time',
    );
  }
  // datetime|dateExpr+time – time (same-day end): 昨天5:00-6:00, …晚上7:00到8:00
  if (a.kind === 'datetime' && b.kind === 'time') {
    const [ta, tb] = shareMeridiem(a.time, b.time, rangeMer);
    return mk(
      {
        op: 'between',
        start: { op: 'intersect', parts: [a.dayExpr, { op: 'literal', time: ta }] },
        end: { op: 'intersect', parts: [a.dayExpr, { op: 'literal', time: tb }] },
      },
      'datetime',
    );
  }
  // datetime – datetime: 昨天下午两点到明天四点, 1月15号4点和2月3号9点之间.
  // Ambiguous hours read as-written (04:00, not 16:00) — Recognizers'
  // convention, and it keeps the candidate cartesian under the engine cap.
  const asDatetimeExpr = (o: RangeOperand): TimeExpr | undefined => {
    if (o.kind === 'datetime') {
      let time = o.time;
      if (time.meridiem === 'unknown') {
        const { meridiem: _m, ...rest } = time;
        time = rest;
      }
      return { op: 'intersect', parts: [o.dayExpr, { op: 'literal', time }] };
    }
    return undefined;
  };
  const da = asDatetimeExpr(a);
  const db = asDatetimeExpr(b);
  if (da && db) return mk({ op: 'between', start: da, end: db }, 'datetime');
  if (da && b.kind === 'date') {
    return mk({ op: 'between', start: da, end: rangeEndExpr(b.date) }, 'datetime');
  }
  if (a.kind === 'dateExpr' && db) return mk({ op: 'between', start: a.expr, end: db }, 'datetime');

  // date-ish – date-ish, with month/year inheritance and exclusive ends.
  const aStart: TimeExpr | undefined =
    a.kind === 'date' ? { op: 'literal', date: a.date } : a.kind === 'dateExpr' ? a.expr : undefined;
  if (aStart === undefined) return undefined;
  let bEnd: TimeExpr;
  if (b.kind === 'date') {
    const bd: PartialDate = { ...b.date };
    if (a.kind === 'date') {
      if (bd.month === undefined && bd.day !== undefined && a.date.month !== undefined) {
        bd.month = a.date.month;
      }
      if (bd.year === undefined && a.date.year !== undefined && bd.month !== undefined) {
        bd.year = a.date.year;
      }
    }
    bEnd = rangeEndExpr(bd);
  } else if (b.kind === 'dateExpr') {
    bEnd = b.expr;
  } else {
    return undefined;
  }
  return mk({ op: 'between', start: aStart, end: bEnd }, 'date');
};

// === registry ==============================================================

export const ZH_RULE_ENTRIES: readonly { name: string; rule: Rule }[] = [
  { name: 'range', rule: ruleRange },
  { name: 'scoped-ordinal', rule: ruleScopedOrdinal },
  { name: 'half', rule: ruleHalf },
  { name: 'date', rule: ruleDate },
  { name: 'numdate', rule: ruleNumDate },
  { name: 'rel-period', rule: ruleRelPeriod },
  { name: 'deictic-day', rule: ruleDeicticDay },
  { name: 'deictic-year', rule: ruleDeicticYear },
  { name: 'prefix-span', rule: rulePrefixSpan },
  { name: 'n-ago-later', rule: ruleNAgoLater },
  { name: 'duration', rule: ruleDuration },
  { name: 'clock', rule: ruleClock },
  { name: 'weekend', rule: ruleWeekend },
  { name: 'bare-weekday', rule: ruleBareWeekday },
  { name: 'decade', rule: ruleDecade },
  { name: 'bare-year', rule: ruleBareYear },
];

export const ZH_CONNECTORS: string[] = ['的'];
