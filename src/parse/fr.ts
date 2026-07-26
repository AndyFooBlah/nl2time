/**
 * French rules: lexicon for the Latin factory plus language-specific extras.
 * Corpus: corpus/forward/imported-recognizers-fr.json (issue #13); climb with
 * `node scripts/update-baselines.mjs fr`.
 *
 * Tokenizer notes that shape this file:
 *   - Apostrophes stay inside tokens: "aujourd'hui" and "l'année" are single
 *     word tokens, so elided articles live directly in the tables.
 *   - Dash-joined words split ONLY when every segment is plain [a-z'] —
 *     accents block the split. So "week-end" → week · - · end but
 *     "après-midi" stays one token.
 */
import type { DayPeriod, PartialDate, PartialTime, TimeExpr, Unit } from '../ir/types.js';
import type { Rule, RuleMatch } from './en.js';
import type { Token } from './tokenizer.js';
import { makeLatinRules, type LatinLexicon } from './latin.js';

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

/** "d'avril" → "avril", "l'année" → "année". */
function stripElision(w: string | undefined): string | undefined {
  if (w === undefined) return undefined;
  return /^[dl]['']/.test(w) ? w.slice(2) : w;
}

const MONTHS: Record<string, number> = {
  janvier: 1, janv: 1, jan: 1,
  février: 2, fevrier: 2, févr: 2, fevr: 2, fév: 2, fev: 2,
  mars: 3,
  avril: 4, avr: 4,
  mai: 5,
  juin: 6,
  juillet: 7, juil: 7,
  août: 8, aout: 8,
  septembre: 9, sept: 9, sep: 9,
  octobre: 10, oct: 10,
  novembre: 11, nov: 11,
  décembre: 12, decembre: 12, déc: 12, dec: 12,
};

const WEEKDAYS: LatinLexicon['weekdays'] = {
  lundi: 'mon', mardi: 'tue', mercredi: 'wed', mer: 'wed',
  jeudi: 'thu', jeu: 'thu', vendredi: 'fri', ven: 'fri',
  samedi: 'sat', sam: 'sat', dimanche: 'sun', dim: 'sun', lun: 'mon',
};

const PERIODS: Record<string, DayPeriod> = {
  matin: 'morning', matinée: 'morning', matinee: 'morning',
  'après-midi': 'afternoon', "l'après-midi": 'afternoon', 'apres-midi': 'afternoon',
  soir: 'evening', soirée: 'evening', soiree: 'evening',
  nuit: 'night',
};

const ONES: Record<string, number> = {
  un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7,
  huit: 8, neuf: 9,
};

const TEENS: Record<string, number> = {
  dix: 10, onze: 11, douze: 12, treize: 13, quatorze: 14, quinze: 15, seize: 16,
};

const TENS: Record<string, number> = {
  vingt: 20, trente: 30, quarante: 40, cinquante: 50, soixante: 60,
};

/** "1er", "4e", "3ème", "1ère" → day-of-month value. */
function ordinalWord(w: string | undefined): number | undefined {
  const m = w?.match(/^(\d{1,2})(?:er|ère|ere|re|e|ème|eme)$/);
  return m ? Number(m[1]) : undefined;
}

const ORDINAL_WORDS: Record<string, number> = {
  premier: 1, première: 1, premiere: 1,
  deuxième: 2, deuxieme: 2, second: 2, seconde: 2,
  troisième: 3, troisieme: 3,
  quatrième: 4, quatrieme: 4,
  cinquième: 5, cinquieme: 5,
};

/**
 * French number words, including split hyphen compounds ("vingt · - · trois")
 * and "vingt et un". Returns undefined when the tokens are not a number.
 */
function readWordNum(tokens: Token[], i: number): { value: number; consumed: number } | undefined {
  const t = tokens[i];
  if (t?.type === 'number' && !t.ordinal) return { value: t.value, consumed: 1 };
  const ow = ordinalWord(word(t));
  if (ow !== undefined) return { value: ow, consumed: 1 };
  const w = word(t);
  if (w === undefined) return undefined;
  if (ONES[w] !== undefined) return { value: ONES[w]!, consumed: 1 };
  if (ORDINAL_WORDS[w] !== undefined) return { value: ORDINAL_WORDS[w]!, consumed: 1 };
  if (w === 'quelques' || w === 'plusieurs') return { value: 3, consumed: 1 };
  // Corpus typo tolerance: "quel ques minutes".
  if (w === 'quel' && word(tokens[i + 1]) === 'ques') return { value: 3, consumed: 2 };
  if (TEENS[w] !== undefined) {
    // "dix - sept" → 17 (split hyphen compound).
    if (w === 'dix' && word(tokens[i + 1]) === '-') {
      const o = ONES[word(tokens[i + 2]) ?? ''];
      if (o !== undefined && o >= 7) return { value: 10 + o, consumed: 3 };
    }
    return { value: TEENS[w]!, consumed: 1 };
  }
  if (TENS[w] !== undefined) {
    const base = TENS[w]!;
    if (word(tokens[i + 1]) === '-') {
      const next = word(tokens[i + 2]) ?? '';
      const o = ONES[next] ?? (base === 60 ? TEENS[next] : undefined);
      if (o !== undefined) return { value: base + o, consumed: 3 };
    }
    if (word(tokens[i + 1]) === 'et') {
      const next = word(tokens[i + 2]) ?? '';
      const o = ONES[next] ?? (base === 60 && next === 'onze' ? 11 : undefined);
      if (o !== undefined) return { value: base + o, consumed: 3 };
    }
    return { value: base, consumed: 1 };
  }
  return undefined;
}

function yearAt(tokens: Token[], i: number): number | undefined {
  const t = tokens[i];
  return t?.type === 'number' && !t.ordinal && t.value >= 1000 && t.value <= 2999 ? t.value : undefined;
}

function century(y: number): number {
  return y >= 100 ? y : y >= 50 ? 1900 + y : 2000 + y;
}

/** numdate token → DMY partial date. */
function numdateToDate(t: Token): PartialDate | undefined {
  if (t.type !== 'numdate') return undefined;
  const p = t.parts;
  const valid = (d: PartialDate): PartialDate | undefined =>
    d.month !== undefined && d.month >= 1 && d.month <= 12 && d.day !== undefined && d.day >= 1 && d.day <= 31
      ? d
      : undefined;
  if (p.length === 2) {
    return valid({ day: p[0]!, month: p[1]! }) ?? valid({ day: p[1]!, month: p[0]! });
  }
  const [a, b, c] = [p[0]!, p[1]!, p[2]!];
  if (a >= 1000) return valid({ year: a, month: b, day: c });
  return (
    valid({ day: a, month: b, year: century(c) }) ?? valid({ day: b, month: a, year: century(c) })
  );
}

function timeLiteral(time: PartialTime): TimeExpr {
  return { op: 'literal', time };
}

function meridiemFor(period: DayPeriod): 'am' | 'pm' {
  return period === 'morning' ? 'am' : 'pm';
}

/** A day-period noun, elided or split ("apres · - · midi"). */
function readPeriodWord(tokens: Token[], i: number): { period: DayPeriod; consumed: number } | undefined {
  const w = word(tokens[i]);
  const period = PERIODS[w ?? ''] ?? PERIODS[stripElision(w) ?? ''];
  if (period !== undefined) return { period, consumed: 1 };
  if ((w === 'apres' || w === 'après') && word(tokens[i + 1]) === '-' && word(tokens[i + 2]) === 'midi') {
    return { period: 'afternoon', consumed: 3 };
  }
  return undefined;
}

/**
 * Period phrase after a clock time: "du matin", "du soir", "de l'après-midi",
 * "de la soirée". Returns the period and tokens consumed.
 */
function readPeriodSuffix(tokens: Token[], i: number): { period: DayPeriod; consumed: number } | undefined {
  let at = i;
  const w0 = word(tokens[at]);
  if (w0 !== 'du' && w0 !== 'de' && w0 !== 'dans') return undefined;
  at += 1;
  if (word(tokens[at]) === 'la' || word(tokens[at]) === 'le') at += 1;
  const pw = readPeriodWord(tokens, at);
  if (pw === undefined) return undefined;
  return { period: pw.period, consumed: at + pw.consumed - i };
}

/**
 * Clock-time phrase:
 *   [à|a|vers] 15h30 | 15h | 14:30 | N heures [et|moins] M [minutes] |
 *   midi | minuit — with optional "du matin/soir / de l'après-midi" suffix.
 */
function readTime(
  tokens: Token[],
  i: number,
): { time: PartialTime; consumed: number; bare: boolean } | undefined {
  let at = i;
  const t = tokens[at];
  const w = word(t);

  // "15h30" / "15h" / "4h45" (single word token).
  const hm = w?.match(/^(\d{1,2})h(\d{2})?$/);
  if (hm) {
    const hour = Number(hm[1]);
    if (hour > 23) return undefined;
    const time: PartialTime = { hour };
    if (hm[2] !== undefined) time.minute = Number(hm[2]);
    if (hour <= 12) time.meridiem = 'unknown';
    return { time, consumed: at + 1 - i, bare: false };
  }
  if (t?.type === 'clock') {
    const time: PartialTime = { hour: t.hour };
    if (t.explicitMinute) time.minute = t.minute;
    if (t.second !== undefined) time.second = t.second;
    if (t.meridiem) time.meridiem = t.meridiem;
    else if (t.hour <= 12) time.meridiem = 'unknown';
    return { time, consumed: at + 1 - i, bare: false };
  }
  if (w === 'midi') return { time: { hour: 12, meridiem: 'pm' }, consumed: 1, bare: false };
  if (w === 'minuit') return { time: { hour: 12, meridiem: 'am' }, consumed: 1, bare: false };

  // "3p.m" / "11ish" — joined meridiem/approx suffixes the tokenizer keeps.
  const pm = w?.match(/^(\d{1,2})(?:[.:h](\d{2}))?([ap])\.?m?$/);
  if (pm && (pm[3] === 'a' || pm[3] === 'p') && /[ap]\.?m$/.test(w!)) {
    const hour = Number(pm[1]);
    if (hour >= 1 && hour <= 12) {
      const time: PartialTime = { hour, meridiem: pm[3] === 'a' ? 'am' : 'pm' };
      if (pm[2] !== undefined) time.minute = Number(pm[2]);
      return { time, consumed: 1, bare: false };
    }
  }
  const ish = w?.match(/^(\d{1,2})ish$/);
  if (ish) {
    const hour = Number(ish[1]);
    if (hour <= 23) {
      const time: PartialTime = { hour };
      if (hour <= 12) time.meridiem = 'unknown';
      return { time, consumed: 1, bare: false };
    }
  }
  // "1140 a.m." — military-style number + meridiem word.
  if (t?.type === 'number' && t.value >= 100 && t.value <= 1259) {
    const mw = word(tokens[at + 1]);
    if (mw === 'am' || mw === 'pm') {
      const hour = Math.floor(t.value / 100);
      const minute = t.value % 100;
      if (minute < 60) {
        return { time: { hour, minute, meridiem: mw }, consumed: 2, bare: false };
      }
    }
  }

  // "N heures [M | et M | moins M | et demie/quart]" — word or digit hour.
  const n = readWordNum(tokens, at);
  if (!n || n.value > 23) return undefined;
  at += n.consumed;
  let hw = word(tokens[at]);
  // "sept et demie heures" — fraction before the hour word.
  if (hw === 'et' && (word(tokens[at + 1]) === 'demie' || word(tokens[at + 1]) === 'demi' || word(tokens[at + 1]) === 'quart')) {
    const fw = word(tokens[at + 1]);
    const hw2 = word(tokens[at + 2]);
    if (hw2 === 'heures' || hw2 === 'heure') {
      const time: PartialTime = { hour: n.value, minute: fw === 'quart' ? 15 : 30 };
      if (n.value <= 12) time.meridiem = 'unknown';
      return { time, consumed: at + 3 - i, bare: true };
    }
  }
  if (hw !== 'heures' && hw !== 'heure' && hw !== 'h') return undefined;
  at += 1;
  let hour = n.value;
  let minute: number | undefined;
  const mw = word(tokens[at]);
  if (mw === 'et') {
    const fw = word(tokens[at + 1]);
    if (fw === 'demie' || fw === 'demi') {
      minute = 30;
      at += 2;
    } else if (fw === 'quart') {
      minute = 15;
      at += 2;
    } else {
      const m = readWordNum(tokens, at + 1);
      if (m && m.value <= 59) {
        minute = m.value;
        at += 1 + m.consumed;
      }
    }
  } else if (mw === 'moins') {
    if (word(tokens[at + 1]) === 'le' && word(tokens[at + 2]) === 'quart') {
      hour = hour === 0 ? 23 : hour - 1;
      minute = 45;
      at += 3;
    } else {
      const m = readWordNum(tokens, at + 1);
      if (m && m.value <= 59) {
        hour = hour === 0 ? 23 : hour - 1;
        minute = 60 - m.value;
        at += 1 + m.consumed;
      }
    }
  } else {
    const m = readWordNum(tokens, at);
    if (m && m.value <= 59 && tokens[at]?.type !== 'number' ? true : m && m.value <= 59) {
      // Plain trailing minutes: "sept heures dix", "8 h 20".
      if (m && m.value <= 59) {
        minute = m.value;
        at += m.consumed;
      }
    }
  }
  if (word(tokens[at]) === 'minutes' || word(tokens[at]) === 'minute') at += 1;
  const time: PartialTime = { hour };
  if (minute !== undefined) time.minute = minute;
  if (hour <= 12) time.meridiem = 'unknown';
  return { time, consumed: at - i, bare: true };
}

/** Apply a day-period's meridiem to an ambiguous time. */
function applyPeriod(time: PartialTime, period: DayPeriod): PartialTime {
  if (time.meridiem !== undefined && time.meridiem !== 'unknown') return time;
  return { ...time, meridiem: meridiemFor(period) };
}

/* ------------------------------------------------------------------ */
/* Extras                                                             */
/* ------------------------------------------------------------------ */

/** "à 15h30" / "16h" / "vingt heures" / "sept heures moins dix" / "midi". */
const frTime: Rule = (tokens, i) => {
  let at = i;
  const lead = word(tokens[at]);
  const hasLead = lead === 'à' || lead === 'a' || lead === 'vers';
  if (hasLead) at += 1;
  const read = readTime(tokens, at);
  if (!read) {
    // "10, ce soir" — a bare hour licensed by a following demonstrative +
    // period; emit just the hour and let the merger attach the period.
    const t = tokens[at];
    if (t?.type === 'number' && !t.ordinal && t.value >= 1 && t.value <= 12) {
      const dw = word(tokens[at + 1]);
      if ((dw === 'ce' || dw === 'cette') && readPeriodWord(tokens, at + 2) !== undefined) {
        return {
          expr: timeLiteral({ hour: t.value, meridiem: 'unknown' }),
          consumed: at + 1 - i,
          confidence: 0.9,
          role: 'time',
        };
      }
    }
    return undefined;
  }
  // A bare word-number time without any lead is too loose only when it is a
  // lone number; "N heures" already requires the hour word, so accept.
  at += read.consumed;
  let time = read.time;
  const ps = readPeriodSuffix(tokens, at);
  if (ps) {
    time = applyPeriod(time, ps.period);
    at += ps.consumed;
  }
  // "à 16h - 18h30" → time range.
  if (word(tokens[at]) === '-') {
    const second = readTime(tokens, at + 1);
    if (second) {
      return {
        expr: {
          op: 'between',
          start: timeLiteral(time),
          end: timeLiteral(second.time),
        },
        consumed: at + 1 + second.consumed - i,
        confidence: 0.95,
        role: 'time',
      };
    }
  }
  return {
    expr: timeLiteral(time),
    consumed: at - i,
    confidence: 1,
    role: 'time',
  };
};

/** "dans les 2h" → the next 2 hours (rolling span). */
const frInLesH: Rule = (tokens, i) => {
  if (word(tokens[i]) !== 'dans') return undefined;
  let at = i + 1;
  if (word(tokens[at]) === 'les') at += 1;
  const m = word(tokens[at])?.match(/^(\d{1,3})h$/);
  if (!m) return undefined;
  return {
    expr: { op: 'span', anchor: NOW, amount: { hours: Number(m[1]) } },
    consumed: at + 1 - i,
    confidence: 1,
    role: 'datetime',
  };
};

/** Numeric dates: numdate tokens (22/04, 01/01/2015) and joined words. */
const frNumdate: Rule = (tokens, i) => {
  const t = tokens[i];
  if (t?.type === 'numdate') {
    const date = numdateToDate(t);
    if (!date) return undefined;
    return { expr: { op: 'literal', date }, consumed: 1, confidence: 1, role: 'date' };
  }
  const w = word(t);
  if (w === undefined) return undefined;
  // "2014-2018" / "2014~2018" → year range.
  let m = w.match(/^([12]\d{3})[-~]([12]\d{3})$/);
  if (m && Number(m[1]) < Number(m[2])) {
    return {
      expr: {
        op: 'between',
        start: { op: 'literal', date: { year: Number(m[1]) } },
        end: { op: 'literal', date: { year: Number(m[2]) } },
      },
      consumed: 1,
      confidence: 0.95,
      role: 'date',
    };
  }
  // "2015-3" / "12-2015" → year-month.
  m = w.match(/^([12]\d{3})-(\d{1,2})$/);
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) {
    return {
      expr: { op: 'literal', date: { year: Number(m[1]), month: Number(m[2]) } },
      consumed: 1,
      confidence: 0.95,
      role: 'date',
    };
  }
  m = w.match(/^(\d{1,2})-([12]\d{3})$/);
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 12) {
    return {
      expr: { op: 'literal', date: { year: Number(m[2]), month: Number(m[1]) } },
      consumed: 1,
      confidence: 0.95,
      role: 'date',
    };
  }
  // "28/2-1/3[/2017]" → joined numeric-date range (day/month order).
  m = w.match(/^(\d{1,2})\/(\d{1,2})-(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/);
  if (m) {
    const year = m[5] !== undefined ? Number(m[5]) : yearAt(tokens, i + 1);
    const mk = (d: number, mo: number): PartialDate | undefined =>
      mo >= 1 && mo <= 12 && d >= 1 && d <= 31
        ? year !== undefined
          ? { day: d, month: mo, year }
          : { day: d, month: mo }
        : undefined;
    const d1 = mk(Number(m[1]), Number(m[2]));
    const d2 = mk(Number(m[3]), Number(m[4]));
    if (d1 && d2) {
      const extra = m[5] === undefined && year !== undefined ? 1 : 0;
      return {
        expr: {
          op: 'between',
          start: { op: 'literal', date: d1 },
          end: { op: 'literal', date: d2 },
        },
        consumed: 1 + extra,
        confidence: 0.95,
        role: 'date',
      };
    }
  }
  // "10-1-2018-10-7-2018" → joined M-D-Y date range (Recognizers uses
  // month-first in this dashed form even in the French specs).
  m = w.match(/^(\d{1,2})-(\d{1,2})-(\d{4})-(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (m) {
    const mk = (mo: number, d: number, y: number): PartialDate | undefined =>
      mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? { year: y, month: mo, day: d } : undefined;
    const d1 = mk(Number(m[1]), Number(m[2]), Number(m[3]));
    const d2 = mk(Number(m[4]), Number(m[5]), Number(m[6]));
    if (d1 && d2) {
      return {
        expr: { op: 'between', start: { op: 'literal', date: d1 }, end: { op: 'literal', date: d2 } },
        consumed: 1,
        confidence: 0.9,
        role: 'date',
      };
    }
  }
  // "décembre/2018-mai/2019" → month/year range in one token.
  m = w.match(/^([a-zà-ÿû]+)\/(\d{4})-([a-zà-ÿû]+)\/(\d{4})$/);
  if (m) {
    const m1 = MONTHS[m[1]!];
    const m2 = MONTHS[m[3]!];
    if (m1 !== undefined && m2 !== undefined) {
      return {
        expr: {
          op: 'between',
          start: { op: 'literal', date: { month: m1, year: Number(m[2]) } },
          end: { op: 'literal', date: { month: m2, year: Number(m[4]) } },
        },
        consumed: 1,
        confidence: 0.95,
        role: 'date',
      };
    }
  }
  // "2019-août-1" / "août-2019" — dash-joined with an accented month name
  // (accents block the tokenizer's dash split).
  if (w.includes('-')) {
    const segments = w.split('-');
    if (segments.length >= 2 && segments.length <= 3 && segments.every((s) => s.length > 0)) {
      let month: number | undefined;
      let day: number | undefined;
      let year: number | undefined;
      let ok = true;
      for (const seg of segments) {
        const mo = MONTHS[seg];
        if (mo !== undefined && month === undefined) {
          month = mo;
        } else if (/^[12]\d{3}$/.test(seg) && year === undefined) {
          year = Number(seg);
        } else if (/^\d{1,2}$/.test(seg) && day === undefined && Number(seg) >= 1 && Number(seg) <= 31) {
          day = Number(seg);
        } else {
          ok = false;
          break;
        }
      }
      if (ok && month !== undefined && (day !== undefined || year !== undefined)) {
        const date: PartialDate = { month };
        if (day !== undefined) date.day = day;
        if (year !== undefined) date.year = year;
        return { expr: { op: 'literal', date }, consumed: 1, confidence: 0.95, role: 'date' };
      }
    }
  }
  // "2019.0" → the year (stray decimal).
  m = w.match(/^([12]\d{3})\.0$/);
  if (m) {
    return { expr: { op: 'literal', date: { year: Number(m[1]) } }, consumed: 1, confidence: 0.8, role: 'date' };
  }
  // "16-17" / "3-8" → joined hour pair.
  m = w.match(/^(\d{1,2})-(\d{1,2})$/);
  if (m) {
    const h1 = Number(m[1]);
    const h2 = Number(m[2]);
    if (h1 <= 23 && h2 <= 23) {
      const mk = (h: number): PartialTime => (h <= 12 ? { hour: h, meridiem: 'unknown' } : { hour: h });
      return {
        expr: { op: 'between', start: timeLiteral(mk(h1)), end: timeLiteral(mk(h2)) },
        consumed: 1,
        confidence: 0.85,
        role: 'time',
      };
    }
  }
  return undefined;
};

/**
 * Day-month dates the factory can't read: ordinal words ("le 1er janvier
 * 2019", "le 4e jour de juillet de 1995") and word-number days.
 */
const frDayMonth: Rule = (tokens, i) => {
  let at = i;
  const w0 = word(tokens[at]);
  if (w0 === 'le' || w0 === 'ce') at += 1;
  const day = readWordNum(tokens, at);
  if (!day || day.value < 1 || day.value > 31) return undefined;
  let cursor = at + day.consumed;
  if (word(tokens[cursor]) === 'jour') cursor += 1;
  let monthWord = word(tokens[cursor]);
  if (monthWord === 'de' || monthWord === 'du') {
    cursor += 1;
    monthWord = word(tokens[cursor]);
  }
  const month = MONTHS[monthWord ?? ''] ?? MONTHS[stripElision(monthWord) ?? ''];
  if (month === undefined) return undefined;
  cursor += 1;
  let yAt = cursor;
  if (word(tokens[yAt]) === 'de' || word(tokens[yAt]) === 'du') yAt += 1;
  const year = yearAt(tokens, yAt);
  const date: PartialDate = { month, day: day.value };
  if (year !== undefined) date.year = year;
  return {
    expr: { op: 'literal', date },
    consumed: (year !== undefined ? yAt + 1 : cursor) - i,
    confidence: 1,
    role: 'date',
  };
};

/** Month-first forms: "Mai vingt-neuf", "novembre 23 de 1987", "juillet 98". */
const frMonthFirst: Rule = (tokens, i) => {
  const w = word(tokens[i]);
  const month = MONTHS[w ?? ''] ?? MONTHS[stripElision(w) ?? ''];
  if (month === undefined) return undefined;
  let at = i + 1;
  if (word(tokens[at]) === '-') at += 1;
  // "novembre 19-20" → day range within the month.
  const pair = word(tokens[at])?.match(/^(\d{1,2})-(\d{1,2})$/);
  if (pair && Number(pair[1]) <= 31 && Number(pair[2]) <= 31) {
    return {
      expr: {
        op: 'between',
        start: { op: 'literal', date: { month, day: Number(pair[1]) } },
        end: { op: 'literal', date: { month, day: Number(pair[2]) } },
      },
      consumed: at + 1 - i,
      confidence: 0.9,
      role: 'date',
    };
  }
  const day = readWordNum(tokens, at);
  if (!day) return undefined;
  // "juillet 98" → July 1998.
  if (day.consumed === 1 && tokens[at]?.type === 'number' && day.value > 31 && day.value <= 99) {
    return {
      expr: { op: 'literal', date: { month, year: century(day.value) } },
      consumed: at + 1 - i,
      confidence: 0.9,
      role: 'date',
    };
  }
  // "septembre-2020-23" → month · year · day.
  if (day.consumed === 1 && tokens[at]?.type === 'number' && day.value >= 1000 && day.value <= 2999) {
    const year = day.value;
    let dAt = at + 1;
    if (word(tokens[dAt]) === '-') dAt += 1;
    const dTok = tokens[dAt];
    if (dTok?.type === 'number' && dTok.value >= 1 && dTok.value <= 31) {
      return {
        expr: { op: 'literal', date: { year, month, day: dTok.value } },
        consumed: dAt + 1 - i,
        confidence: 0.9,
        role: 'date',
      };
    }
    return {
      expr: { op: 'literal', date: { year, month } },
      consumed: at + 1 - i,
      confidence: 0.9,
      role: 'date',
    };
  }
  if (day.value < 1 || day.value > 31) return undefined;
  let cursor = at + day.consumed;
  let yAt = cursor;
  if (word(tokens[yAt]) === 'de' || word(tokens[yAt]) === '-') yAt += 1;
  const year = yearAt(tokens, yAt);
  const date: PartialDate = { month, day: day.value };
  if (year !== undefined) {
    date.year = year;
    cursor = yAt + 1;
  }
  return { expr: { op: 'literal', date }, consumed: cursor - i, confidence: 0.9, role: 'date' };
};

/** "le 17" / "le 1er" — bare day-of-month with article. */
const frBareDay: Rule = (tokens, i) => {
  const art = word(tokens[i]);
  if (art !== 'le' && art !== 'ce') return undefined;
  const t = tokens[i + 1];
  let day: number | undefined;
  if (t?.type === 'number' && !t.ordinal && t.value >= 1 && t.value <= 31) day = t.value;
  else day = ordinalWord(word(t));
  if (day === undefined || day < 1 || day > 31) return undefined;
  // Don't swallow "le 15 mars" (month follows) or "le 15 du mois prochain".
  const next = word(tokens[i + 2]);
  if (next !== undefined && (MONTHS[next] !== undefined || MONTHS[stripElision(next) ?? ''] !== undefined)) {
    return undefined;
  }
  if (next === 'du' || next === 'de') {
    // "le 15 du mois prochain" → day within next/last month.
    let at = i + 3;
    if (word(tokens[at]) === 'le') at += 1;
    if (word(tokens[at]) === 'mois') {
      const mod = word(tokens[at + 1]);
      const delta = mod === 'prochain' || mod === 'suivant' ? 1 : mod === 'dernier' || mod === 'précédent' ? -1 : 0;
      if (delta !== 0) {
        return {
          expr: {
            op: 'intersect',
            parts: [snapOffset(delta, 'month'), { op: 'literal', date: { day } }],
          },
          consumed: at + 2 - i,
          confidence: 1,
          role: 'date',
        };
      }
    }
  }
  return {
    expr: { op: 'literal', date: { day } },
    consumed: 2,
    confidence: 0.8,
    role: 'date',
  };
};

/** "lundi 21", "le dimanche 31" — weekday + bare day number. */
const frWeekdayDay: Rule = (tokens, i) => {
  let at = i;
  if (word(tokens[at]) === 'le' || word(tokens[at]) === 'ce') at += 1;
  const wd = WEEKDAYS[word(tokens[at]) ?? ''];
  if (!wd) return undefined;
  const t = tokens[at + 1];
  const day = t?.type === 'number' && !t.ordinal ? t.value : ordinalWord(word(t));
  if (day === undefined || day < 1 || day > 31) return undefined;
  // Month follows → the full-date rules own it.
  const next = word(tokens[at + 2]);
  if (next !== undefined && (MONTHS[next] !== undefined || MONTHS[stripElision(next) ?? ''] !== undefined)) {
    return undefined;
  }
  if (tokens[at + 2]?.type === 'numdate') return undefined;
  return {
    expr: { op: 'literal', date: { day } },
    consumed: at + 2 - i,
    confidence: 0.9,
    role: 'date',
  };
};

/** Bare day-period noun → mergeable time part ("demain soir", "mardi matin"). */
const frBarePeriod: Rule = (tokens, i) => {
  const pw = readPeriodWord(tokens, i);
  if (pw === undefined) return undefined;
  return {
    expr: { op: 'literal', dayPeriod: pw.period },
    consumed: pw.consumed,
    confidence: 0.55,
    role: 'time',
  };
};

const DUR_UNITS: Record<string, keyof import('../ir/types.js').CalendarAmount> = {
  seconde: 'seconds', secondes: 'seconds', sec: 'seconds',
  minute: 'minutes', minutes: 'minutes', min: 'minutes',
  heure: 'hours', heures: 'hours', h: 'hours',
  jour: 'days', jours: 'days', journée: 'days', journee: 'days', journées: 'days', journees: 'days',
  nuit: 'days', nuits: 'days',
  semaine: 'weeks', semaines: 'weeks',
  mois: 'months',
  an: 'years', ans: 'years', année: 'years', annee: 'years', années: 'years', annees: 'years',
};

/** "3heures", "3h", "1.5h", "3.5ans" — joined amount+unit words. */
function joinedAmount(w: string | undefined): Partial<Record<string, number>> | undefined {
  const m = w?.match(/^(\d+)(?:\.(\d+))?(h|heures?|min|sec|ans?|jours?|semaines?)$/);
  if (!m) return undefined;
  const unit = DUR_UNITS[m[3]!];
  if (!unit) return undefined;
  const whole = Number(m[1]);
  const frac = m[2] !== undefined ? Number(`0.${m[2]}`) : 0;
  const amount: Record<string, number> = { [unit]: whole };
  if (frac > 0) {
    if (unit === 'hours') amount['minutes'] = Math.round(frac * 60);
    else amount[unit] = whole + frac;
  }
  return amount;
}

/** Read one duration component: "3 heures", "vingt-quatre heures", "demi-heure". */
function readDurComponent(
  tokens: Token[],
  i: number,
): { amount: Record<string, number>; consumed: number } | undefined {
  let at = i;
  if (word(tokens[at]) === 'une' || word(tokens[at]) === 'un') {
    // "une demi-heure" → demi · - · heure
    if (word(tokens[at + 1]) === 'demi' && word(tokens[at + 2]) === '-' && word(tokens[at + 3]) === 'heure') {
      return { amount: { minutes: 30 }, consumed: at + 4 - i };
    }
  }
  if (word(tokens[at]) === 'demi' && word(tokens[at + 1]) === '-' && word(tokens[at + 2]) === 'heure') {
    return { amount: { minutes: 30 }, consumed: at + 3 - i };
  }
  const joined = joinedAmount(word(tokens[at]));
  if (joined) return { amount: joined as Record<string, number>, consumed: 1 };
  const n = readWordNum(tokens, at);
  if (!n) return undefined;
  at += n.consumed;
  // "pour un autre jour" — 'autre' is transparent.
  if (word(tokens[at]) === 'autre' || word(tokens[at]) === 'autres') at += 1;
  // "123,45 sec" / "3,5 ans": the comma vanished in tokenization, leaving two
  // adjacent number tokens one character apart.
  const t1 = tokens[at - 1];
  const t2 = tokens[at];
  let value = n.value;
  if (
    t1?.type === 'number' && t2?.type === 'number' && !t2.ordinal &&
    t2.start === t1.end + 1 && DUR_UNITS[word(tokens[at + 1]) ?? ''] !== undefined
  ) {
    value = n.value + t2.value / 10 ** (t2.end - t2.start);
    at += 1;
  }
  // "trois week-ends" → 3 × 2 days.
  if (word(tokens[at]) === 'week' && word(tokens[at + 1]) === '-' && /^ends?$/.test(word(tokens[at + 2]) ?? '')) {
    return { amount: { days: 2 * value }, consumed: at + 3 - i };
  }
  const unit = DUR_UNITS[word(tokens[at]) ?? ''];
  if (!unit) return undefined;
  return { amount: { [unit]: value }, consumed: at + 1 - i };
}

const DUR_MARKERS: string[][] = [
  ['pour'], ['pendant'], ['durant'], ['dure'], ['durera'], ['dura'], ['depuis'],
  ['sur'], ['durée', 'de'], ['duree', 'de'], ['prendra'], ['faudra'], ['que'],
  ['durer', 'du', 'tout'], ['durer'],
];

/** Elided one-markers: "d'une seconde", "qu'une heure et demie", "d' une demi-heure". */
const DUR_ONE_MARKERS = ["d'une", "d'un", "qu'une", "qu'un"];

/** "pour 3 heures" / "depuis trois semaines" / "durera 2 heures 50 minutes". */
const frDuration: Rule = (tokens, i) => {
  let at: number | undefined;
  let markerLen = 0;
  const w0 = word(tokens[i]);
  // "d'une seconde" / "qu'une heure et demie" — marker fused with "one".
  if (w0 !== undefined && DUR_ONE_MARKERS.includes(w0)) {
    const unit = DUR_UNITS[word(tokens[i + 1]) ?? ''];
    if (unit) return finishDuration(tokens, i, i + 1, { amount: { [unit]: 1 }, consumed: 1 });
    // "d' une demi-heure" variant handled below via component read.
    const comp = readDurComponent(tokens, i + 1);
    if (comp) return finishDuration(tokens, i, i + 1, comp);
    return undefined;
  }
  if ((w0 === 'd' || w0 === 'qu') && (word(tokens[i + 1]) === 'une' || word(tokens[i + 1]) === 'un')) {
    const comp = readDurComponent(tokens, i + 1);
    if (comp) return finishDuration(tokens, i, i + 1, comp);
    const unit = DUR_UNITS[word(tokens[i + 2]) ?? ''];
    if (unit) return finishDuration(tokens, i, i + 2, { amount: { [unit]: 1 }, consumed: 1 });
    return undefined;
  }
  for (const marker of DUR_MARKERS) {
    let k = 0;
    while (k < marker.length && word(tokens[i + k]) === marker[k]) k += 1;
    if (k === marker.length) {
      at = i + k;
      markerLen = k;
      break;
    }
  }
  if (at === undefined) return undefined;
  const w = word(tokens[at]);
  // "pour la journée" / "pour le mois" — the unit interval, not a duration.
  if ((w === 'la' || w === 'le') && markerLen > 0) {
    const unitWord = word(tokens[at + 1]);
    const unit =
      unitWord === 'journée' || unitWord === 'journee' || unitWord === 'jour'
        ? 'day'
        : unitWord === 'semaine'
          ? 'week'
          : unitWord === 'mois'
            ? 'month'
            : unitWord === 'année' || unitWord === 'annee'
              ? 'year'
              : undefined;
    if (unit && WEEKDAYS[word(tokens[at + 2]) ?? ''] === undefined && word(tokens[at + 2]) !== 'prochain') {
      // Leave "pour le mois prochain" (rel-noun) alone.
      const mod = word(tokens[at + 2]);
      if (mod === undefined || (MONTHS[mod] === undefined && mod !== 'prochaine' && mod !== 'prochain' && mod !== 'dernier' && mod !== 'dernière')) {
        return { expr: snapNow(unit), consumed: at + 2 - i, confidence: 0.9, role: 'date' };
      }
    }
    return undefined;
  }
  if (w === 'une' || w === 'un') {
    const comp = readDurComponent(tokens, at);
    if (comp) return finishDuration(tokens, i, at, comp);
    at += 1;
  }
  const comp = readDurComponent(tokens, at);
  if (!comp) return undefined;
  return finishDuration(tokens, i, at, comp);
};

function finishDuration(
  tokens: Token[],
  i: number,
  at: number,
  comp: { amount: Record<string, number>; consumed: number },
): RuleMatch {
  let cursor = at + comp.consumed;
  const amount = { ...comp.amount };
  // "et vingt minutes" / "et demie" / bare second component ("2 heures 50 minutes").
  let extraAt = cursor;
  if (word(tokens[extraAt]) === 'et') extraAt += 1;
  if (word(tokens[extraAt]) === 'demie' || word(tokens[extraAt]) === 'demi') {
    if (amount['years'] !== undefined) amount['years'] += 0.5;
    else amount['minutes'] = (amount['minutes'] ?? 0) + 30;
    cursor = extraAt + 1;
  } else if (word(tokens[extraAt]) === 'quart') {
    if (amount['years'] !== undefined) amount['years'] += 0.25;
    else amount['minutes'] = (amount['minutes'] ?? 0) + 15;
    cursor = extraAt + 1;
  } else {
    const second = readDurComponent(tokens, extraAt);
    if (second) {
      for (const [k, v] of Object.entries(second.amount)) {
        amount[k] = (amount[k] ?? 0) + v;
      }
      cursor = extraAt + second.consumed;
    } else if (word(tokens[extraAt]) === 'un' && word(tokens[extraAt + 1]) === 'quart') {
      if (amount['years'] !== undefined) amount['years'] += 0.25;
      else amount['minutes'] = (amount['minutes'] ?? 0) + 15;
      cursor = extraAt + 2;
    }
  }
  return {
    expr: { op: 'amount', amount },
    consumed: cursor - i,
    confidence: 1,
    role: 'duration',
  };
}

/** "toute la journée" / "tout le mois" → one whole unit. */
const frAllUnit: Rule = (tokens, i) => {
  const w0 = word(tokens[i]);
  if (w0 !== 'tout' && w0 !== 'toute') return undefined;
  let at = i + 1;
  const art = word(tokens[at]);
  if (art === 'le' || art === 'la') at += 1;
  const unit = DUR_UNITS[word(tokens[at]) ?? ''];
  if (!unit) return undefined;
  return {
    expr: { op: 'amount', amount: { [unit]: 1 } },
    consumed: at + 1 - i,
    confidence: 1,
    role: 'duration',
  };
};

/** "[dans] les N unités à venir / précédentes / dernières" (adj after noun). */
const frNUnitPost: Rule = (tokens, i) => {
  let at = i;
  if (word(tokens[at]) === 'les' || word(tokens[at]) === 'des') at += 1;
  const n = readWordNum(tokens, at);
  if (!n) return undefined;
  at += n.consumed;
  const unitWord = word(tokens[at]) ?? '';
  const unit = FR_LEXICON.units[unitWord];
  if (!unit) return undefined;
  at += 1;
  // "journées de travail" — skip the qualifier.
  if (word(tokens[at]) === 'de' && word(tokens[at + 1]) === 'travail') at += 2;
  let sign: 1 | -1 | undefined;
  const pw = word(tokens[at]);
  if (pw === 'à' && word(tokens[at + 1]) === 'venir') {
    sign = 1;
    at += 2;
  } else if (pw !== undefined && ['précédentes', 'précédents', 'precedentes', 'precedents', 'dernières', 'derniers', 'dernieres', 'passées', 'passés', 'passees'].includes(pw)) {
    sign = -1;
    at += 1;
  } else if (pw !== undefined && ['suivantes', 'suivants', 'prochaines', 'prochains'].includes(pw)) {
    sign = 1;
    at += 1;
  }
  if (sign === undefined) return undefined;
  const amount = unit === 'quarter' ? { months: 3 * sign * n.value } : { [`${unit}s`]: sign * n.value };
  return {
    expr: { op: 'span', anchor: NOW, amount },
    consumed: at - i,
    confidence: 1,
    role: 'date',
  };
};

/** "les N prochains journées de travail" — factory misses the qualifier. */
const frNextNWork: Rule = (tokens, i) => {
  let at = i;
  if (word(tokens[at]) === 'les' || word(tokens[at]) === 'des') at += 1;
  const n = readWordNum(tokens, at);
  if (!n) return undefined;
  at += n.consumed;
  const adj = word(tokens[at]) ?? '';
  let sign: 1 | -1;
  if (['prochains', 'prochaines', 'suivants', 'suivantes'].includes(adj)) sign = 1;
  else if (['derniers', 'dernières', 'dernieres'].includes(adj)) sign = -1;
  else return undefined;
  at += 1;
  const unitWord = word(tokens[at]) ?? '';
  const unit = FR_LEXICON.units[unitWord];
  if (!unit) return undefined;
  at += 1;
  if (word(tokens[at]) === 'de' && word(tokens[at + 1]) === 'travail') at += 2;
  const amount = unit === 'quarter' ? { months: 3 * sign * n.value } : { [`${unit}s`]: sign * n.value };
  return {
    expr: { op: 'span', anchor: NOW, amount },
    consumed: at - i,
    confidence: 1,
    role: 'date',
  };
};

/** "la journée" / "l'année" / "dans la semaine" — bare unit interval. */
const frBareUnit: Rule = (tokens, i) => {
  let at = i;
  if (word(tokens[at]) === 'dans' || word(tokens[at]) === 'de') at += 1;
  const art = word(tokens[at]);
  let unitWord: string | undefined;
  if (art === 'le' || art === 'la') {
    unitWord = word(tokens[at + 1]);
    at += 2;
  } else if (art !== undefined && /^l['']/.test(art)) {
    unitWord = stripElision(art);
    at += 1;
  } else {
    return undefined;
  }
  const unit = FR_LEXICON.units[unitWord ?? ''];
  if (!unit || unit === 'hour' || unit === 'minute' || unit === 'second') return undefined;
  // A modifier follows → rel-noun owns it.
  const next = word(tokens[at]);
  if (next !== undefined && (FR_LEXICON.postMods[next] !== undefined || next === 'en' || next === 'de' || next === 'du')) {
    return undefined;
  }
  if (yearAt(tokens, at) !== undefined) return undefined;
  return { expr: snapNow(unit), consumed: at - i, confidence: 0.6, role: 'date' };
};

const HOLIDAYS: { words: string[]; name: import('../ir/types.js').HolidayName }[] = [
  { words: ['noël'], name: 'christmas' },
  { words: ['noel'], name: 'christmas' },
  { words: ['pâques'], name: 'easter' },
  { words: ['paques'], name: 'easter' },
  { words: ['nouvel', 'an'], name: 'new-year' },
  { words: ['jour', 'de', "l'an"], name: 'new-year' },
  { words: ['vendredi', 'noir'], name: 'black-friday' },
  { words: ['jour', 'de', 'la', 'terre'], name: 'earth-day' },
  { words: ['saint', 'patrick'], name: 'st-patricks' },
  { words: ['journée', 'internationale', 'des', 'travailleurs'], name: 'workers-day' },
];

/** "Noël", "Pâques 2018", "le prochain nouvel an", "la dernière Pâques". */
const frHoliday: Rule = (tokens, i) => {
  let at = i;
  let dir: 'prev' | 'next' | undefined;
  const w0 = word(tokens[at]);
  if (w0 === 'le' || w0 === 'la') at += 1;
  const mod0 = word(tokens[at]);
  if (mod0 === 'prochain' || mod0 === 'prochaine') {
    dir = 'next';
    at += 1;
  } else if (mod0 === 'dernier' || mod0 === 'dernière' || mod0 === 'derniere') {
    dir = 'prev';
    at += 1;
  }
  for (const h of HOLIDAYS) {
    let k = 0;
    while (k < h.words.length && word(tokens[at + k]) === h.words[k]) k += 1;
    if (k !== h.words.length) continue;
    let end = at + k;
    const post = word(tokens[end]);
    if (dir === undefined) {
      if (post === 'prochain' || post === 'prochaine' || post === 'suivant' || post === 'suivante') {
        dir = 'next';
        end += 1;
      } else if (post === 'dernier' || post === 'dernière' || post === 'derniere' || post === 'précédente' || post === 'précédent') {
        dir = 'prev';
        end += 1;
      }
    }
    const year = yearAt(tokens, end);
    const expr: TimeExpr = { op: 'holiday', name: h.name };
    if (year !== undefined) {
      expr.year = year;
      end += 1;
    }
    if (dir !== undefined) expr.dir = dir;
    return { expr, consumed: end - i, confidence: 1, role: 'date' };
  }
  return undefined;
};

/** "les années 1990" / "1990s" / "90s" → decade span. */
const frDecade: Rule = (tokens, i) => {
  const w = word(tokens[i]);
  const m = w?.match(/^(\d{2}|\d{4})s$/);
  if (m) {
    const y = m[1]!.length === 2 ? 1900 + Number(m[1]) : Number(m[1]);
    return {
      expr: { op: 'span', anchor: { op: 'literal', date: { year: y } }, amount: { years: 10 } },
      consumed: 1,
      confidence: 0.95,
      role: 'date',
    };
  }
  if ((w === 'les' || w === 'des') && (word(tokens[i + 1]) === 'années' || word(tokens[i + 1]) === 'annees')) {
    const t = tokens[i + 2];
    if (t?.type === 'number' && t.value >= 1000 && t.value % 10 === 0) {
      return {
        expr: { op: 'span', anchor: { op: 'literal', date: { year: t.value } }, amount: { years: 10 } },
        consumed: 3,
        confidence: 1,
        role: 'date',
      };
    }
  }
  return undefined;
};

/* ------------------------- fin / début / milieu ------------------------- */

interface EdgeScope {
  expr: TimeExpr;
  kind: 'day' | 'unit' | 'year' | 'month' | 'period' | 'other';
  unit?: Unit;
  year?: number;
  month?: number;
  consumed: number;
}

/** Scope after "fin de": a unit, deictic day, weekday, month, or year. */
function readEdgeScope(tokens: Token[], i: number): EdgeScope | undefined {
  let at = i;
  const w0 = word(tokens[at]);
  if (w0 === 'la' || w0 === 'le' || w0 === 'ce' || w0 === 'cette' || w0 === 'cet') at += 1;
  let w = word(tokens[at]);
  const sw = stripElision(w);
  const deictic = FR_LEXICON.deictic[w ?? ''];
  if (deictic !== undefined) {
    return { expr: snapOffset(deictic, 'day'), kind: 'day', consumed: at + 1 - i };
  }
  const wd = WEEKDAYS[w ?? ''];
  if (wd) {
    return {
      expr: { op: 'seek', base: NOW, dir: 'nearest', target: { kind: 'weekday', weekday: wd } },
      kind: 'day',
      consumed: at + 1 - i,
    };
  }
  const year = yearAt(tokens, at);
  if (year !== undefined) {
    return { expr: { op: 'literal', date: { year } }, kind: 'year', year, consumed: at + 1 - i };
  }
  const month = MONTHS[w ?? ''] ?? MONTHS[sw ?? ''];
  if (month !== undefined) {
    return { expr: { op: 'literal', date: { month } }, kind: 'month', month, consumed: at + 1 - i };
  }
  const pw = readPeriodWord(tokens, at);
  if (pw !== undefined) {
    return {
      expr: { op: 'intersect', parts: [snapNow('day'), { op: 'literal', dayPeriod: pw.period }] },
      kind: 'period',
      consumed: at + pw.consumed - i,
    };
  }
  const unit = FR_LEXICON.units[w ?? ''] ?? FR_LEXICON.units[sw ?? ''];
  if (unit !== undefined) {
    // "cette année" / "l'année" / "la semaine" — current unit.
    const mod = word(tokens[at + 1]);
    let delta = 0;
    let consumed = at + 1 - i;
    if (mod !== undefined && FR_LEXICON.postMods[mod] !== undefined) {
      delta = FR_LEXICON.postMods[mod]!;
      consumed += 1;
    }
    return {
      expr: delta === 0 ? snapNow(unit) : snapOffset(delta, unit),
      kind: 'unit',
      unit,
      consumed,
    };
  }
  return undefined;
}

function edgeExpr(mode: 'end' | 'start' | 'mid', scope: EdgeScope): TimeExpr {
  if (scope.kind === 'day') {
    return { op: 'snap', base: scope.expr, unit: 'day', edge: mode === 'end' ? 'end' : 'start' };
  }
  if (scope.kind === 'year' && scope.year !== undefined) {
    const startMonth = mode === 'start' ? 1 : mode === 'mid' ? 5 : 9;
    return {
      op: 'span',
      anchor: { op: 'literal', date: { year: scope.year, month: startMonth } },
      amount: { months: 4 },
    };
  }
  // Half-splits of the current week/month/year — fixed splits, deliberately
  // not clamped to the reference (matching en's "end of month").
  if (scope.kind === 'unit' && scope.unit !== undefined && scope.unit !== 'day') {
    const unit = scope.unit;
    const startPoint: TimeExpr = { op: 'snap', base: scope.expr, unit, edge: 'start' };
    const endPoint: TimeExpr = { op: 'snap', base: scope.expr, unit, edge: 'end' };
    const midOffset: TimeExpr =
      unit === 'week'
        ? { op: 'offset', base: startPoint, amount: 3, unit: 'day' }
        : unit === 'month'
          ? { op: 'offset', base: startPoint, amount: 15, unit: 'day' }
          : unit === 'year'
            ? { op: 'offset', base: startPoint, amount: 6, unit: 'month' }
            : { op: 'offset', base: startPoint, amount: 45, unit: 'day' };
    if (mode === 'end') return { op: 'between', start: midOffset, end: endPoint };
    if (mode === 'start') return { op: 'between', start: startPoint, end: midOffset };
    return { ...scope.expr, mod: 'mid' };
  }
  return { ...scope.expr, mod: mode === 'mid' ? 'mid' : mode };
}

/** "à la fin de cette année", "en fin de journée", "au début de 2008", "la mi-novembre". */
const frEdge: Rule = (tokens, i) => {
  let at = i;
  const w0 = word(tokens[at]);
  if (w0 === 'à' || w0 === 'a' || w0 === 'au' || w0 === 'en') at += 1;
  if (word(tokens[at]) === 'la' || word(tokens[at]) === 'le') at += 1;
  let ew = word(tokens[at]);
  let mode: 'end' | 'start' | 'mid' | undefined;
  if (ew === 'fin') mode = 'end';
  else if (ew === 'début' || ew === 'debut') mode = 'start';
  else if (ew === 'milieu') mode = 'mid';
  else if (ew === 'mi') mode = 'mid';
  if (mode === undefined) return undefined;
  at += 1;
  if (mode === 'mid' && ew === 'mi') {
    // "mi-novembre" splits? no — "mi" is < 2 chars… but "mi septembre" & "mi" "-" month.
    if (word(tokens[at]) === '-') at += 1;
  } else {
    const dw = word(tokens[at]);
    if (dw === 'de' || dw === 'du' || dw === 'des') {
      at += 1;
    } else if (dw !== undefined && /^d['']/.test(dw)) {
      // "fin d'année": elided scope inside the next token — fake a rewind by
      // handling it directly.
      const sw = stripElision(dw);
      const unit = FR_LEXICON.units[sw ?? ''];
      const month = MONTHS[sw ?? ''];
      if (unit !== undefined) {
        return {
          expr: edgeExpr(mode, { expr: snapNow(unit), kind: 'unit', unit, consumed: 0 }),
          consumed: at + 1 - i,
          confidence: 0.95,
          role: 'date',
        };
      }
      if (month !== undefined) {
        return {
          expr: edgeExpr(mode, { expr: { op: 'literal', date: { month } }, kind: 'month', month, consumed: 0 }),
          consumed: at + 1 - i,
          confidence: 0.95,
          role: 'date',
        };
      }
      const period = PERIODS[sw ?? ''];
      if (period !== undefined) {
        return {
          expr: {
            op: 'intersect',
            parts: [snapNow('day'), { op: 'literal', dayPeriod: period }],
            mod: mode === 'mid' ? 'mid' : mode,
          },
          consumed: at + 1 - i,
          confidence: 0.95,
          role: 'datetime',
        };
      }
      return undefined;
    }
  }
  const scope = readEdgeScope(tokens, at);
  if (!scope) return undefined;
  return {
    expr: edgeExpr(mode, scope),
    consumed: at + scope.consumed - i,
    confidence: 0.95,
    role: 'date',
  };
};

/** "tôt le matin", "plus tard dans l'après-midi", "tôt dans la journée". */
const frEarlyLate: Rule = (tokens, i) => {
  let at = i;
  let mode: 'start' | 'end' | undefined;
  const w0 = word(tokens[at]);
  if (w0 === 'tôt' || w0 === 'tot') {
    mode = 'start';
    at += 1;
  } else if (w0 === 'tard') {
    mode = 'end';
    at += 1;
  } else if (w0 === 'plus') {
    const w1 = word(tokens[at + 1]);
    if (w1 === 'tôt' || w1 === 'tot') mode = 'start';
    else if (w1 === 'tard') mode = 'end';
    else return undefined;
    at += 2;
  } else {
    return undefined;
  }
  let filler = 0;
  while (filler < 2) {
    const fw = word(tokens[at]);
    if (fw === 'dans' || fw === 'le' || fw === 'la' || fw === 'ce' || fw === 'cet' || fw === 'cette' || fw === 'en') {
      at += 1;
      filler += 1;
    } else break;
  }
  const pw = readPeriodWord(tokens, at);
  if (pw !== undefined) {
    return {
      expr: {
        op: 'intersect',
        parts: [snapNow('day'), { op: 'literal', dayPeriod: pw.period }],
        mod: mode,
      },
      consumed: at + pw.consumed - i,
      confidence: 0.95,
      role: 'datetime',
    };
  }
  const uw = word(tokens[at]);
  const unit = FR_LEXICON.units[uw ?? ''] ?? FR_LEXICON.units[stripElision(uw) ?? ''];
  if (unit !== undefined && unit !== 'hour' && unit !== 'minute' && unit !== 'second') {
    let end = at + 1;
    if (word(tokens[end]) === '-' && word(tokens[end + 1]) === 'ci') end += 2;
    return {
      expr: { ...snapNow(unit), mod: mode },
      consumed: end - i,
      confidence: 0.95,
      role: 'date',
    };
  }
  const deictic = FR_LEXICON.deictic[uw ?? ''];
  if (deictic !== undefined) {
    return {
      expr: { ...snapOffset(deictic, 'day'), mod: mode },
      consumed: at + 1 - i,
      confidence: 0.95,
      role: 'date',
    };
  }
  return undefined;
};

/** Quarters and halves: "2017-trimestre1", "q1 de 2017", "2019 H2", "trimestre3 2019". */
function readQuarter(
  tokens: Token[],
  i: number,
): { start: number; months: number; year: number; consumed: number } | undefined {
  const w = word(tokens[i]);
  let m = w?.match(/^([12]\d{3})-?(?:trimestre|q)([1-4])$/);
  if (m) return { year: Number(m[1]), start: (Number(m[2]) - 1) * 3 + 1, months: 3, consumed: 1 };
  m = w?.match(/^([12]\d{3})-?h([12])$/);
  if (m) return { year: Number(m[1]), start: (Number(m[2]) - 1) * 6 + 1, months: 6, consumed: 1 };
  m = w?.match(/^(?:trimestre|q)([1-4])(?:-([12]\d{3}))?$/);
  if (m) {
    const q = Number(m[1]);
    if (m[2] !== undefined) return { year: Number(m[2]), start: (q - 1) * 3 + 1, months: 3, consumed: 1 };
    let at = i + 1;
    if (word(tokens[at]) === 'de' || word(tokens[at]) === 'du') at += 1;
    const y = yearAt(tokens, at);
    if (y !== undefined) return { year: y, start: (q - 1) * 3 + 1, months: 3, consumed: at + 1 - i };
    return undefined;
  }
  m = w?.match(/^h([12])$/);
  if (m) {
    const y = yearAt(tokens, i + 1);
    if (y !== undefined) return { year: y, start: (Number(m[1]) - 1) * 6 + 1, months: 6, consumed: 2 };
    return undefined;
  }
  const y0 = yearAt(tokens, i);
  if (y0 !== undefined) {
    const nw = word(tokens[i + 1]);
    const qm = nw?.match(/^(?:trimestre|q)([1-4])$/);
    if (qm) return { year: y0, start: (Number(qm[1]) - 1) * 3 + 1, months: 3, consumed: 2 };
    const hm2 = nw?.match(/^h([12])$/);
    if (hm2) return { year: y0, start: (Number(hm2[1]) - 1) * 6 + 1, months: 6, consumed: 2 };
  }
  return undefined;
}

function quarterExpr(q: { start: number; months: number; year: number }): TimeExpr {
  return {
    op: 'span',
    anchor: { op: 'literal', date: { year: q.year, month: q.start } },
    amount: { months: q.months },
  };
}

const frQuarter: Rule = (tokens, i) => {
  const q = readQuarter(tokens, i);
  if (!q) return undefined;
  return { expr: quarterExpr(q), consumed: q.consumed, confidence: 0.95, role: 'date' };
};

/** Slash dates with a month name: "oct/2", "02/oct", "23/sep/2020", "01/août/2019". */
const frSlashDate: Rule = (tokens, i) => {
  const w = word(tokens[i]);
  if (w === undefined || !w.includes('/') || /^[\d/]+$/.test(w)) return undefined;
  const segments = w.split('/');
  if (segments.length < 2 || segments.length > 3) return undefined;
  let month: number | undefined;
  let day: number | undefined;
  let year: number | undefined;
  for (const seg of segments) {
    const m = MONTHS[seg];
    if (m !== undefined) {
      if (month !== undefined) return undefined;
      month = m;
      continue;
    }
    if (!/^\d{1,4}$/.test(seg)) return undefined;
    const v = Number(seg);
    if (v >= 1000) {
      if (year !== undefined) return undefined;
      year = v;
    } else if (v >= 1 && v <= 31) {
      if (day !== undefined) return undefined;
      day = v;
    } else {
      return undefined;
    }
  }
  if (month === undefined) return undefined;
  const date: PartialDate = { month };
  if (day !== undefined) date.day = day;
  if (year !== undefined) date.year = year;
  return { expr: { op: 'literal', date }, consumed: 1, confidence: 0.95, role: 'date' };
};

/** Space-separated numeric dates: "02 04 2009", "18 8 78". */
const frSpacedDate: Rule = (tokens, i) => {
  const t1 = tokens[i];
  // "23-2020-septembre" → day · - · year · - · month tokens.
  if (t1?.type === 'number' && !t1.ordinal && t1.value >= 1 && t1.value <= 31 && word(tokens[i + 1]) === '-') {
    const yTok = tokens[i + 2];
    if (yTok?.type === 'number' && yTok.value >= 1000 && yTok.value <= 2999 && word(tokens[i + 3]) === '-') {
      const month = MONTHS[word(tokens[i + 4]) ?? ''];
      if (month !== undefined) {
        return {
          expr: { op: 'literal', date: { day: t1.value, month, year: yTok.value } },
          consumed: 5,
          confidence: 0.9,
          role: 'date',
        };
      }
    }
  }
  const t2 = tokens[i + 1];
  const t3 = tokens[i + 2];
  if (t1?.type !== 'number' || t2?.type !== 'number' || t3?.type !== 'number') return undefined;
  if (t1.ordinal || t2.ordinal || t3.ordinal) return undefined;
  if (t3.value < 32 || t3.value > 2999 || (t3.value > 99 && t3.value < 1900)) return undefined;
  const year = century(t3.value);
  const valid = (d: number, m: number): boolean => d >= 1 && d <= 31 && m >= 1 && m <= 12;
  let day = t1.value;
  let month = t2.value;
  if (!valid(day, month)) {
    day = t2.value;
    month = t1.value;
    if (!valid(day, month)) return undefined;
  }
  // Not a duration ("2 heures 50 minutes" never reaches here — t3 is a year).
  return {
    expr: { op: 'literal', date: { year, month, day } },
    consumed: 3,
    confidence: 0.9,
    role: 'date',
  };
};

/** Bare 4-digit year: "La gamme est de 2014". */
const frBareYear: Rule = (tokens, i) => {
  const t = tokens[i];
  if (t?.type !== 'number' || t.ordinal || t.value < 1900 || t.value > 2159) return undefined;
  return {
    expr: { op: 'literal', date: { year: t.value } },
    consumed: 1,
    confidence: 0.6,
    role: 'date',
  };
};

/** "l'année calendaire 2008" / "cy 2008" / "cy18". */
const frYearCal: Rule = (tokens, i) => {
  const w = word(tokens[i]);
  const m = w?.match(/^cy(\d{2,4})?$/);
  if (m) {
    if (m[1] !== undefined) {
      return {
        expr: { op: 'literal', date: { year: century(Number(m[1])) } },
        consumed: 1,
        confidence: 0.9,
        role: 'date',
      };
    }
    const t = tokens[i + 1];
    if (t?.type === 'number' && !t.ordinal && (t.value >= 1900 || t.value <= 99)) {
      return {
        expr: { op: 'literal', date: { year: century(t.value) } },
        consumed: 2,
        confidence: 0.9,
        role: 'date',
      };
    }
    return undefined;
  }
  const sw = stripElision(w);
  if ((sw === 'année' || sw === 'annee') && (word(tokens[i + 1]) === 'calendaire' || word(tokens[i + 1]) === 'civile')) {
    const y = yearAt(tokens, i + 2);
    if (y !== undefined) {
      return { expr: { op: 'literal', date: { year: y } }, consumed: 3, confidence: 1, role: 'date' };
    }
    return { expr: snapNow('year'), consumed: 2, confidence: 0.9, role: 'date' };
  }
  // "l'année 2008" → that year.
  if (sw === 'année' || sw === 'annee') {
    const y = yearAt(tokens, i + 1);
    if (y !== undefined) {
      return { expr: { op: 'literal', date: { year: y } }, consumed: 2, confidence: 1, role: 'date' };
    }
  }
  return undefined;
};

/** "3 jours à partir de mardi", "2 semaines avant Noël", "3 jours après le 12 janvier". */
const frNAfterDate: Rule = (tokens, i, ctx) => {
  let at = i;
  if (word(tokens[at]) === 'dans' || word(tokens[at]) === 'en') at += 1;
  const n = readWordNum(tokens, at);
  if (!n) return undefined;
  at += n.consumed;
  const unit = FR_LEXICON.units[word(tokens[at]) ?? ''];
  if (!unit) return undefined;
  at += 1;
  let sign: 1 | -1 | undefined;
  const cw = word(tokens[at]);
  if (cw === 'après' || cw === 'apres' || cw === 'depuis') {
    sign = 1;
    at += 1;
  } else if (cw === 'avant') {
    sign = -1;
    at += 1;
  } else if (cw === 'à' || cw === 'a') {
    const c1 = word(tokens[at + 1]);
    if (c1 === 'partir' || c1 === 'compter') {
      sign = 1;
      at += 2;
    } else return undefined;
  } else {
    return undefined;
  }
  if (word(tokens[at]) === 'de' || word(tokens[at]) === 'du') at += 1;
  if (word(tokens[at]) === 'le') at += 1;
  if (stripElision(word(tokens[at])) === 'année' && yearAt(tokens, at + 1) !== undefined) at += 1;
  // Base: deictic day, weekday, holiday, year, or explicit date.
  let base: TimeExpr | undefined;
  let consumed = 0;
  const baseYear = yearAt(tokens, at);
  if (baseYear !== undefined && MONTHS[word(tokens[at + 1]) ?? ''] === undefined) {
    // "en deux ans depuis 2011" → 2 years after the start of 2011.
    const shifted0: TimeExpr = {
      op: 'offset',
      base: { op: 'literal', date: { year: baseYear } },
      amount: sign * n.value,
      unit,
    };
    return {
      expr: { op: 'snap', base: shifted0, unit: 'day' },
      consumed: at + 1 - i,
      confidence: 1,
      role: 'date',
    };
  }
  const bw = word(tokens[at]);
  const deictic = FR_LEXICON.deictic[bw ?? ''] ?? FR_LEXICON.deictic[stripElision(bw) === bw ? '' : `d'${stripElision(bw)}`];
  const deicticDirect = FR_LEXICON.deictic[bw ?? ''];
  if (deicticDirect !== undefined) {
    base = snapOffset(deicticDirect, 'day');
    consumed = 1;
  } else if (WEEKDAYS[bw ?? '']) {
    base = { op: 'seek', base: NOW, dir: 'nearest', target: { kind: 'weekday', weekday: WEEKDAYS[bw ?? '']! } };
    consumed = 1;
    const pmw = word(tokens[at + 1]);
    if (pmw === 'prochain' || pmw === 'suivant') {
      base = { op: 'seek', base: NOW, dir: 'next', target: { kind: 'weekday', weekday: WEEKDAYS[bw ?? '']! } };
      consumed = 2;
    }
  } else {
    const inner =
      frHoliday(tokens, at, ctx) ?? frDayMonth(tokens, at, ctx) ?? frNumdate(tokens, at, ctx);
    if (inner) {
      base = inner.expr;
      consumed = inner.consumed;
    }
  }
  void deictic;
  if (!base) return undefined;
  const shifted: TimeExpr = { op: 'offset', base, amount: sign * n.value, unit };
  const subDay = unit === 'hour' || unit === 'minute' || unit === 'second';
  return {
    expr: subDay ? shifted : { op: 'snap', base: shifted, unit: 'day' },
    consumed: at + consumed - i,
    confidence: 1,
    role: 'date',
  };
};

/* ------------------------------ week-of ------------------------------ */

/** "la semaine du 10 avril", "la première semaine de janvier 2015", "la 3e semaine de 2018". */
const frWeekOf: Rule = (tokens, i, ctx) => {
  let at = i;
  if (word(tokens[at]) === 'la') at += 1;
  let nth: number | 'last' | undefined;
  const nw = word(tokens[at]);
  if (nw !== undefined && ORDINAL_WORDS[nw] !== undefined) {
    nth = ORDINAL_WORDS[nw]!;
    at += 1;
  } else if (nw === 'dernière' || nw === 'derniere') {
    nth = 'last';
    at += 1;
  } else {
    const ow = ordinalWord(nw);
    if (ow !== undefined && ow <= 5) {
      nth = ow;
      at += 1;
    }
  }
  if (word(tokens[at]) !== 'semaine') return undefined;
  at += 1;
  // "la semaine commençant le 4 février" → week of that date.
  const cw = word(tokens[at]);
  if (cw === 'commençant' || cw === 'commencant' || cw === 'débutant') {
    const inner = frDayMonth(tokens, at + 1, ctx) ?? frNumdate(tokens, at + 1, ctx);
    if (inner) {
      return {
        expr: { op: 'snap', base: inner.expr, unit: 'week' },
        consumed: at + 1 + inner.consumed - i,
        confidence: 1,
        role: 'date',
      };
    }
    return undefined;
  }
  let dw = word(tokens[at]);
  let scope: TimeExpr | undefined;
  let scopeUnit: Unit = 'month';
  let consumed = 0;
  if (dw === 'du' || dw === 'de' || dw === "d'" || (dw !== undefined && /^d['']/.test(dw))) {
    const elided = dw !== undefined && /^d['']/.test(dw) && dw.length > 2 ? stripElision(dw) : undefined;
    if (elided !== undefined) {
      const month = MONTHS[elided];
      if (month !== undefined) {
        scope = { op: 'literal', date: { month } };
        consumed = 1;
        const y = yearAt(tokens, at + 1);
        if (y !== undefined) {
          scope = { op: 'literal', date: { month, year: y } };
          consumed = 2;
        }
      } else {
        return undefined;
      }
    } else {
      at += 1;
      // date scope: "du 10 avril" / "du 18"
      const inner = frDayMonth(tokens, at, ctx) ?? frNumdate(tokens, at, ctx);
      if (inner && nth === undefined) {
        return {
          expr: { op: 'snap', base: inner.expr, unit: 'week' },
          consumed: at + inner.consumed - i,
          confidence: 1,
          role: 'date',
        };
      }
      const t0 = tokens[at];
      const mw = word(t0);
      const month = MONTHS[mw ?? ''];
      const y0 = yearAt(tokens, at);
      if (month !== undefined) {
        const y = yearAt(tokens, at + 1);
        scope = y !== undefined ? { op: 'literal', date: { month, year: y } } : { op: 'literal', date: { month } };
        consumed = y !== undefined ? 2 : 1;
      } else if (y0 !== undefined) {
        scope = { op: 'literal', date: { year: y0 } };
        scopeUnit = 'year';
        consumed = 1;
      } else if (t0?.type === 'number' && t0.value >= 1 && t0.value <= 31 && nth === undefined) {
        return {
          expr: { op: 'snap', base: { op: 'literal', date: { day: t0.value } }, unit: 'week' },
          consumed: at + 1 - i,
          confidence: 0.9,
          role: 'date',
        };
      } else {
        return undefined;
      }
    }
  } else if (yearAt(tokens, at) !== undefined) {
    scope = { op: 'literal', date: { year: yearAt(tokens, at)! } };
    scopeUnit = 'year';
    consumed = 1;
  } else if (tokens[at]?.type === 'number' && !((tokens[at] as { ordinal?: boolean }).ordinal) && (tokens[at] as { value: number }).value <= 53) {
    // "la semaine 31" → ISO week n of the current year.
    const n = (tokens[at] as { value: number }).value;
    const jan4: TimeExpr = { op: 'snap', base: { op: 'intersect', parts: [snapNow('year'), { op: 'literal', date: { month: 1, day: 4 } }] }, unit: 'week' };
    const expr: TimeExpr = n === 1 ? jan4 : { op: 'offset', base: jan4, amount: n - 1, unit: 'week' };
    return { expr, consumed: at + 1 - i, confidence: 0.9, role: 'date' };
  } else {
    return undefined;
  }

  if (scope === undefined) return undefined;
  if (scope.op === 'literal' && scope.date?.year !== undefined && scope.date.month === undefined) scopeUnit = 'year';
  let expr: TimeExpr;
  if (nth === undefined) {
    expr = { op: 'snap', base: scope, unit: 'week' };
  } else if (nth === 'last') {
    expr = {
      op: 'snap',
      base: {
        op: 'offset',
        base: { op: 'snap', base: scope, unit: scopeUnit, edge: 'end' },
        amount: -4,
        unit: 'day',
      },
      unit: 'week',
    };
  } else {
    const first: TimeExpr = {
      op: 'snap',
      base: { op: 'snap', base: scope, unit: scopeUnit, edge: 'start' },
      unit: 'week',
    };
    expr = nth === 1 ? first : { op: 'offset', base: first, amount: nth - 1, unit: 'week' };
  }
  return { expr, consumed: at + consumed - i, confidence: 1, role: 'date' };
};

/* ------------------------------- ranges ------------------------------- */

type Operand =
  | { kind: 'time'; time: PartialTime }
  | { kind: 'date'; date: PartialDate }
  | { kind: 'month'; month: number; year?: number; mod?: 'start' | 'mid' | 'end' }
  | { kind: 'year'; year: number }
  | { kind: 'num'; value: number }
  | { kind: 'expr'; expr: TimeExpr; timeish?: boolean };

function readRangeOperand(
  tokens: Token[],
  i: number,
  ctx: Parameters<Rule>[2],
  preferNum = false,
): { op: Operand; consumed: number } | undefined {
  let at = i;
  let guard = 0;
  while (guard < 2) {
    const w0 = word(tokens[at]);
    if (w0 === 'le' || w0 === 'la' || w0 === 'les' || w0 === 'ce' || w0 === 'cette' || w0 === 'cet') at += 1;
    else break;
    guard += 1;
  }
  const t = tokens[at];
  const w = word(t);
  const sw = stripElision(w);

  if (w === 'maintenant') return { op: { kind: 'expr', expr: NOW }, consumed: at + 1 - i };
  if (w === 'jour' && at > i) return { op: { kind: 'expr', expr: snapNow('day') }, consumed: at + 1 - i };
  const deictic = FR_LEXICON.deictic[w ?? ''] ?? FR_LEXICON.deictic[sw ?? ''];
  if (deictic !== undefined) {
    return { op: { kind: 'expr', expr: snapOffset(deictic, 'day') }, consumed: at + 1 - i };
  }

  // fin/début/milieu of a scope.
  let ew = w;
  let mode: 'end' | 'start' | 'mid' | undefined;
  if (ew === 'fin') mode = 'end';
  else if (ew === 'début' || ew === 'debut') mode = 'start';
  else if (ew === 'milieu') mode = 'mid';
  else if (ew === 'mi') mode = 'mid';
  if (mode !== undefined) {
    let cursor = at + 1;
    const dw = word(tokens[cursor]);
    if (dw === 'de' || dw === 'du' || dw === '-') cursor += 1;
    let inner = readRangeOperand(tokens, cursor, ctx);
    if (!inner && dw !== undefined && /^d['']/.test(dw)) {
      // "fin d'année", "début d'octobre"
      const dsw = stripElision(dw);
      const month = MONTHS[dsw ?? ''];
      if (month !== undefined) {
        return { op: { kind: 'month', month, mod: mode }, consumed: at + 2 - i };
      }
      return undefined;
    }
    if (!inner) return undefined;
    const io = inner.op;
    const consumedAll = cursor + inner.consumed - i;
    // Range boundaries want points/dates, not sub-spans: "de 2007 à la fin de
    // 2008" runs through the END of 2008; "la mi-mars" is March 16.
    if (io.kind === 'year') {
      const lit: TimeExpr = { op: 'literal', date: { year: io.year } };
      const expr: TimeExpr =
        mode === 'mid'
          ? { op: 'offset', base: { op: 'snap', base: lit, unit: 'year', edge: 'start' }, amount: 182, unit: 'day' }
          : { op: 'snap', base: lit, unit: 'year', edge: mode };
      return { op: { kind: 'expr', expr }, consumed: consumedAll };
    }
    if (io.kind === 'month') {
      const date: PartialDate = { month: io.month };
      if (io.year !== undefined) date.year = io.year;
      if (mode === 'mid') {
        return { op: { kind: 'date', date: { ...date, day: 16 } }, consumed: consumedAll };
      }
      return {
        op: { kind: 'expr', expr: { op: 'snap', base: { op: 'literal', date }, unit: 'month', edge: mode } },
        consumed: consumedAll,
      };
    }
    if (io.kind === 'expr') {
      return { op: { kind: 'expr', expr: { ...io.expr, mod: mode } }, consumed: consumedAll };
    }
    return undefined;
  }

  // clock forms
  const time = readTime(tokens, at);
  if (time) {
    let cursor = at + time.consumed;
    let pt = time.time;
    const ps = readPeriodSuffix(tokens, cursor);
    if (ps) {
      pt = applyPeriod(pt, ps.period);
      cursor += ps.consumed;
    }
    return { op: { kind: 'time', time: pt }, consumed: cursor - i };
  }
  if (t?.type === 'numdate') {
    const date = numdateToDate(t);
    if (date) return { op: { kind: 'date', date }, consumed: at + 1 - i };
  }
  const wd = WEEKDAYS[w ?? ''];
  if (wd) {
    let cursor = at + 1;
    let dir: 'next' | 'prev' | 'nearest' = 'nearest';
    const pm = word(tokens[cursor]);
    if (pm === 'prochain' || pm === 'suivant') {
      dir = 'next';
      cursor += 1;
    } else if (pm === 'dernier' || pm === 'précédent') {
      dir = 'prev';
      cursor += 1;
    }
    // weekday + explicit date → let date rules own it (skip weekday).
    const dm = frDayMonth(tokens, cursor, ctx) ?? frNumdate(tokens, cursor, ctx);
    if (dm && dm.expr.op === 'literal') {
      return { op: { kind: 'date', date: dm.expr.date! }, consumed: cursor + dm.consumed - i };
    }
    return {
      op: { kind: 'expr', expr: { op: 'seek', base: NOW, dir, target: { kind: 'weekday', weekday: wd } } },
      consumed: cursor - i,
    };
  }
  // Quarters/halves as operands: "du q1 de 2017 au q3 de 2018".
  const q = readQuarter(tokens, at);
  if (q) return { op: { kind: 'expr', expr: quarterExpr(q) }, consumed: at + q.consumed - i };
  const year0 = yearAt(tokens, at);
  const month0 = MONTHS[w ?? ''] ?? MONTHS[sw ?? ''];
  // "de 5 a sept du matin": with a numeric/time left side, the ambiguous
  // "sept" reads as the number 7, not September.
  const numFirst = preferNum && (ONES[w ?? ''] !== undefined || TEENS[w ?? ''] !== undefined);
  if (month0 !== undefined && !numFirst) {
    const y = yearAt(tokens, at + 1);
    if (y !== undefined) return { op: { kind: 'month', month: month0, year: y }, consumed: at + 2 - i };
    return { op: { kind: 'month', month: month0 }, consumed: at + 1 - i };
  }
  // day + month (+ year)
  const dnum = readWordNum(tokens, at);
  if (dnum && dnum.value >= 1 && dnum.value <= 31) {
    let cursor = at + dnum.consumed;
    let mw = word(tokens[cursor]);
    let msw = stripElision(mw);
    if (mw === 'de' || mw === 'du') {
      const m2 = word(tokens[cursor + 1]);
      if (MONTHS[m2 ?? ''] !== undefined) {
        cursor += 1;
        mw = word(tokens[cursor]);
        msw = stripElision(mw);
      }
    }
    const month = MONTHS[mw ?? ''] ?? MONTHS[msw ?? ''];
    if (month !== undefined) {
      cursor += 1;
      let yAt = cursor;
      if (word(tokens[yAt]) === 'de') yAt += 1;
      const y = yearAt(tokens, yAt);
      const date: PartialDate = { day: dnum.value, month };
      if (y !== undefined) {
        date.year = y;
        cursor = yAt + 1;
      }
      return { op: { kind: 'date', date }, consumed: cursor - i };
    }
  }
  if (year0 !== undefined) return { op: { kind: 'year', year: year0 }, consumed: at + 1 - i };
  if (dnum && dnum.value >= 0 && dnum.value <= 31) {
    let cursor = at + dnum.consumed;
    // "5 du matin" / "3 matin" → an hour with a period.
    const ps = readPeriodSuffix(tokens, cursor);
    const pd = ps ?? readPeriodWord(tokens, cursor);
    if (pd !== undefined && dnum.value <= 23) {
      cursor += pd.consumed;
      const time: PartialTime = { hour: dnum.value };
      if (dnum.value <= 12) time.meridiem = meridiemFor(pd.period);
      return { op: { kind: 'time', time }, consumed: cursor - i };
    }
    return { op: { kind: 'num', value: dnum.value }, consumed: cursor - i };
  }
  return undefined;
}

function operandToDateExpr(op: Operand): TimeExpr | undefined {
  switch (op.kind) {
    case 'date':
      return { op: 'literal', date: op.date };
    case 'month': {
      const date: PartialDate = { month: op.month };
      if (op.year !== undefined) date.year = op.year;
      const lit: TimeExpr = { op: 'literal', date };
      return op.mod !== undefined ? { ...lit, mod: op.mod } : lit;
    }
    case 'year':
      return { op: 'literal', date: { year: op.year } };
    case 'expr':
      return op.expr;
    default:
      return undefined;
  }
}

/**
 * A day-number pair followed by a month scope: "du 4 au 23 le mois prochain",
 * "de 4-23 mois prochain". Returns the full range match or undefined.
 */
function finishNumPair(
  tokens: Token[],
  at: number,
  n1: number,
  n2: number,
  ruleStart: number,
): RuleMatch | undefined {
  let cursor = at;
  if (word(tokens[cursor]) === 'le' || word(tokens[cursor]) === 'du' || word(tokens[cursor]) === 'de') cursor += 1;
  if (word(tokens[cursor]) === 'mois') {
    const mod = word(tokens[cursor + 1]);
    const delta = mod === 'prochain' || mod === 'suivant' ? 1 : mod === 'dernier' || mod === 'précédent' ? -1 : undefined;
    if (delta !== undefined && n1 >= 1 && n1 <= 31 && n2 >= 1 && n2 <= 31) {
      const monthExpr = snapOffset(delta, 'month');
      const mk = (d: number): TimeExpr => ({
        op: 'intersect',
        parts: [monthExpr, { op: 'literal', date: { day: d } }],
      });
      return {
        expr: { op: 'between', start: mk(n1), end: mk(n2) },
        consumed: cursor + 2 - ruleStart,
        confidence: 1,
        role: 'date',
      };
    }
  }
  const month = MONTHS[word(tokens[cursor]) ?? ''] ?? MONTHS[stripElision(word(tokens[cursor])) ?? ''];
  if (month !== undefined && n1 >= 1 && n1 <= 31 && n2 >= 1 && n2 <= 31) {
    const y = yearAt(tokens, cursor + 1);
    const mk = (d: number): TimeExpr =>
      y !== undefined
        ? { op: 'literal', date: { day: d, month, year: y } }
        : { op: 'literal', date: { day: d, month } };
    return {
      expr: { op: 'between', start: mk(n1), end: mk(n2) },
      consumed: (y !== undefined ? cursor + 2 : cursor + 1) - ruleStart,
      confidence: 1,
      role: 'date',
    };
  }
  return undefined;
}

/** "de X à Y" / "entre X et Y" / "du X au Y" ranges. */
const frRange: Rule = (tokens, i, ctx) => {
  let at = i;
  const w0 = word(tokens[at]);
  let hasPrefix = false;
  let elidedFirst: string | undefined;
  if (w0 === 'de' || w0 === 'du' || w0 === 'entre' || w0 === 'des') {
    hasPrefix = true;
    at += 1;
  } else if (w0 !== undefined && /^d['']/.test(w0) && w0.length > 2) {
    // "d'avril à …" — prefix and operand fused in one token.
    hasPrefix = true;
    elidedFirst = stripElision(w0);
  }

  // Joined pair after a prefix: "de 4-23 mois prochain".
  const joinedPair = hasPrefix ? word(tokens[at])?.match(/^(\d{1,2})-(\d{1,2})$/) : null;
  if (joinedPair) {
    const scoped = finishNumPair(tokens, at + 1, Number(joinedPair[1]), Number(joinedPair[2]), i);
    if (scoped) return scoped;
  }

  let a: Operand;
  let consumedA: number;
  if (elidedFirst !== undefined) {
    const month = MONTHS[elidedFirst];
    const deictic = FR_LEXICON.deictic[word(tokens[at]) ?? ''];
    if (month !== undefined) {
      const y = yearAt(tokens, at + 1);
      if (y !== undefined) {
        a = { kind: 'month', month, year: y };
        consumedA = 2;
      } else {
        a = { kind: 'month', month };
        consumedA = 1;
      }
    } else if (deictic !== undefined) {
      a = { kind: 'expr', expr: snapOffset(deictic, 'day') };
      consumedA = 1;
    } else {
      return undefined;
    }
  } else {
    const read = readRangeOperand(tokens, at, ctx);
    if (!read) return undefined;
    a = read.op;
    consumedA = read.consumed;
  }
  at += consumedA;

  const conn = word(tokens[at]);
  const connOk =
    conn === 'à' || conn === 'a' || conn === 'au' || conn === 'aux' || conn === '-' || conn === '~' ||
    conn === "jusqu'à" || conn === "jusqu'au" || conn === "jusqu'a" ||
    (conn === 'et' && hasPrefix);
  if (!connOk) return undefined;
  // Plain "N à M" without prefix is too loose unless timeish.
  if (!hasPrefix && a.kind !== 'time' && a.kind !== 'num') return undefined;
  at += 1;

  const readB = readRangeOperand(tokens, at, ctx, a.kind === 'num' || a.kind === 'time');
  if (!readB) return undefined;
  let b = readB.op;
  at += readB.consumed;

  // Shared suffixes -----------------------------------------------------
  // Month scope after a number pair: "du 18 au 19 novembre", "du 9 au 12 de
  // juin", "du 4 au 23 le mois prochain".
  if (a.kind === 'num' && b.kind === 'num') {
    const scoped = finishNumPair(tokens, at, a.value, b.value, i);
    if (scoped) return scoped;
  }
  // Month applies backward when only B got it: "du 4 novembre au 5 février 2017"
  if (a.kind === 'num' && b.kind === 'date') {
    a = { kind: 'date', date: { day: a.value, month: b.date.month! } };
  }
  // Shared trailing year for month/date pairs: "de janvier à février 2017".
  if (b.kind === 'month' && b.year !== undefined && a.kind === 'month' && a.year === undefined && a.month <= b.month) {
    a = { ...a, year: b.year };
  }
  if (b.kind === 'date' && b.date.year !== undefined && a.kind === 'date' && a.date.year === undefined) {
    const am = a.date.month ?? 0;
    const bm = b.date.month ?? 0;
    if (am < bm || (am === bm && (a.date.day ?? 0) <= (b.date.day ?? 32))) {
      a = { kind: 'date', date: { ...a.date, year: b.date.year } };
    }
  }
  // Trailing year applying to both dates: "du 01/05 au 07/05, 2020".
  if (a.kind === 'date' && b.kind === 'date' && a.date.year === undefined && b.date.year === undefined) {
    const y = yearAt(tokens, at);
    if (y !== undefined) {
      a = { kind: 'date', date: { ...a.date, year: y } };
      b = { kind: 'date', date: { ...b.date, year: y } };
      at += 1;
    }
  }
  // Trailing period: "entre 5h et 6h de l'après-midi".
  const ps = readPeriodSuffix(tokens, at);
  let sharedPeriod: DayPeriod | undefined;
  if (ps && (a.kind === 'time' || a.kind === 'num') && (b.kind === 'time' || b.kind === 'num')) {
    sharedPeriod = ps.period;
    at += ps.consumed;
  }

  // Build ---------------------------------------------------------------
  const numToTime = (n: number): PartialTime => (n <= 12 ? { hour: n, meridiem: 'unknown' } : { hour: n });
  const timeish = (o: Operand): boolean => o.kind === 'time' || o.kind === 'num';
  const asTime = (o: Operand): PartialTime | undefined =>
    o.kind === 'time' ? o.time : o.kind === 'num' ? numToTime(o.value) : undefined;
  if (timeish(a) && timeish(b)) {
    let ta: PartialTime = asTime(a)!;
    let tb: PartialTime = asTime(b)!;
    if (sharedPeriod !== undefined) {
      ta = applyPeriod(ta, sharedPeriod);
      tb = applyPeriod(tb, sharedPeriod);
    }
    // Share B's meridiem with A within the same half of the day.
    if (ta.meridiem === 'unknown' && tb.meridiem !== undefined && tb.meridiem !== 'unknown' && (ta.hour ?? 0) < (tb.hour ?? 0)) {
      ta = { ...ta, meridiem: tb.meridiem };
    }
    return {
      expr: { op: 'between', start: timeLiteral(ta), end: timeLiteral(tb) },
      consumed: at - i,
      confidence: hasPrefix ? 0.95 : 0.85,
      role: 'time',
    };
  }
  const dayLit = (o: Operand): TimeExpr | undefined =>
    o.kind === 'num' ? { op: 'literal', date: { day: o.value } } : undefined;
  const ea = operandToDateExpr(a) ?? dayLit(a);
  const eb = operandToDateExpr(b) ?? dayLit(b);
  if (!ea || !eb) return undefined;
  if (!hasPrefix) return undefined;
  return {
    expr: { op: 'between', start: ea, end: eb },
    consumed: at - i,
    confidence: 0.95,
    role: 'date',
  };
};

/* ------------------------------- lexicon ------------------------------- */

export const FR_LEXICON: LatinLexicon = {
  articles: ['le', 'la', 'les', 'l', 'un', 'une', 'des'],
  units: {
    seconde: 'second', secondes: 'second', sec: 'second',
    minute: 'minute', minutes: 'minute', min: 'minute',
    heure: 'hour', heures: 'hour', "l'heure": 'hour',
    jour: 'day', jours: 'day', journée: 'day', journee: 'day', journées: 'day', journees: 'day',
    semaine: 'week', semaines: 'week',
    mois: 'month',
    trimestre: 'quarter', trimestres: 'quarter',
    an: 'year', ans: 'year', année: 'year', annee: 'year', années: 'year', annees: 'year',
    "l'année": 'year', "l'annee": 'year',
  },
  weekdays: WEEKDAYS,
  months: {
    ...MONTHS,
    "d'avril": 4, "d'août": 8, "d'aout": 8, "d'octobre": 10,
  },
  periods: PERIODS,
  smallNumbers: {
    ...ONES, ...TEENS, ...TENS,
    quelques: 3, plusieurs: 3,
  },
  deictic: {
    "aujourd'hui": 0, "d'aujourd'hui": 0,
    hier: -1,
    demain: 1,
    lendemain: 1,
    'après-demain': 2, 'apres-demain': 2,
    veille: -1,
  },
  deicticPhrases: [
    { words: ['avant', '-', 'hier'], delta: -2 },
    { words: ['apres', '-', 'demain'], delta: 2 },
  ],
  preMods: {
    ce: 0, cet: 0, cette: 0,
    prochain: 1, prochaine: 1,
    dernier: -1, dernière: -1, derniere: -1,
  },
  postMods: {
    prochain: 1, prochaine: 1,
    suivant: 1, suivante: 1,
    dernier: -1, dernière: -1, derniere: -1,
    'passé': -1, 'passée': -1, passe: -1, passee: -1,
    'précédent': -1, 'précédente': -1, precedent: -1, precedente: -1,
  },
  postModPhrases: [
    { words: ['à', 'venir'], delta: 1 },
    { words: ['a', 'venir'], delta: 1 },
    { words: ['en', 'cours'], delta: 0 },
    { words: ['-', 'ci'], delta: 0 },
  ],
  agoPrefixes: [
    ['il', 'y', 'a', 'à', 'peu', 'près'],
    ['il', 'y', 'a', 'environ'],
    ['il', 'y', 'a'],
    ['il', 'ya'],
  ],
  inPrefixes: [['dans'], ["d'ici"], ['en']],
  lastNAdjs: ['derniers', 'dernières', 'dernieres', 'passés', 'passées'],
  nextNAdjs: ['prochains', 'prochaines', 'suivants', 'suivantes'],
  atPhrases: [['à'], ['a'], ['vers']],
  periodMarkers: [
    ['dans', 'la'], ['dans', 'le'], ['dans'],
    ['du'], ['de', 'la'], ['de', 'le'],
    ['le'], ['la'], ['en'], ['au'],
  ],
  dateSep: ['de', 'du'],
  weekendPhrases: [['week', '-', 'end'], ['weekend'], ['week-end-là']],
  specialPhrases: [
    { words: ['maintenant'], expr: NOW, role: 'datetime' },
    { words: ['ce', 'jour'], expr: { op: 'snap', base: NOW, unit: 'day' }, role: 'date' },
    { words: ['dîner'], expr: { op: 'literal', dayPeriod: 'evening' }, role: 'time' },
    { words: ['diner'], expr: { op: 'literal', dayPeriod: 'evening' }, role: 'time' },
    {
      // Lunch block per Recognizers: 11:00–13:00.
      words: ['déjeuner'],
      expr: {
        op: 'between',
        start: { op: 'literal', time: { hour: 11 } },
        end: { op: 'literal', time: { hour: 13 } },
      },
      role: 'time',
    },
    { words: ['le', 'plus', 'tôt', 'possible'], expr: NOW, role: 'datetime' },
    { words: ['dès', 'que', 'possible'], expr: NOW, role: 'datetime' },
    // Recognizers-French reads "<day> soir" as the night block (20:00–24:00)
    // but "ce soir" as the evening; encode the day-qualified forms explicitly.
    {
      words: ['hier', 'soir'],
      expr: {
        op: 'intersect',
        parts: [snapOffset(-1, 'day'), { op: 'literal', dayPeriod: 'night' }],
      },
    },
    {
      words: ['demain', 'soir'],
      expr: {
        op: 'intersect',
        parts: [snapOffset(1, 'day'), { op: 'literal', dayPeriod: 'night' }],
      },
    },
    {
      words: ['lendemain', 'soir'],
      expr: {
        op: 'intersect',
        parts: [snapOffset(1, 'day'), { op: 'literal', dayPeriod: 'night' }],
      },
    },
  ],
  noonWords: ['midi'],
  midnightWords: ['minuit'],
};

const frExtras: { name: string; rule: Rule }[] = [
  { name: 'fr-range', rule: frRange },
  { name: 'fr-week-of', rule: frWeekOf },
  { name: 'fr-n-after-date', rule: frNAfterDate },
  { name: 'fr-early-late', rule: frEarlyLate },
  { name: 'fr-edge', rule: frEdge },
  { name: 'fr-quarter', rule: frQuarter },
  { name: 'fr-slash-date', rule: frSlashDate },
  { name: 'fr-spaced-date', rule: frSpacedDate },
  { name: 'fr-year-cal', rule: frYearCal },
  { name: 'fr-bare-year', rule: frBareYear },
  { name: 'fr-duration', rule: frDuration },
  { name: 'fr-all-unit', rule: frAllUnit },
  { name: 'fr-n-unit-post', rule: frNUnitPost },
  { name: 'fr-next-n-work', rule: frNextNWork },
  { name: 'fr-in-les-h', rule: frInLesH },
  { name: 'fr-time', rule: frTime },
  { name: 'fr-day-month', rule: frDayMonth },
  { name: 'fr-month-first', rule: frMonthFirst },
  { name: 'fr-numdate', rule: frNumdate },
  { name: 'fr-weekday-day', rule: frWeekdayDay },
  { name: 'fr-holiday', rule: frHoliday },
  { name: 'fr-decade', rule: frDecade },
  { name: 'fr-bare-day', rule: frBareDay },
  { name: 'fr-bare-unit', rule: frBareUnit },
  { name: 'fr-bare-period', rule: frBarePeriod },
];

export const FR_RULE_ENTRIES = makeLatinRules(FR_LEXICON, frExtras);

/** Connector words allowed between merged date & time parts. */
export const FR_CONNECTORS = [
  'à', 'a', 'au', 'aux', 'le', 'la', 'les', 'de', 'du', 'des', 'en', 'vers',
  'dans', 'ce', 'cet', 'cette', 'pour', '-',
];
