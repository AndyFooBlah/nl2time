/**
 * Spanish rules: lexicon for the Latin factory plus language-specific extras.
 * Corpus: corpus/forward/imported-recognizers-es.json (issue #13); climb with
 * `node scripts/update-baselines.mjs es`.
 *
 * Corpus conventions that shape this file (Recognizers-derived):
 *   - "tarde" maps to the 16:00–20:00 block (Recognizers' evening), not the
 *     12:00–16:00 afternoon; "pasado mediodía" is the 12:00–16:00 afternoon;
 *     "madrugada" is 04:00–08:00 (expressed structurally — no day period).
 *   - Ordinal markers º/ª are outside the token class, so "1.º"/"3ª" arrive
 *     as plain numbers.
 *   - nth week of a month/year is the week containing the scope's 4th day
 *     (ISO-week-style), not the week of the 1st.
 */
import type { TimeContext } from '../context.js';
import type {
  CalendarAmount, DayPeriod, HolidayName, PartialDate, PartialTime, TimeExpr, Unit,
} from '../ir/types.js';
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

const MONTHS: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10,
  noviembre: 11, diciembre: 12,
  ene: 1, feb: 2, mar: 3, abr: 4, jun: 6, jul: 7, ago: 8, sep: 9,
  sept: 9, oct: 10, nov: 11, dic: 12,
};

const WEEKDAYS: LatinLexicon['weekdays'] = {
  lunes: 'mon', martes: 'tue', miércoles: 'wed', miercoles: 'wed',
  jueves: 'thu', viernes: 'fri', sábado: 'sat', sabado: 'sat', domingo: 'sun',
  lun: 'mon', mar: 'tue', mié: 'wed', mie: 'wed', jue: 'thu', vie: 'fri',
  sáb: 'sat', sab: 'sat', dom: 'sun',
};

/** Recognizers-Spanish: mañana 8–12, "pasado mediodía" 12–16, tarde 16–20, noche 20–24. */
const PERIODS: Record<string, DayPeriod> = {
  mañana: 'morning', manana: 'morning',
  tarde: 'evening',
  noche: 'night',
};

const ONES: Record<string, number> = {
  un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6,
  siete: 7, ocho: 8, nueve: 9,
};

const TEENS: Record<string, number> = {
  diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15,
  dieciséis: 16, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19,
  veintiuno: 21, veintiuna: 21, veintidós: 22, veintidos: 22, veintitrés: 23,
  veintitres: 23, veinticuatro: 24, veinticinco: 25, veintiséis: 26,
  veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29,
};

const TENS: Record<string, number> = {
  veinte: 20, treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60,
  setenta: 70, ochenta: 80, noventa: 90,
};

const HUNDREDS: Record<string, number> = {
  cien: 100, ciento: 100, doscientos: 200, trescientos: 300,
  cuatrocientos: 400, quinientos: 500, seiscientos: 600, setecientos: 700,
  ochocientos: 800, novecientos: 900,
};

const FUZZY: Record<string, number> = {
  unos: 3, unas: 3, algunos: 3, algunas: 3, varios: 3, varias: 3,
};

/** "1er", "1ro", "2do", "3ra", "5to" → ordinal value. */
function ordinalWord(w: string | undefined): number | undefined {
  const m = w?.match(/^(\d{1,2})(?:er|ero|era|ro|ra|do|da|to|ta|mo|ma|vo|va|no|na)$/);
  return m ? Number(m[1]) : undefined;
}

const ORDINAL_WORDS: Record<string, number> = {
  primer: 1, primero: 1, primera: 1,
  segundo: 2, segunda: 2,
  tercer: 3, tercero: 3, tercera: 3,
  cuarto: 4, cuarta: 4,
  quinto: 5, quinta: 5,
  sexto: 6, sexta: 6,
  séptimo: 7, septimo: 7, séptima: 7, septima: 7,
  octavo: 8, octava: 8,
  noveno: 9, novena: 9,
  décimo: 10, decimo: 10, décima: 10, decima: 10,
};

/**
 * Spanish number words including "treinta y cinco", "mil novecientos noventa
 * y dos", "dos mil veintisiete". Digits pass through.
 */
function readWordNum(tokens: Token[], i: number): { value: number; consumed: number } | undefined {
  const t = tokens[i];
  if (t?.type === 'number') return { value: t.value, consumed: 1 };
  const w = word(t);
  if (w === undefined) return undefined;
  const ow = ordinalWord(w);
  if (ow !== undefined) return { value: ow, consumed: 1 };
  if (FUZZY[w] !== undefined) return { value: FUZZY[w]!, consumed: 1 };

  const readBelowThousand = (k: number): { value: number; consumed: number } | undefined => {
    let at = k;
    let v = 0;
    const hw = word(tokens[at]);
    if (hw !== undefined && HUNDREDS[hw] !== undefined) {
      v += HUNDREDS[hw]!;
      at += 1;
    }
    const tw = word(tokens[at]);
    if (tw !== undefined && TENS[tw] !== undefined) {
      v += TENS[tw]!;
      at += 1;
      if (word(tokens[at]) === 'y' && ONES[word(tokens[at + 1]) ?? ''] !== undefined) {
        v += ONES[word(tokens[at + 1])!]!;
        at += 2;
      }
    } else if (tw !== undefined && TEENS[tw] !== undefined) {
      v += TEENS[tw]!;
      at += 1;
    } else if (tw !== undefined && ONES[tw] !== undefined) {
      v += ONES[tw]!;
      at += 1;
    }
    return at === k ? undefined : { value: v, consumed: at - k };
  };

  // "mil …" / "dos mil …"
  let at = i;
  let thousands = 0;
  if (w === 'mil') {
    thousands = 1;
    at += 1;
  } else if (ONES[w] !== undefined && word(tokens[i + 1]) === 'mil') {
    thousands = ONES[w]!;
    at += 2;
  }
  if (thousands > 0) {
    const rest = readBelowThousand(at);
    return { value: thousands * 1000 + (rest?.value ?? 0), consumed: at + (rest?.consumed ?? 0) - i };
  }
  if (ORDINAL_WORDS[w] !== undefined) return { value: ORDINAL_WORDS[w]!, consumed: 1 };
  return readBelowThousand(i);
}

/** Month lookup tolerant of trailing punctuation kept by the tokenizer ("junio:"). */
function monthOf(w: string | undefined): number | undefined {
  if (w === undefined) return undefined;
  return MONTHS[w] ?? MONTHS[w.replace(/[:;,]+$/, '')];
}

function yearAt(tokens: Token[], i: number): number | undefined {
  const t = tokens[i];
  return t?.type === 'number' && !t.ordinal && t.value >= 1000 && t.value <= 2999 ? t.value : undefined;
}

function century(y: number): number {
  return y >= 100 ? y : y >= 30 ? 1900 + y : 2000 + y;
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

function meridiemFor(period: DayPeriod | 'madrugada'): 'am' | 'pm' {
  return period === 'morning' || period === 'madrugada' ? 'am' : 'pm';
}

/** A period noun including the multi-word "pasado [el] mediodía" (afternoon). */
function readPeriodWord(
  tokens: Token[],
  i: number,
): { period: DayPeriod; consumed: number } | undefined {
  const w = word(tokens[i]);
  if (w === 'pasado') {
    let at = i + 1;
    if (word(tokens[at]) === 'el') at += 1;
    const mw = word(tokens[at]);
    if (mw === 'mediodía' || mw === 'mediodia') return { period: 'afternoon', consumed: at + 1 - i };
    return undefined;
  }
  const period = PERIODS[w ?? ''];
  if (period !== undefined) return { period, consumed: 1 };
  return undefined;
}

/**
 * Period suffix after a time: "de la mañana", "de la tarde", "de la noche",
 * "de la madrugada", "por la tarde", "a la tarde", "en la noche".
 */
function readPeriodSuffix(
  tokens: Token[],
  i: number,
): { period: DayPeriod | 'madrugada'; consumed: number } | undefined {
  let at = i;
  const w0 = word(tokens[at]);
  if (w0 !== 'de' && w0 !== 'del' && w0 !== 'por' && w0 !== 'en' && w0 !== 'a') return undefined;
  at += 1;
  if (word(tokens[at]) === 'la' || word(tokens[at]) === 'el') at += 1;
  const w = word(tokens[at]);
  if (w === 'madrugada') return { period: 'madrugada', consumed: at + 1 - i };
  const pw = readPeriodWord(tokens, at);
  if (pw === undefined) return undefined;
  return { period: pw.period, consumed: at + pw.consumed - i };
}

/** Apply a period's meridiem to an ambiguous time. */
function applyPeriod(time: PartialTime, period: DayPeriod | 'madrugada'): PartialTime {
  if (time.meridiem !== undefined && time.meridiem !== 'unknown') return time;
  if (time.hour !== undefined && time.hour > 12) return time;
  return { ...time, meridiem: meridiemFor(period) };
}

/**
 * Clock-time phrase: clock tokens, "20.30", "8: 45", "N y media/cuarto/NN",
 * "N menos cuarto/N", "1140 a.m.", "N en punto", "mediodía", "medianoche".
 * `bare` marks forms that were just a plain number reading.
 */
function readTime(
  tokens: Token[],
  i: number,
): { time: PartialTime; consumed: number; bare: boolean } | undefined {
  let at = i;
  const t = tokens[at];
  const w = word(t);

  if (w === 'mediodía' || w === 'mediodia') {
    return { time: { hour: 12, meridiem: 'pm' }, consumed: 1, bare: false };
  }
  if (w === 'medianoche') return { time: { hour: 12, meridiem: 'am' }, consumed: 1, bare: false };

  const finishClock = (time: PartialTime, consumed: number): { time: PartialTime; consumed: number; bare: boolean } => {
    let c = consumed;
    // "menos cuarto" / "menos N" after the hour.
    if (word(tokens[i + c]) === 'menos') {
      const fw = word(tokens[i + c + 1]);
      if (fw === 'cuarto') {
        time = { ...time, hour: (time.hour ?? 1) === 0 ? 23 : (time.hour ?? 1) - 1, minute: 45 };
        c += 2;
      } else {
        const m = readWordNum(tokens, i + c + 1);
        if (m && m.value >= 1 && m.value <= 59) {
          time = { ...time, hour: (time.hour ?? 1) === 0 ? 23 : (time.hour ?? 1) - 1, minute: 60 - m.value };
          c += 1 + m.consumed;
        }
      }
    }
    // "en punto"
    if (word(tokens[i + c]) === 'en' && word(tokens[i + c + 1]) === 'punto') c += 2;
    // trailing am/pm word
    const mw = word(tokens[i + c]);
    if ((mw === 'am' || mw === 'pm') && (time.meridiem === undefined || time.meridiem === 'unknown')) {
      time = { ...time, meridiem: mw };
      c += 1;
    }
    return { time, consumed: c, bare: false };
  };

  if (t?.type === 'clock') {
    const time: PartialTime = { hour: t.hour };
    if (t.explicitMinute) time.minute = t.minute;
    if (t.second !== undefined) time.second = t.second;
    if (t.meridiem) time.meridiem = t.meridiem;
    else if (t.hour <= 12) time.meridiem = 'unknown';
    return finishClock(time, 1);
  }

  // "7h" — hour with a joined h suffix.
  let m = w?.match(/^(\d{1,2})h$/);
  if (m && Number(m[1]) <= 23) {
    const hour = Number(m[1]);
    const time: PartialTime = { hour };
    if (hour <= 12) time.meridiem = 'unknown';
    return finishClock(time, 1);
  }
  // "20.30" / "8.45" — dot-separated time in a single word token.
  m = w?.match(/^(\d{1,2})\.(\d{2})$/);
  if (m && Number(m[1]) <= 23 && Number(m[2]) <= 59) {
    const hour = Number(m[1]);
    const time: PartialTime = { hour, minute: Number(m[2]) };
    if (hour <= 12) time.meridiem = 'unknown';
    return finishClock(time, 1);
  }
  // "9.30pm" / "4.30pm"
  m = w?.match(/^(\d{1,2})\.(\d{2})(am|pm)$/);
  if (m && Number(m[1]) <= 12 && Number(m[2]) <= 59) {
    return finishClock({ hour: Number(m[1]), minute: Number(m[2]), meridiem: m[3] as 'am' | 'pm' }, 1);
  }
  // "8:" + "45" — a space crept in after the colon.
  m = w?.match(/^(\d{1,2}):$/);
  if (m) {
    const mt = tokens[at + 1];
    if (mt?.type === 'number' && !mt.ordinal && mt.value <= 59) {
      const hour = Number(m[1]);
      if (hour <= 23) {
        const time: PartialTime = { hour, minute: mt.value };
        if (hour <= 12) time.meridiem = 'unknown';
        return finishClock(time, 2);
      }
    }
  }
  // "1140 a.m." — military-style number + meridiem word.
  if (t?.type === 'number' && !t.ordinal && t.value >= 100 && t.value <= 1259) {
    const mw = word(tokens[at + 1]);
    if (mw === 'am' || mw === 'pm') {
      const hour = Math.floor(t.value / 100);
      const minute = t.value % 100;
      if (minute < 60) return { time: { hour, minute, meridiem: mw }, consumed: 2, bare: false };
    }
  }

  // Number/word hour [+ y M | menos M | en punto | am/pm].
  const n = readWordNum(tokens, at);
  if (!n || n.value > 23 || tokens[at]?.type === 'number' && tokens[at]!.type === 'number' && (tokens[at] as { ordinal?: boolean }).ordinal) {
    return undefined;
  }
  at += n.consumed;
  let hour = n.value;
  let minute: number | undefined;
  let explicit = false;
  const nw = word(tokens[at]);
  if (nw === 'y') {
    const fw = word(tokens[at + 1]);
    if (fw === 'media') {
      minute = 30;
      at += 2;
      explicit = true;
    } else if (fw === 'cuarto') {
      minute = 15;
      at += 2;
      explicit = true;
    } else {
      const mnum = readWordNum(tokens, at + 1);
      if (mnum && mnum.value <= 59 && tokens[at + 1]?.type !== 'number') {
        minute = mnum.value;
        at += 1 + mnum.consumed;
        explicit = true;
      } else if (mnum && mnum.value <= 59 && tokens[at + 1]?.type === 'number') {
        minute = mnum.value;
        at += 1 + mnum.consumed;
        explicit = true;
      }
    }
  } else if (nw === 'menos') {
    const fw = word(tokens[at + 1]);
    if (fw === 'cuarto') {
      hour = hour === 0 ? 23 : hour - 1;
      minute = 45;
      at += 2;
      explicit = true;
    } else {
      const mnum = readWordNum(tokens, at + 1);
      if (mnum && mnum.value >= 1 && mnum.value <= 59) {
        hour = hour === 0 ? 23 : hour - 1;
        minute = 60 - mnum.value;
        at += 1 + mnum.consumed;
        explicit = true;
      }
    }
  } else if (nw === 'en' && word(tokens[at + 1]) === 'punto') {
    at += 2;
    explicit = true;
  } else if (nw === 'am' || nw === 'pm') {
    const time: PartialTime = { hour, meridiem: nw };
    return finishClock(time, at + 1 - i);
  } else if (nw === 'horas' || nw === 'hs') {
    // Colloquial "7 horas del próximo domingo" = 7 o'clock.
    at += 1;
    explicit = true;
  } else if (tokens[i]?.type === 'word' && nw !== undefined) {
    // Word-hour with trailing word-number minutes: "dos treinta",
    // "dos cuarenta y cinco" (minutes must be a word, not a digit).
    if (tokens[at]?.type === 'word' && (TENS[nw] !== undefined || TEENS[nw] !== undefined)) {
      const mnum = readWordNum(tokens, at);
      if (mnum && mnum.value >= 10 && mnum.value <= 59) {
        minute = mnum.value;
        at += mnum.consumed;
        explicit = true;
      }
    }
  }
  if (!explicit && at === i + n.consumed) {
    // Plain number — only usable by callers that provide a licensing lead.
    const time: PartialTime = { hour };
    if (hour <= 12) time.meridiem = 'unknown';
    return { time, consumed: at - i, bare: true };
  }
  const time: PartialTime = { hour };
  if (minute !== undefined) time.minute = minute;
  if (hour <= 12) time.meridiem = 'unknown';
  const fin = finishClock(time, at - i);
  return { ...fin, bare: false };
}

/* ------------------------------------------------------------------ */
/* Time rules                                                         */
/* ------------------------------------------------------------------ */

const TIME_LEADS: string[][] = [
  ['alrededor', 'de', 'las'], ['alrededor', 'de', 'la'],
  ['a', 'eso', 'de', 'las'], ['hacia', 'las'], ['hacia', 'la'],
  ['a', 'las'], ['a', 'la'], ['las'], ['la'],
];

function matchPhraseAt(tokens: Token[], i: number, words: string[]): number | undefined {
  for (const [k, w] of words.entries()) {
    if (word(tokens[i + k]) !== w) return undefined;
  }
  return i + words.length;
}

/**
 * "a las 3 y media", "las siete menos cuarto de la tarde", "a las 8.30 de la
 * noche hoy", "a las 7 del próximo domingo a la tarde", "a las cinco y media
 * mañana por la tarde" — time with optional period suffix and day phrase.
 */
const esTime: Rule = (tokens, i) => {
  let at = i;
  let hasLead = false;
  for (const lead of TIME_LEADS) {
    const end = matchPhraseAt(tokens, i, lead);
    if (end !== undefined) {
      at = end;
      hasLead = true;
      break;
    }
  }
  const read = readTime(tokens, at);
  if (!read) return undefined;
  if (read.bare && !hasLead) return undefined;
  at += read.consumed;
  let time = read.time;

  // Period suffix fixes the meridiem: "de la mañana/tarde/noche/madrugada".
  const ps = readPeriodSuffix(tokens, at);
  if (ps) {
    time = applyPeriod(time, ps.period);
    at += ps.consumed;
    // "a las 8 de la noche menos cuarto"
    if (word(tokens[at]) === 'menos') {
      const fw = word(tokens[at + 1]);
      if (fw === 'cuarto') {
        time = { ...time, hour: (time.hour ?? 1) - 1 || 23, minute: 45 };
        at += 2;
      } else {
        const mnum = readWordNum(tokens, at + 1);
        if (mnum && mnum.value >= 1 && mnum.value <= 59) {
          time = { ...time, hour: (time.hour ?? 1) - 1 || 23, minute: 60 - mnum.value };
          at += 1 + mnum.consumed;
        }
      }
    }
  }

  // Optional day phrase: deictic ("mañana", "hoy") or "del próximo domingo",
  // then optionally a trailing period marker resolving the meridiem.
  let dayExpr: TimeExpr | undefined;
  let dayEnd = at;
  const dw = word(tokens[at]);
  if (dw !== undefined && ES_DEICTIC[dw] !== undefined) {
    dayExpr = snapOffset(ES_DEICTIC[dw]!, 'day');
    dayEnd = at + 1;
  } else if (dw === 'del' || dw === 'de' || dw === 'el') {
    let k = at + 1;
    if (word(tokens[k]) === 'el') k += 1;
    let delta: -1 | 0 | 1 | undefined;
    const mw = word(tokens[k]);
    if (mw === 'próximo' || mw === 'proximo' || mw === 'siguiente') {
      delta = 1;
      k += 1;
    } else if (mw === 'este') {
      delta = 0;
      k += 1;
    } else if (mw === 'pasado' || mw === 'último' || mw === 'ultimo') {
      delta = -1;
      k += 1;
    }
    const wd = WEEKDAYS[word(tokens[k]) ?? ''];
    if (wd !== undefined && delta !== undefined) {
      // "próximo domingo" follows the context nextWeekday policy (no n).
      const dir = delta === -1 ? 'prev' : delta === 1 ? 'next' : 'nearest';
      dayExpr = { op: 'seek', base: NOW, dir, target: { kind: 'weekday', weekday: wd } };
      dayEnd = k + 1;
    }
  }
  if (dayExpr !== undefined) {
    at = dayEnd;
    const ps2 = readPeriodSuffix(tokens, at);
    if (ps2) {
      time = applyPeriod(time, ps2.period);
      at += ps2.consumed;
    }
    return {
      expr: { op: 'intersect', parts: [dayExpr, timeLiteral(time)] },
      consumed: at - i,
      confidence: 1,
      role: 'datetime',
    };
  }

  return { expr: timeLiteral(time), consumed: at - i, confidence: 1, role: 'time' };
};

/* ------------------------------------------------------------------ */
/* Numeric dates and joined forms                                     */
/* ------------------------------------------------------------------ */

/** Quarter/semester regex forms: "2017-t1", "2019 t1", "t1 2019". */
function readQuarterToken(
  tokens: Token[],
  i: number,
): { start: number; months: number; year: number; consumed: number } | undefined {
  const w = word(tokens[i]);
  let m = w?.match(/^([12]\d{3})[-]?t([1-4])$/);
  if (m) return { year: Number(m[1]), start: (Number(m[2]) - 1) * 3 + 1, months: 3, consumed: 1 };
  m = w?.match(/^t([1-4])(?:-([12]\d{3}))?$/);
  if (m) {
    if (m[2] !== undefined) {
      return { year: Number(m[2]), start: (Number(m[1]) - 1) * 3 + 1, months: 3, consumed: 1 };
    }
    let at = i + 1;
    if (word(tokens[at]) === 'de' || word(tokens[at]) === 'del' || word(tokens[at]) === '-') at += 1;
    const y = yearAt(tokens, at);
    if (y !== undefined) return { year: y, start: (Number(m[1]) - 1) * 3 + 1, months: 3, consumed: at + 1 - i };
    return undefined;
  }
  const y0 = yearAt(tokens, i);
  if (y0 !== undefined) {
    let at = i + 1;
    if (word(tokens[at]) === '-') at += 1;
    const qm = word(tokens[at])?.match(/^t([1-4])$/);
    if (qm) return { year: y0, start: (Number(qm[1]) - 1) * 3 + 1, months: 3, consumed: at + 1 - i };
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

const esQuarter: Rule = (tokens, i) => {
  const q = readQuarterToken(tokens, i);
  if (!q) return undefined;
  return { expr: quarterExpr(q), consumed: q.consumed, confidence: 0.95, role: 'date' };
};

/**
 * Ordinal quarters/semesters/months of a year scope: "primer trimestre de
 * 2017", "segundo semestre", "el tercer mes de 2021", "1º trimestre-2019",
 * "el noveno mes del próximo año", "el primer trimestre del año".
 */
function readOrdinalQuarter(
  tokens: Token[],
  i: number,
): { expr: TimeExpr; consumed: number; year?: number; startMonth?: number } | undefined {
  let at = i;
  if (['el', 'la', 'del'].includes(word(tokens[at]) ?? '')) at += 1;
  let nth: number | undefined;
  const w0 = word(tokens[at]);
  if (w0 !== undefined && ORDINAL_WORDS[w0] !== undefined) nth = ORDINAL_WORDS[w0]!;
  else if (ordinalWord(w0) !== undefined) nth = ordinalWord(w0)!;
  else if (tokens[at]?.type === 'number' && (tokens[at] as { value: number }).value <= 9) {
    nth = (tokens[at] as { value: number }).value;
  }
  if (nth === undefined) return undefined;
  at += 1;
  const uw = word(tokens[at]);
  let months: number;
  let unit: 'quarter' | 'semester' | 'month';
  if (uw === 'trimestre') {
    months = 3;
    unit = 'quarter';
  } else if (uw === 'semestre') {
    months = 6;
    unit = 'semester';
  } else if (uw === 'mes') {
    months = 1;
    unit = 'month';
  } else {
    return undefined;
  }
  const maxN = unit === 'quarter' ? 4 : unit === 'semester' ? 2 : 12;
  if (nth < 1 || nth > maxN) return undefined;
  at += 1;
  const startMonth = (nth - 1) * months + 1;
  // Scope: "de 2017", "-2019", "del año", "del próximo año", or none (current year).
  let scopeYear: number | undefined;
  let scopeExpr: TimeExpr | undefined;
  let scopeModified = false;
  let cursor = at;
  const sw = word(tokens[cursor]);
  if (sw === 'de' || sw === 'del' || sw === '-') {
    let k = cursor + 1;
    if (word(tokens[k]) === 'el') k += 1;
    const y = yearAt(tokens, k);
    if (y !== undefined) {
      scopeYear = y;
      cursor = k + 1;
    } else {
      let delta: -1 | 0 | 1 = 0;
      const mw = word(tokens[k]);
      if (mw === 'próximo' || mw === 'proximo' || mw === 'siguiente') {
        delta = 1;
        k += 1;
      } else if (mw === 'este') {
        k += 1;
        scopeModified = true;
      } else if (mw === 'pasado' || mw === 'último' || mw === 'ultimo') {
        delta = -1;
        k += 1;
      }
      if (word(tokens[k]) === 'año' || word(tokens[k]) === 'ano') {
        scopeExpr = delta === 0 ? snapNow('year') : snapOffset(delta, 'year');
        if (delta !== 0) scopeModified = true;
        cursor = k + 1;
      }
    }
  } else {
    const y = yearAt(tokens, cursor);
    if (y !== undefined) {
      scopeYear = y;
      cursor += 1;
    }
  }
  if (scopeYear !== undefined) {
    if (unit === 'month') {
      return {
        expr: { op: 'literal', date: { year: scopeYear, month: startMonth } },
        consumed: cursor - i,
        year: scopeYear,
        startMonth,
      };
    }
    return {
      expr: {
        op: 'span',
        anchor: { op: 'literal', date: { year: scopeYear, month: startMonth } },
        amount: { months },
      },
      consumed: cursor - i,
      year: scopeYear,
      startMonth,
    };
  }
  if (!scopeModified) {
    // Unanchored year ("2º semestre", "primer trimestre del año") → the month
    // literal supplies dual current/adjacent-year candidates.
    if (unit === 'month') {
      return { expr: { op: 'literal', date: { month: startMonth } }, consumed: cursor - i, startMonth };
    }
    return {
      expr: { op: 'span', anchor: { op: 'literal', date: { month: startMonth } }, amount: { months } },
      consumed: cursor - i,
      startMonth,
    };
  }
  const base = scopeExpr ?? snapNow('year');
  if (unit === 'month') {
    return {
      expr: { op: 'intersect', parts: [base, { op: 'literal', date: { month: startMonth } }] },
      consumed: cursor - i,
      startMonth,
    };
  }
  const startPoint: TimeExpr =
    startMonth === 1
      ? { op: 'snap', base, unit: 'year', edge: 'start' }
      : { op: 'offset', base: { op: 'snap', base, unit: 'year', edge: 'start' }, amount: startMonth - 1, unit: 'month' };
  return { expr: { op: 'span', anchor: startPoint, amount: { months } }, consumed: cursor - i, startMonth };
}

const esOrdinalQuarter: Rule = (tokens, i) => {
  const q = readOrdinalQuarter(tokens, i);
  if (!q) return undefined;
  return { expr: q.expr, consumed: q.consumed, confidence: 1, role: 'date' };
};

/** Joined numeric forms in a single word token. */
const esNumdate: Rule = (tokens, i) => {
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
  // "12-2015" / "2015-3" → month-year.
  m = w.match(/^(\d{1,2})-([12]\d{3})$/);
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 12) {
    return {
      expr: { op: 'literal', date: { year: Number(m[2]), month: Number(m[1]) } },
      consumed: 1,
      confidence: 0.95,
      role: 'date',
    };
  }
  m = w.match(/^([12]\d{3})-(\d{1,2})$/);
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) {
    return {
      expr: { op: 'literal', date: { year: Number(m[1]), month: Number(m[2]) } },
      consumed: 1,
      confidence: 0.95,
      role: 'date',
    };
  }
  // "10/1-11/2/2017" / "28/2-1/3" → joined numeric-date range (D/M order).
  m = w.match(/^(\d{1,2})\/(\d{1,2})-(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (m) {
    const year = m[5] !== undefined ? century(Number(m[5])) : yearAt(tokens, i + 1);
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
        expr: { op: 'between', start: { op: 'literal', date: d1 }, end: { op: 'literal', date: d2 } },
        consumed: 1 + extra,
        confidence: 0.95,
        role: 'date',
      };
    }
  }
  // "1-10-2018-7-10-2018" → joined D-M-Y date range.
  m = w.match(/^(\d{1,2})-(\d{1,2})-(\d{4})-(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (m) {
    const mk = (d: number, mo: number, y: number): PartialDate | undefined =>
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
  // "diciembre/2018" (month/year), "01/agosto/2019", "2020/sep/23", "23/sep/2020".
  if (w.includes('/') && !/^[\d/]+$/.test(w)) {
    const segments = w.split('/');
    if (segments.length >= 2 && segments.length <= 3) {
      let month: number | undefined;
      let day: number | undefined;
      let year: number | undefined;
      let ok = true;
      for (const seg of segments) {
        const mo = MONTHS[seg];
        if (mo !== undefined && month === undefined) month = mo;
        else if (/^\d{4}$/.test(seg) && year === undefined) year = Number(seg);
        else if (/^\d{1,2}$/.test(seg) && day === undefined && Number(seg) >= 1 && Number(seg) <= 31) day = Number(seg);
        else {
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
  // "sales_report-2002-10-09.xlsx" — embedded ISO date.
  m = w.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m && /[a-z]/.test(w)) {
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      return {
        expr: { op: 'literal', date: { year: Number(m[1]), month: mo, day: d } },
        consumed: 1,
        confidence: 0.85,
        role: 'date',
      };
    }
  }
  // "0930-0730" → military time pair (both readings am/pm).
  m = w.match(/^(\d{3,4})-(\d{3,4})$/);
  if (m && Number(m[1]) >= 100 && Number(m[2]) >= 100) {
    const mk = (v: number): PartialTime | undefined => {
      const hour = Math.floor(v / 100);
      const minute = v % 100;
      if (hour > 23 || minute > 59) return undefined;
      const time: PartialTime = { hour, minute };
      if (hour <= 12) time.meridiem = 'unknown';
      return time;
    };
    const t1 = mk(Number(m[1]));
    const t2 = mk(Number(m[2]));
    if (t1 && t2) {
      return {
        expr: { op: 'between', start: timeLiteral(t1), end: timeLiteral(t2) },
        consumed: 1,
        confidence: 0.9,
        role: 'time',
      };
    }
  }
  // "07:30-09:30" → clock pair in one token.
  m = w.match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/);
  if (m) {
    const mk = (h: number, mi: number): PartialTime | undefined => {
      if (h > 23 || mi > 59) return undefined;
      const time: PartialTime = { hour: h, minute: mi };
      if (h <= 12) time.meridiem = 'unknown';
      return time;
    };
    const t1 = mk(Number(m[1]), Number(m[2]));
    const t2 = mk(Number(m[3]), Number(m[4]));
    if (t1 && t2) {
      return {
        expr: { op: 'between', start: timeLiteral(t1), end: timeLiteral(t2) },
        consumed: 1,
        confidence: 0.9,
        role: 'time',
      };
    }
  }
  // "9.30-4.30pm" → dot-time pair.
  m = w.match(/^(\d{1,2})\.(\d{2})-(\d{1,2})\.(\d{2})(am|pm)?$/);
  if (m) {
    const t1: PartialTime = { hour: Number(m[1]), minute: Number(m[2]) };
    const t2: PartialTime = { hour: Number(m[3]), minute: Number(m[4]) };
    if (t1.hour! <= 23 && t2.hour! <= 23 && t1.minute! <= 59 && t2.minute! <= 59) {
      if (m[5] !== undefined) {
        t2.meridiem = m[5] as 'am' | 'pm';
        if (t1.hour! <= 12) t1.meridiem = 'unknown';
      } else {
        if (t1.hour! <= 12) t1.meridiem = 'unknown';
        if (t2.hour! <= 12) t2.meridiem = 'unknown';
      }
      return {
        expr: { op: 'between', start: timeLiteral(t1), end: timeLiteral(t2) },
        consumed: 1,
        confidence: 0.9,
        role: 'time',
      };
    }
  }
  // "3-8" ascending → hour pair; "12-5" descending → D-M date.
  m = w.match(/^(\d{1,2})-(\d{1,2})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a < b && a >= 1 && b <= 23) {
      const mk = (h: number): PartialTime => (h <= 12 ? { hour: h, meridiem: 'unknown' } : { hour: h });
      // A trailing period suffix fixes both meridiems: "6-8 de la mañana".
      const ps = readPeriodSuffix(tokens, i + 1);
      const s = ps ? applyPeriod(mk(a), ps.period) : mk(a);
      const e = ps ? applyPeriod(mk(b), ps.period) : mk(b);
      return {
        expr: { op: 'between', start: timeLiteral(s), end: timeLiteral(e) },
        consumed: 1 + (ps?.consumed ?? 0),
        confidence: 0.85,
        role: 'time',
      };
    }
    if (a > b && a <= 31 && b >= 1 && b <= 12) {
      return {
        expr: { op: 'literal', date: { day: a, month: b } },
        consumed: 1,
        confidence: 0.8,
        role: 'date',
      };
    }
  }
  return undefined;
};

/**
 * Word dates: "15 de marzo de 2026" is factory territory; this covers word
 * ordinals ("1er de octubre"), the "día" infix ("el primer día de enero de
 * 2015"), numeric months ("el 9 de 8 de 1971", "el 17 del 11"), word-number
 * years ("veintiocho de marzo de mil novecientos noventa y dos"), 2-digit
 * years ("4-Jul-95"), and typo separators ("22 do febrero").
 */
const esDayMonth: Rule = (tokens, i) => {
  let at = i;
  const w0 = word(tokens[at]);
  if (w0 === 'el' || w0 === 'este' || w0 === 'del') at += 1;
  const day = readWordNum(tokens, at);
  if (!day || day.value < 1 || day.value > 31) return undefined;
  let cursor = at + day.consumed;
  if (word(tokens[cursor]) === 'día' || word(tokens[cursor]) === 'dia') cursor += 1;
  let sepWord: string | undefined;
  if (['de', 'del', 'do', '-'].includes(word(tokens[cursor]) ?? '')) {
    sepWord = word(tokens[cursor]);
    cursor += 1;
  }
  const mw = word(tokens[cursor]);
  let month = monthOf(mw);
  let monthConsumed = 1;
  if (month === undefined) {
    // Numeric month: "9 de 8 de 1971", "17 del 11" — only with a separator.
    const mt = tokens[cursor];
    if (
      sepWord !== undefined &&
      mt?.type === 'number' && !mt.ordinal && mt.value >= 1 && mt.value <= 12 &&
      (sepWord === 'del' || ['de', 'del'].includes(word(tokens[cursor + 1]) ?? ''))
    ) {
      month = mt.value;
    } else {
      return undefined;
    }
  }
  cursor += monthConsumed;
  // Year: "de 2015", "del 87", "- 95", "de mil novecientos noventa y dos".
  let yAt = cursor;
  let ySep: string | undefined;
  if (['de', 'del', '-'].includes(word(tokens[yAt]) ?? '')) {
    ySep = word(tokens[yAt]);
    yAt += 1;
  }
  let year: number | undefined;
  let yEnd = yAt;
  const y4 = yearAt(tokens, yAt);
  if (y4 !== undefined) {
    year = y4;
    yEnd = yAt + 1;
  } else {
    const yn = readWordNum(tokens, yAt);
    if (yn && yn.value >= 1000 && yn.value <= 2999) {
      year = yn.value;
      yEnd = yAt + yn.consumed;
    } else if (ySep !== undefined && tokens[yAt]?.type === 'number') {
      const v = (tokens[yAt] as { value: number }).value;
      if (v >= 32 && v <= 99) {
        year = century(v);
        yEnd = yAt + 1;
      }
    }
  }
  const date: PartialDate = { month, day: day.value };
  if (year !== undefined) {
    date.year = year;
    cursor = yEnd;
  }
  // Validate rough day/month fit (Feb 30 must not parse).
  const maxDay = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!;
  if (day.value > maxDay) return undefined;
  // Redundant parenthesized weekday: "el 22 de mayo (martes)".
  if (WEEKDAYS[word(tokens[cursor]) ?? ''] !== undefined) cursor += 1;
  return { expr: { op: 'literal', date }, consumed: cursor - i, confidence: 1, role: 'date' };
};

/** Month-first: "sep-23-2020", "septiembre-2020-23", "noviembre 19-20", "abril del 87". */
const esMonthFirst: Rule = (tokens, i) => {
  const w = word(tokens[i]);
  const month = MONTHS[w ?? ''];
  if (month === undefined) return undefined;
  let at = i + 1;
  if (word(tokens[at]) === '-') at += 1;
  // "noviembre 19-20" → day range within the month.
  const pair = word(tokens[at])?.match(/^(\d{1,2})-(\d{1,2})$/);
  if (pair && Number(pair[1]) >= 1 && Number(pair[1]) <= 31 && Number(pair[2]) >= 1 && Number(pair[2]) <= 31) {
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
  // "abril del 87" → April 1987.
  if (word(tokens[i + 1]) === 'del' || word(tokens[i + 1]) === 'de') {
    const t = tokens[i + 2];
    if (t?.type === 'number' && !t.ordinal && t.value >= 32 && t.value <= 99) {
      return {
        expr: { op: 'literal', date: { month, year: century(t.value) } },
        consumed: 3,
        confidence: 0.9,
        role: 'date',
      };
    }
  }
  const t0 = tokens[at];
  if (t0?.type !== 'number' || t0.ordinal) return undefined;
  // "septiembre-2020-23" → month · year · day; "sep 2020" → month-year.
  if (t0.value >= 1000 && t0.value <= 2999) {
    const year = t0.value;
    let dAt = at + 1;
    if (word(tokens[dAt]) === '-') dAt += 1;
    const dTok = tokens[dAt];
    if (dTok?.type === 'number' && !dTok.ordinal && dTok.value >= 1 && dTok.value <= 31) {
      return {
        expr: { op: 'literal', date: { year, month, day: dTok.value } },
        consumed: dAt + 1 - i,
        confidence: 0.9,
        role: 'date',
      };
    }
    return { expr: { op: 'literal', date: { year, month } }, consumed: at + 1 - i, confidence: 0.9, role: 'date' };
  }
  // "sep-23-2020" → month · day [· year].
  if (t0.value >= 1 && t0.value <= 31) {
    let cursor = at + 1;
    let yAt = cursor;
    if (word(tokens[yAt]) === '-' || word(tokens[yAt]) === 'de') yAt += 1;
    const year = yearAt(tokens, yAt);
    const date: PartialDate = { month, day: t0.value };
    if (year !== undefined) {
      date.year = year;
      cursor = yAt + 1;
    }
    return { expr: { op: 'literal', date }, consumed: cursor - i, confidence: 0.9, role: 'date' };
  }
  return undefined;
};

/** "23-2020-septiembre" → day · year · month (dash-split tokens). */
const esSpacedDate: Rule = (tokens, i) => {
  const t1 = tokens[i];
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
  return undefined;
};

/** "el 15", "el día 18", "para el día 21 de este mes" — bare day-of-month. */
const esBareDay: Rule = (tokens, i) => {
  let at = i;
  if (word(tokens[at]) === 'para') at += 1;
  const art = word(tokens[at]);
  if (art !== 'el' && art !== 'del' && art !== 'este') return undefined;
  at += 1;
  if (word(tokens[at]) === 'día' || word(tokens[at]) === 'dia') at += 1;
  const t = tokens[at];
  let day: number | undefined;
  let dayConsumed = 1;
  if (t?.type === 'number' && !t.ordinal && t.value >= 1 && t.value <= 31) day = t.value;
  else {
    day = ordinalWord(word(t));
    if (day === undefined) {
      const wn = readWordNum(tokens, at);
      if (wn && wn.value >= 1 && wn.value <= 31 && tokens[at]?.type === 'word') {
        day = wn.value;
        dayConsumed = wn.consumed;
      }
    }
  }
  if (day === undefined || day < 1 || day > 31) return undefined;
  let cursor = at + dayConsumed;
  // Month, weekday, or unit follows → other rules own it ("el primer lunes",
  // "el tercer mes de 2021").
  const next = word(tokens[cursor]);
  if (next !== undefined && (MONTHS[next] !== undefined || next === 'do')) return undefined;
  if (next !== undefined && (WEEKDAYS[next] !== undefined || ES_UNITS[next] !== undefined)) {
    return undefined;
  }
  if (next === 'de' || next === 'del') {
    // "el día 21 de este mes" / "el 15 del próximo mes".
    let k = cursor + 1;
    if (word(tokens[k]) === 'el') k += 1;
    let delta: -1 | 0 | 1 | undefined;
    const mw = word(tokens[k]);
    if (mw === 'este') {
      delta = 0;
      k += 1;
    } else if (mw === 'próximo' || mw === 'proximo' || mw === 'siguiente') {
      delta = 1;
      k += 1;
    } else if (mw === 'pasado' || mw === 'último' || mw === 'ultimo') {
      delta = -1;
      k += 1;
    }
    if (word(tokens[k]) === 'mes' && delta !== undefined) {
      const monthExpr = delta === 0 ? snapNow('month') : snapOffset(delta, 'month');
      return {
        expr: { op: 'intersect', parts: [monthExpr, { op: 'literal', date: { day } }] },
        consumed: k + 1 - i,
        confidence: 1,
        role: 'date',
      };
    }
    if (MONTHS[word(tokens[k]) ?? ''] !== undefined) return undefined;
    return undefined;
  }
  return { expr: { op: 'literal', date: { day } }, consumed: cursor - i, confidence: 0.8, role: 'date' };
};

/** "lunes 21", "el martes 25", "el lunes el veintisiete", "el miércoles el día treinta y uno". */
const esWeekdayDay: Rule = (tokens, i) => {
  let at = i;
  if (word(tokens[at]) === 'el' || word(tokens[at]) === 'este') at += 1;
  const wd = WEEKDAYS[word(tokens[at]) ?? ''];
  if (!wd) return undefined;
  at += 1;
  if (word(tokens[at]) === 'el') at += 1;
  if (word(tokens[at]) === 'día' || word(tokens[at]) === 'dia') at += 1;
  const t = tokens[at];
  let day: number | undefined;
  let consumed = 1;
  if (t?.type === 'number' && !t.ordinal && t.value >= 1 && t.value <= 31) day = t.value;
  else {
    const wn = readWordNum(tokens, at);
    if (wn && wn.value >= 1 && wn.value <= 31 && t?.type === 'word') {
      day = wn.value;
      consumed = wn.consumed;
    }
  }
  if (day === undefined) return undefined;
  // Month or numdate follows → full-date rules own it ("el martes 9 de mayo").
  const next = word(tokens[at + consumed]);
  if (next !== undefined && MONTHS[next] !== undefined) return undefined;
  if ((next === 'de' || next === 'del') && monthOf(word(tokens[at + consumed + 1])) !== undefined) {
    return undefined;
  }
  if (tokens[at + consumed]?.type === 'numdate') return undefined;
  if (tokens[at]?.type === 'numdate') return undefined;
  return {
    expr: { op: 'literal', date: { day } },
    consumed: at + consumed - i,
    confidence: 0.9,
    role: 'date',
  };
};

/* ------------------------------------------------------------------ */
/* Durations and spans                                                */
/* ------------------------------------------------------------------ */

const DUR_UNITS: Record<string, keyof CalendarAmount> = {
  segundo: 'seconds', segundos: 'seconds', seg: 'seconds', segs: 'seconds', s: 'seconds',
  minuto: 'minutes', minutos: 'minutes', min: 'minutes', mins: 'minutes',
  hora: 'hours', horas: 'hours', h: 'hours', hs: 'hours', hr: 'hours', hrs: 'hours',
  día: 'days', días: 'days', dia: 'days', dias: 'days',
  noche: 'days', noches: 'days',
  semana: 'weeks', semanas: 'weeks',
  mes: 'months', meses: 'months',
  año: 'years', años: 'years', ano: 'years', anos: 'years',
};

/** One duration component: "3 horas", "media hora", "una y media hora", "3,5 años", "½ hora". */
function readDurComponent(
  tokens: Token[],
  i: number,
): { amount: Record<string, number>; consumed: number } | undefined {
  let at = i;
  const w0 = word(tokens[at]);
  // "media hora" / "½ hora"
  if ((w0 === 'media' || w0 === '½') && (word(tokens[at + 1]) === 'hora' || word(tokens[at + 1]) === 'horas')) {
    return { amount: { minutes: 30 }, consumed: 2 };
  }
  // "todo el día" / "toda la semana" → one whole unit.
  if (w0 === 'todo' || w0 === 'toda') {
    let k = at + 1;
    if (word(tokens[k]) === 'el' || word(tokens[k]) === 'la') k += 1;
    const unit = DUR_UNITS[word(tokens[k]) ?? ''];
    if (unit) return { amount: { [unit]: 1 }, consumed: k + 1 - i };
    return undefined;
  }
  // "otro día" / "otra hora"
  if (w0 === 'otro' || w0 === 'otra') {
    const unit = DUR_UNITS[word(tokens[at + 1]) ?? ''];
    if (unit) return { amount: { [unit]: 1 }, consumed: 2 };
    return undefined;
  }
  // Decimal in one token: "123.45 segundos", "3.5 años".
  const dm = w0?.match(/^(\d+)\.(\d+)$/);
  if (dm) {
    const unit = DUR_UNITS[word(tokens[at + 1]) ?? ''];
    if (unit) {
      const value = Number(`${dm[1]}.${dm[2]}`);
      return { amount: { [unit]: value }, consumed: 2 };
    }
  }
  const n = readWordNum(tokens, at);
  if (!n) return undefined;
  at += n.consumed;
  let value = n.value;
  // "3,5 años" — the comma vanished, leaving two adjacent number tokens.
  const t1 = tokens[at - 1];
  const t2 = tokens[at];
  if (
    t1?.type === 'number' && t2?.type === 'number' && !t2.ordinal &&
    t2.start === t1.end + 1 && DUR_UNITS[word(tokens[at + 1]) ?? ''] !== undefined
  ) {
    value = n.value + t2.value / 10 ** (t2.end - t2.start);
    at += 1;
  }
  // "uno y cuarto año" / "una y media hora" — fraction before the unit word.
  if (word(tokens[at]) === 'y') {
    const fw = word(tokens[at + 1]);
    if ((fw === 'media' || fw === 'medio') && DUR_UNITS[word(tokens[at + 2]) ?? ''] !== undefined) {
      const unit = DUR_UNITS[word(tokens[at + 2]) ?? '']!;
      return { amount: { [unit]: value + 0.5 }, consumed: at + 3 - i };
    }
    if (fw === 'cuarto' && DUR_UNITS[word(tokens[at + 2]) ?? ''] !== undefined) {
      const unit = DUR_UNITS[word(tokens[at + 2]) ?? '']!;
      return { amount: { [unit]: value + 0.25 }, consumed: at + 3 - i };
    }
  }
  // "tres fines de semana" → 3 × 2 days.
  if ((word(tokens[at]) === 'fines' || word(tokens[at]) === 'fin') && word(tokens[at + 1]) === 'de' && word(tokens[at + 2]) === 'semana') {
    return { amount: { days: 2 * value }, consumed: at + 3 - i };
  }
  const unit = DUR_UNITS[word(tokens[at]) ?? ''];
  if (!unit) return undefined;
  let end = at + 1;
  // "un mes entero"
  if (['entero', 'entera', 'enteros', 'enteras', 'completo', 'completa'].includes(word(tokens[end]) ?? '')) end += 1;
  return { amount: { [unit]: value }, consumed: end - i };
}

function finishDuration(
  tokens: Token[],
  i: number,
  at: number,
  comp: { amount: Record<string, number>; consumed: number },
): RuleMatch {
  let cursor = at + comp.consumed;
  const amount = { ...comp.amount };
  // "y media" / "y medio" / "y cuarto" / a second component ("y tres meses",
  // "y 30 minutos", "y 2 semanas y 2 días").
  let guard = 0;
  while (guard < 3) {
    guard += 1;
    let extraAt = cursor;
    let sawY = false;
    if (word(tokens[extraAt]) === 'y') {
      extraAt += 1;
      sawY = true;
    }
    const fw = word(tokens[extraAt]);
    if (sawY && (fw === 'media' || fw === 'medio')) {
      if (amount['years'] !== undefined) amount['years'] += 0.5;
      else if (amount['hours'] !== undefined) amount['minutes'] = (amount['minutes'] ?? 0) + 30;
      else amount['minutes'] = (amount['minutes'] ?? 0) + 30;
      cursor = extraAt + 1;
      continue;
    }
    if (sawY && fw === 'cuarto') {
      if (amount['years'] !== undefined) amount['years'] += 0.25;
      else amount['minutes'] = (amount['minutes'] ?? 0) + 15;
      cursor = extraAt + 1;
      continue;
    }
    if (sawY) {
      const second = readDurComponent(tokens, extraAt);
      if (second) {
        for (const [k, v] of Object.entries(second.amount)) {
          // Recognizers folds months into fractional years when combined:
          // "un año y tres meses" = 1.25 years.
          if (k === 'months' && amount['years'] !== undefined) {
            amount['years'] += v / 12;
          } else {
            amount[k] = (amount[k] ?? 0) + v;
          }
        }
        cursor = extraAt + second.consumed;
        continue;
      }
    }
    break;
  }
  return { expr: { op: 'amount', amount }, consumed: cursor - i, confidence: 1, role: 'duration' };
}

const DUR_MARKERS: string[][] = [
  ['por'], ['durante'], ['para'], ['dura'], ['durará'], ['durara'], ['duró'],
  ['duro'], ['durar'], ['tomará'], ['tomara'], ['toma'], ['más', 'de'],
  ['mas', 'de'], ['de'], ['que'],
];

/** "por tres horas", "durará dos horas", "de ½ hora", "más de 1 hora y media". */
const esDuration: Rule = (tokens, i) => {
  let at: number | undefined;
  for (const marker of DUR_MARKERS) {
    const end = matchPhraseAt(tokens, i, marker);
    if (end !== undefined) {
      at = end;
      break;
    }
  }
  if (at === undefined) {
    // Marker-less "30 minutos o más".
    const comp = readDurComponent(tokens, i);
    if (comp && word(tokens[i + comp.consumed]) === 'o' &&
        (word(tokens[i + comp.consumed + 1]) === 'más' || word(tokens[i + comp.consumed + 1]) === 'mas')) {
      const fin = finishDuration(tokens, i, i, comp);
      return { ...fin, consumed: comp.consumed + 2 };
    }
    return undefined;
  }
  const w = word(tokens[at]);
  // "por el día" / "por el mes" → the current unit interval, not a duration.
  if ((w === 'el' || w === 'la') && word(tokens[i]) === 'por') {
    const unitWord = word(tokens[at + 1]);
    const unit =
      unitWord === 'día' || unitWord === 'dia'
        ? 'day'
        : unitWord === 'semana'
          ? 'week'
          : unitWord === 'mes'
            ? 'month'
            : unitWord === 'año' || unitWord === 'ano'
              ? 'year'
              : undefined;
    if (unit) {
      const next = word(tokens[at + 2]);
      if (next === undefined || (WEEKDAYS[next] === undefined && MONTHS[next] === undefined &&
          !['pasado', 'pasada', 'próximo', 'próxima', 'proximo', 'proxima', 'siguiente', 'anterior', 'que'].includes(next))) {
        return { expr: snapNow(unit), consumed: at + 2 - i, confidence: 0.9, role: 'date' };
      }
    }
    return undefined;
  }
  if (w === 'un' || w === 'una') {
    const comp = readDurComponent(tokens, at + 1);
    if (comp) {
      const merged = finishDuration(tokens, i, at + 1, comp);
      return merged;
    }
    const unit = DUR_UNITS[word(tokens[at + 1]) ?? ''];
    if (unit) return finishDuration(tokens, i, at + 1, { amount: { [unit]: 1 }, consumed: 1 });
    // "una y media hora" via component reader with the leading "una".
    const comp2 = readDurComponent(tokens, at);
    if (comp2) return finishDuration(tokens, i, at, comp2);
    return undefined;
  }
  const comp = readDurComponent(tokens, at);
  if (!comp) return undefined;
  return finishDuration(tokens, i, at, comp);
};

/** "toda la semana" / "todo el día" standalone → whole-unit duration. */
const esAllUnit: Rule = (tokens, i) => {
  const w0 = word(tokens[i]);
  if (w0 !== 'todo' && w0 !== 'toda') return undefined;
  let at = i + 1;
  if (word(tokens[at]) === 'el' || word(tokens[at]) === 'la') at += 1;
  const unit = DUR_UNITS[word(tokens[at]) ?? ''];
  if (!unit) return undefined;
  return { expr: { op: 'amount', amount: { [unit]: 1 } }, consumed: at + 1 - i, confidence: 1, role: 'duration' };
};

const BUSINESS_QUALIFIERS: string[][] = [
  ['hábiles'], ['habiles'], ['laborables'], ['laborales'], ['de', 'trabajo'],
];

/**
 * "[en] los 2 días siguientes", "las 10 semanas anteriores", "los 4 días
 * hábiles siguientes", "los últimos 3 meses y 2 semanas y 2 días".
 */
const esNUnitSpan: Rule = (tokens, i) => {
  let at = i;
  if (word(tokens[at]) === 'en' || word(tokens[at]) === 'durante') at += 1;
  if (['los', 'las', 'el', 'la'].includes(word(tokens[at]) ?? '')) at += 1;
  let sign: 1 | -1 | undefined;
  const adj0 = word(tokens[at]) ?? '';
  if (ES_LAST_ADJS.includes(adj0)) {
    sign = -1;
    at += 1;
  } else if (ES_NEXT_ADJS.includes(adj0)) {
    sign = 1;
    at += 1;
  }
  const n = readWordNum(tokens, at);
  if (!n) return undefined;
  at += n.consumed;
  const unit = ES_UNITS[word(tokens[at]) ?? ''];
  if (!unit) return undefined;
  at += 1;
  let business = false;
  for (const q of BUSINESS_QUALIFIERS) {
    const end = matchPhraseAt(tokens, at, q);
    if (end !== undefined) {
      business = true;
      at = end;
      break;
    }
  }
  if (sign === undefined) {
    const post = word(tokens[at]) ?? '';
    if (ES_LAST_ADJS.includes(post)) {
      sign = -1;
      at += 1;
    } else if (ES_NEXT_ADJS.includes(post)) {
      sign = 1;
      at += 1;
    }
  }
  if (sign === undefined) return undefined;
  const amount: CalendarAmount =
    unit === 'quarter' ? { months: 3 * sign * n.value } : { [`${unit}s`]: sign * n.value };
  // Compound tail: "y 2 semanas y 2 días".
  let cursor = at;
  let guard = 0;
  while (word(tokens[cursor]) === 'y' && guard < 3) {
    guard += 1;
    const n2 = readWordNum(tokens, cursor + 1);
    if (!n2) break;
    const u2 = ES_UNITS[word(tokens[cursor + 1 + n2.consumed]) ?? ''];
    if (!u2) break;
    const key = u2 === 'quarter' ? 'months' : (`${u2}s` as keyof CalendarAmount);
    const add = u2 === 'quarter' ? 3 * sign * n2.value : sign * n2.value;
    (amount as Record<string, number>)[key] = ((amount as Record<string, number>)[key] ?? 0) + add;
    cursor += 2 + n2.consumed;
  }
  const expr: TimeExpr = { op: 'span', anchor: NOW, amount };
  if (business) expr.business = true;
  return { expr, consumed: cursor - i, confidence: 1, role: 'date' };
};

/**
 * "las primeras 2 semanas de 2021", "las últimas 3 semanas de este año",
 * "los últimos cuatro meses de 2021", "los primeros diez días del último año".
 */
const esFirstLastNOfScope: Rule = (tokens, i) => {
  let at = i;
  if (['los', 'las'].includes(word(tokens[at]) ?? '')) at += 1;
  const adj = word(tokens[at]) ?? '';
  let first: boolean;
  if (['primeras', 'primeros'].includes(adj)) first = true;
  else if (['últimas', 'ultimos', 'últimos', 'ultimas'].includes(adj)) first = false;
  else return undefined;
  at += 1;
  const n = readWordNum(tokens, at);
  if (!n) return undefined;
  at += n.consumed;
  const unit = ES_UNITS[word(tokens[at]) ?? ''];
  if (!unit || unit === 'hour' || unit === 'minute' || unit === 'second') return undefined;
  at += 1;
  const sw = word(tokens[at]);
  if (sw !== 'de' && sw !== 'del') return undefined;
  at += 1;
  if (word(tokens[at]) === 'el') at += 1;
  // Scope: numeric year or (este|último|próximo) año.
  let scope: TimeExpr | undefined;
  let scopeYear: number | undefined;
  const y = yearAt(tokens, at);
  if (y !== undefined) {
    scopeYear = y;
    scope = { op: 'literal', date: { year: y } };
    at += 1;
  } else {
    let delta: -1 | 0 | 1 = 0;
    const mw = word(tokens[at]);
    if (mw === 'este') at += 1;
    else if (mw === 'último' || mw === 'ultimo' || mw === 'pasado') {
      delta = -1;
      at += 1;
    } else if (mw === 'próximo' || mw === 'proximo') {
      delta = 1;
      at += 1;
    }
    if (word(tokens[at]) !== 'año' && word(tokens[at]) !== 'ano') return undefined;
    scope = delta === 0 ? snapNow('year') : snapOffset(delta, 'year');
    at += 1;
  }
  const key = unit === 'quarter' ? 'months' : (`${unit}s` as keyof CalendarAmount);
  const value = unit === 'quarter' ? 3 * n.value : n.value;
  let expr: TimeExpr;
  if (unit === 'week') {
    // Week-aligned: first weeks anchor at the ISO first week (week of Jan 4);
    // last weeks end at the end of the week containing Dec 28.
    const jan4: TimeExpr =
      scopeYear !== undefined
        ? { op: 'literal', date: { year: scopeYear, month: 1, day: 4 } }
        : { op: 'intersect', parts: [scope, { op: 'literal', date: { month: 1, day: 4 } }] };
    const dec28: TimeExpr =
      scopeYear !== undefined
        ? { op: 'literal', date: { year: scopeYear, month: 12, day: 28 } }
        : { op: 'intersect', parts: [scope, { op: 'literal', date: { month: 12, day: 28 } }] };
    expr = first
      ? { op: 'span', anchor: { op: 'snap', base: jan4, unit: 'week' }, amount: { [key]: value } }
      : { op: 'span', anchor: { op: 'snap', base: dec28, unit: 'week' }, amount: { [key]: -value } };
  } else {
    expr = first
      ? { op: 'span', anchor: scope, amount: { [key]: value } }
      : { op: 'span', anchor: scope, amount: { [key]: -value } };
  }
  return { expr, consumed: at - i, confidence: 1, role: 'date' };
};

/** "dentro de 5 minutos" / "dentro de dos años" → the rolling span from now. */
const esDentroDe: Rule = (tokens, i) => {
  if (word(tokens[i]) !== 'dentro' || word(tokens[i + 1]) !== 'de') return undefined;
  const n = readWordNum(tokens, i + 2);
  if (!n) return undefined;
  const unit = ES_UNITS[word(tokens[i + 2 + n.consumed]) ?? ''];
  if (!unit) return undefined;
  const subDay = unit === 'second' || unit === 'minute' || unit === 'hour';
  // A day-grain anchor (today) sidesteps the partial-period exclusion that a
  // bare `now` anchor triggers: "dentro de dos años" starts today.
  const anchor: TimeExpr = subDay ? NOW : snapNow('day');
  const amount: CalendarAmount =
    unit === 'quarter' ? { months: 3 * n.value } : { [`${unit}s`]: n.value };
  return {
    expr: { op: 'span', anchor, amount },
    consumed: n.consumed + 3,
    confidence: 1,
    role: 'datetime',
  };
};

/* ------------------------------------------------------------------ */
/* N units before/after a date                                        */
/* ------------------------------------------------------------------ */

/**
 * "dos días después de hoy", "3 días a partir de hoy", "2 días a partir de
 * ahora", "dos semanas desde el año 2011", "dentro de tres semanas a partir
 * de mañana", "menos de 3 días posteriores de mañana", "30 minutos después".
 */
const esNAfterDate: Rule = (tokens, i, ctx) => {
  let at = i;
  let asSpan = false;
  if (word(tokens[at]) === 'menos' && word(tokens[at + 1]) === 'de') {
    asSpan = true;
    at += 2;
  } else if (word(tokens[at]) === 'dentro' && word(tokens[at + 1]) === 'de') {
    at += 2;
  } else if (word(tokens[at]) === 'en') {
    at += 1;
  }
  const n = readWordNum(tokens, at);
  if (!n) return undefined;
  at += n.consumed;
  const unit = ES_UNITS[word(tokens[at]) ?? ''];
  if (!unit) return undefined;
  at += 1;
  let sign: 1 | -1 | undefined;
  const cw = word(tokens[at]);
  if (cw === 'después' || cw === 'despues' || cw === 'posteriores' || cw === 'desde') {
    sign = 1;
    at += 1;
  } else if (cw === 'antes') {
    sign = -1;
    at += 1;
  } else if (cw === 'a' && word(tokens[at + 1]) === 'partir') {
    sign = 1;
    at += 2;
  } else {
    return undefined;
  }
  const subDay = unit === 'hour' || unit === 'minute' || unit === 'second';
  const baseStart = at;
  if (word(tokens[at]) === 'de' || word(tokens[at]) === 'del') at += 1;
  if (word(tokens[at]) === 'el') at += 1;
  // "desde el año 2011"
  if ((word(tokens[at]) === 'año' || word(tokens[at]) === 'ano') && yearAt(tokens, at + 1) !== undefined) at += 1;
  let base: TimeExpr | undefined;
  let consumed = 0;
  const bw = word(tokens[at]);
  if (bw === 'ahora') {
    base = NOW;
    consumed = 1;
  } else if (bw !== undefined && ES_DEICTIC[bw] !== undefined) {
    base = snapOffset(ES_DEICTIC[bw]!, 'day');
    consumed = 1;
  } else if (WEEKDAYS[bw ?? '']) {
    base = { op: 'seek', base: NOW, dir: 'nearest', target: { kind: 'weekday', weekday: WEEKDAYS[bw ?? '']! } };
    consumed = 1;
  } else {
    const baseYear = yearAt(tokens, at);
    if (baseYear !== undefined && MONTHS[word(tokens[at + 1]) ?? ''] === undefined) {
      base = { op: 'literal', date: { year: baseYear } };
      consumed = 1;
    } else {
      const inner =
        esHoliday(tokens, at, ctx) ?? esDayMonth(tokens, at, ctx) ?? esNumdate(tokens, at, ctx);
      if (inner && inner.role === 'date') {
        base = inner.expr;
        consumed = inner.consumed;
      }
    }
  }
  if (!base) {
    // Marker-less "30 minutos después" → offset from now.
    if ((cw === 'después' || cw === 'despues') && baseStart === at) {
      const shifted: TimeExpr = { op: 'offset', base: NOW, amount: sign * n.value, unit };
      return {
        expr: subDay ? shifted : { op: 'snap', base: shifted, unit: 'day' },
        consumed: baseStart - i,
        confidence: 0.9,
        role: 'datetime',
      };
    }
    return undefined;
  }
  if (asSpan) {
    return {
      expr: { op: 'span', anchor: base, amount: { [`${unit}s`]: sign * n.value } },
      consumed: at + consumed - i,
      confidence: 1,
      role: 'date',
    };
  }
  const shifted: TimeExpr = { op: 'offset', base, amount: sign * n.value, unit };
  return {
    expr: subDay || bw === 'ahora' && subDay ? shifted : subDay ? shifted : { op: 'snap', base: shifted, unit: 'day' },
    consumed: at + consumed - i,
    confidence: 1,
    role: 'date',
  };
};

/* ------------------------------------------------------------------ */
/* Holidays                                                           */
/* ------------------------------------------------------------------ */

const HOLIDAYS: { words: string[]; name: HolidayName }[] = [
  { words: ['navidad'], name: 'christmas' },
  { words: ['navidades'], name: 'christmas' },
  { words: ['año', 'nuevo'], name: 'new-year' },
  { words: ['ano', 'nuevo'], name: 'new-year' },
  { words: ['viernes', 'negro'], name: 'black-friday' },
  { words: ['día', 'de', 'la', 'tierra'], name: 'earth-day' },
  { words: ['dia', 'de', 'la', 'tierra'], name: 'earth-day' },
  { words: ['día', 'de', 'san', 'patricio'], name: 'st-patricks' },
  { words: ['dia', 'de', 'san', 'patricio'], name: 'st-patricks' },
  { words: ['san', 'patricio'], name: 'st-patricks' },
  { words: ['semana', 'santa'], name: 'easter' },
  { words: ['pascua'], name: 'easter' },
  { words: ['pascuas'], name: 'easter' },
  { words: ['día', 'internacional', 'de', 'los', 'trabajadores'], name: 'workers-day' },
  { words: ['dia', 'internacional', 'de', 'los', 'trabajadores'], name: 'workers-day' },
  { words: ['día', 'del', 'trabajador'], name: 'workers-day' },
  { words: ['dia', 'del', 'trabajador'], name: 'workers-day' },
  { words: ['día', 'del', 'trabajo'], name: 'workers-day' },
  { words: ['dia', 'del', 'trabajo'], name: 'workers-day' },
  { words: ['día', 'de', 'la', 'independencia'], name: 'independence-day' },
  { words: ['día', 'de', 'independencia'], name: 'independence-day' },
  { words: ['dia', 'de', 'la', 'independencia'], name: 'independence-day' },
  { words: ['dia', 'de', 'independencia'], name: 'independence-day' },
];

/** "Navidad", "la semana santa 2018", "día de independencia de este año". */
const esHoliday: Rule = (tokens, i) => {
  let at = i;
  let dir: 'prev' | 'next' | undefined;
  const w0 = word(tokens[at]);
  if (w0 === 'el' || w0 === 'la') at += 1;
  const mod0 = word(tokens[at]);
  if (mod0 === 'próximo' || mod0 === 'próxima' || mod0 === 'proximo' || mod0 === 'proxima') {
    dir = 'next';
    at += 1;
  } else if (mod0 === 'pasado' || mod0 === 'pasada' || mod0 === 'último' || mod0 === 'última') {
    dir = 'prev';
    at += 1;
  }
  for (const h of HOLIDAYS) {
    const end0 = matchPhraseAt(tokens, at, h.words);
    if (end0 === undefined) continue;
    let end = end0;
    const post = word(tokens[end]);
    if (dir === undefined) {
      if (post === 'próximo' || post === 'próxima' || post === 'siguiente') {
        dir = 'next';
        end += 1;
      } else if (post === 'pasado' || post === 'pasada' || post === 'anterior') {
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
    // "de este año" → constrain to the current year.
    if (word(tokens[end]) === 'de' && word(tokens[end + 1]) === 'este' &&
        (word(tokens[end + 2]) === 'año' || word(tokens[end + 2]) === 'ano')) {
      return {
        expr: { op: 'intersect', parts: [snapNow('year'), expr] },
        consumed: end + 3 - i,
        confidence: 1,
        role: 'date',
      };
    }
    return { expr, consumed: end - i, confidence: 1, role: 'date' };
  }
  return undefined;
};

/* ------------------------------------------------------------------ */
/* Decades / centuries / years                                        */
/* ------------------------------------------------------------------ */

/** "la década de 1990", "los años 90" (dual is inexpressible; single decade). */
const esDecade: Rule = (tokens, i) => {
  let at = i;
  if (word(tokens[at]) === 'la') at += 1;
  const w = word(tokens[at]);
  if (w !== 'década' && w !== 'decada' && w !== 'decenio') return undefined;
  at += 1;
  if (word(tokens[at]) !== 'de') return undefined;
  at += 1;
  if (word(tokens[at]) === 'los') at += 1;
  const t = tokens[at];
  if (t?.type === 'number' && !t.ordinal && t.value >= 1000 && t.value % 10 === 0) {
    return {
      expr: { op: 'span', anchor: { op: 'literal', date: { year: t.value } }, amount: { years: 10 } },
      consumed: at + 1 - i,
      confidence: 1,
      role: 'date',
    };
  }
  return undefined;
};

const ROMAN: Record<string, number> = { i: 1, v: 5, x: 10 };

function romanValue(w: string): number | undefined {
  if (!/^[ivx]+$/.test(w)) return undefined;
  let total = 0;
  for (let k = 0; k < w.length; k += 1) {
    const v = ROMAN[w[k]!]!;
    const next = k + 1 < w.length ? ROMAN[w[k + 1]!]! : 0;
    total += v < next ? -v : v;
  }
  return total >= 1 && total <= 30 ? total : undefined;
}

/** "el siglo XV" → 1400–1500; "siglo XXI" → 2000–2100. */
const esCentury: Rule = (tokens, i) => {
  let at = i;
  if (word(tokens[at]) === 'el') at += 1;
  if (word(tokens[at]) !== 'siglo') return undefined;
  at += 1;
  const w = word(tokens[at]);
  const n = w !== undefined ? romanValue(w) : undefined;
  if (n === undefined) return undefined;
  return {
    expr: {
      op: 'span',
      anchor: { op: 'literal', date: { year: (n - 1) * 100 } },
      amount: { years: 100 },
    },
    consumed: at + 1 - i,
    confidence: 1,
    role: 'date',
  };
};

/** "el año 2008", "el año calendario 2008", "año calendario 18", "este calendario año". */
const esCalYear: Rule = (tokens, i) => {
  let at = i;
  if (word(tokens[at]) === 'el' || word(tokens[at]) === 'en' || word(tokens[at]) === 'este') {
    if (word(tokens[at]) === 'en' && word(tokens[at + 1]) === 'el') at += 1;
    at += 1;
  }
  // "calendario año" (calque word order).
  if (word(tokens[at]) === 'calendario' && (word(tokens[at + 1]) === 'año' || word(tokens[at + 1]) === 'ano')) {
    const y = yearAt(tokens, at + 2);
    if (y !== undefined) {
      return { expr: { op: 'literal', date: { year: y } }, consumed: at + 3 - i, confidence: 1, role: 'date' };
    }
    return { expr: snapNow('year'), consumed: at + 2 - i, confidence: 0.9, role: 'date' };
  }
  if (word(tokens[at]) !== 'año' && word(tokens[at]) !== 'ano') return undefined;
  at += 1;
  if (word(tokens[at]) === 'calendario') {
    at += 1;
    const t = tokens[at];
    if (t?.type === 'number' && !t.ordinal) {
      if (t.value >= 1000 && t.value <= 2999) {
        return { expr: { op: 'literal', date: { year: t.value } }, consumed: at + 1 - i, confidence: 1, role: 'date' };
      }
      if (t.value <= 99) {
        return {
          expr: { op: 'literal', date: { year: century(t.value) } },
          consumed: at + 1 - i,
          confidence: 0.95,
          role: 'date',
        };
      }
    }
    return { expr: snapNow('year'), consumed: at - i, confidence: 0.9, role: 'date' };
  }
  const y = yearAt(tokens, at);
  if (y !== undefined) {
    return { expr: { op: 'literal', date: { year: y } }, consumed: at + 1 - i, confidence: 1, role: 'date' };
  }
  return undefined;
};

/** "en el año hasta la fecha" → year-to-date. */
const esYearToDate: Rule = (tokens, i) => {
  let at = i;
  if (word(tokens[at]) === 'el') at += 1;
  if (word(tokens[at]) !== 'año' && word(tokens[at]) !== 'ano') return undefined;
  at += 1;
  if (word(tokens[at]) !== 'hasta' || word(tokens[at + 1]) !== 'la' || word(tokens[at + 2]) !== 'fecha') {
    return undefined;
  }
  return {
    expr: {
      op: 'between',
      start: snapNow('year'),
      end: { op: 'snap', base: snapNow('day'), unit: 'day', edge: 'start' },
    },
    consumed: at + 3 - i,
    confidence: 1,
    role: 'date',
  };
};

/** Bare year licensed by a preceding preposition, or standing alone. */
const esBareYear: Rule = (tokens, i) => {
  const t = tokens[i];
  if (t?.type !== 'number' || t.ordinal || t.value < 1900 || t.value > 2159) return undefined;
  return { expr: { op: 'literal', date: { year: t.value } }, consumed: 1, confidence: 0.6, role: 'date' };
};

/** "el año anterior a la revolución" — Recognizers tags just "el año". */
const esYearAnteriorA: Rule = (tokens, i) => {
  let at = i;
  if (word(tokens[at]) === 'el') at += 1;
  if (word(tokens[at]) !== 'año' && word(tokens[at]) !== 'ano') return undefined;
  if (word(tokens[at + 1]) !== 'anterior' || word(tokens[at + 2]) !== 'a') return undefined;
  let end = at + 3;
  if (word(tokens[end]) === 'la' || word(tokens[end]) === 'el') end += 1;
  const nw = word(tokens[end]);
  if (nw === undefined || MONTHS[nw] !== undefined || WEEKDAYS[nw] !== undefined || ES_UNITS[nw] !== undefined) {
    return undefined;
  }
  return { expr: snapNow('year'), consumed: end + 1 - i, confidence: 0.95, role: 'date' };
};

/* ------------------------------------------------------------------ */
/* Bare units, rest-of, week-after-next                               */
/* ------------------------------------------------------------------ */

/** "del año", "de la semana", "en el año", "socio del mes" → current unit. */
const esBareUnit: Rule = (tokens, i) => {
  let at = i;
  const w0 = word(tokens[at]);
  if (w0 === 'del') at += 1;
  else if ((w0 === 'de' || w0 === 'en' || w0 === 'por') && ['el', 'la'].includes(word(tokens[at + 1]) ?? '')) at += 2;
  else return undefined;
  const unit = ES_UNITS[word(tokens[at]) ?? ''];
  if (!unit || unit === 'hour' || unit === 'minute' || unit === 'second') return undefined;
  const next = word(tokens[at + 1]);
  if (
    next !== undefined &&
    (['de', 'del', 'que', 'después', 'despues', 'pasada', 'pasado', 'anterior', 'siguiente',
      'próxima', 'proxima', 'próximo', 'proximo', 'hasta', 'santa', 'calendario', 'y', 'nuevo'].includes(next) ||
      MONTHS[next] !== undefined)
  ) {
    return undefined;
  }
  if (tokens[at + 1]?.type === 'number') return undefined;
  return { expr: snapNow(unit), consumed: at + 1 - i, confidence: 0.6, role: 'date' };
};

/** "el resto de la semana" → today through the end of Saturday. */
const esRestOf: Rule = (tokens, i) => {
  let at = i;
  if (word(tokens[at]) === 'el') at += 1;
  if (word(tokens[at]) !== 'resto') return undefined;
  at += 1;
  const sw = word(tokens[at]);
  if (sw === 'de' || sw === 'del') at += 1;
  if (word(tokens[at]) === 'la' || word(tokens[at]) === 'el') at += 1;
  const unit = ES_UNITS[word(tokens[at]) ?? ''];
  if (!unit || unit === 'hour' || unit === 'minute' || unit === 'second' || unit === 'day') return undefined;
  at += 1;
  const end: TimeExpr =
    unit === 'week'
      ? { op: 'offset', base: { op: 'snap', base: snapNow('week'), unit: 'week', edge: 'end' }, amount: -1, unit: 'day' }
      : { op: 'snap', base: snapNow(unit), unit, edge: 'end' };
  return {
    expr: { op: 'between', start: snapNow('day'), end },
    consumed: at - i,
    confidence: 1,
    role: 'date',
  };
};

/** "la semana después de la próxima" → the week after next. */
const esWeekAfterNext: Rule = (tokens, i) => {
  let at = i;
  if (word(tokens[at]) === 'la') at += 1;
  const unit = ES_UNITS[word(tokens[at]) ?? ''];
  if (!unit) return undefined;
  const end = matchPhraseAt(tokens, at + 1, ['después', 'de', 'la', 'próxima']) ??
    matchPhraseAt(tokens, at + 1, ['despues', 'de', 'la', 'proxima']) ??
    matchPhraseAt(tokens, at + 1, ['después', 'del', 'próximo']) ??
    matchPhraseAt(tokens, at + 1, ['despues', 'del', 'proximo']);
  if (end === undefined) return undefined;
  return { expr: snapOffset(2, unit), consumed: end - i, confidence: 1, role: 'date' };
};

/** "este próximo viernes" → the strictly-next Friday (n bypasses the policy). */
const esEsteProximo: Rule = (tokens, i) => {
  let at = i;
  if (word(tokens[at]) === 'para') at += 1;
  if (word(tokens[at]) !== 'este' && word(tokens[at]) !== 'esta') return undefined;
  const mw = word(tokens[at + 1]);
  if (mw !== 'próximo' && mw !== 'proximo' && mw !== 'próxima' && mw !== 'proxima') return undefined;
  const wd = WEEKDAYS[word(tokens[at + 2]) ?? ''];
  if (!wd) return undefined;
  return {
    expr: { op: 'seek', base: NOW, dir: 'next', target: { kind: 'weekday', weekday: wd }, n: 1 },
    consumed: at + 3 - i,
    confidence: 1,
    role: 'date',
  };
};

/** "el miércoles [por la tarde] la semana que viene" → that weekday next week. */
const esWeekdayOfNextWeek: Rule = (tokens, i) => {
  let at = i;
  if (word(tokens[at]) === 'el') at += 1;
  const wd = WEEKDAYS[word(tokens[at]) ?? ''];
  if (!wd) return undefined;
  at += 1;
  let period: DayPeriod | undefined;
  const ps = readPeriodSuffix(tokens, at);
  if (ps && ps.period !== 'madrugada') {
    period = ps.period;
    at += ps.consumed;
  }
  const end = matchPhraseAt(tokens, at, ['la', 'semana', 'que', 'viene']) ??
    matchPhraseAt(tokens, at, ['de', 'la', 'semana', 'que', 'viene']) ??
    matchPhraseAt(tokens, at, ['la', 'próxima', 'semana']) ??
    matchPhraseAt(tokens, at, ['la', 'proxima', 'semana']);
  if (end === undefined) return undefined;
  const seek: TimeExpr = {
    op: 'seek', base: snapOffset(1, 'week'), dir: 'next', target: { kind: 'weekday', weekday: wd }, n: 1,
  };
  const expr: TimeExpr = period === undefined
    ? seek
    : { op: 'intersect', parts: [seek, { op: 'literal', dayPeriod: period }] };
  return { expr, consumed: end - i, confidence: 1, role: period === undefined ? 'date' : 'datetime' };
};

/**
 * "el primer lunes de próximo mes", "el primer lunes por la tarde de próximo
 * mes", "el primer lunes de 13:00 a 15:00 de próximo mes".
 */
const esNthWeekdayOfMonth: Rule = (tokens, i, ctx) => {
  let at = i;
  if (word(tokens[at]) === 'para') at += 1;
  if (word(tokens[at]) === 'el') at += 1;
  const nth = ORDINAL_WORDS[word(tokens[at]) ?? ''] ?? ordinalWord(word(tokens[at]));
  if (nth === undefined || nth > 5) return undefined;
  at += 1;
  const wd = WEEKDAYS[word(tokens[at]) ?? ''];
  if (!wd) return undefined;
  at += 1;
  let period: DayPeriod | undefined;
  let range: TimeExpr | undefined;
  let progressed = true;
  while (progressed) {
    progressed = false;
    const ps = readPeriodSuffix(tokens, at);
    if (ps && ps.period !== 'madrugada' && period === undefined) {
      period = ps.period;
      at += ps.consumed;
      progressed = true;
      continue;
    }
    if (range === undefined) {
      const r = esRange(tokens, at, ctx);
      if (r && r.role === 'time' && r.expr.op === 'between') {
        range = r.expr;
        at += r.consumed;
        progressed = true;
        continue;
      }
    }
  }
  // Scope: "(de|del) [el] (próximo|este) mes" or a month name.
  const sw = word(tokens[at]);
  if (sw !== 'de' && sw !== 'del') return undefined;
  let k = at + 1;
  if (word(tokens[k]) === 'el') k += 1;
  let monthExpr: TimeExpr | undefined;
  const mw = word(tokens[k]);
  if (MONTHS[mw ?? ''] !== undefined) {
    monthExpr = { op: 'literal', date: { month: MONTHS[mw ?? '']! } };
    k += 1;
  } else {
    let delta: -1 | 0 | 1 | undefined;
    if (mw === 'próximo' || mw === 'proximo' || mw === 'siguiente') {
      delta = 1;
      k += 1;
    } else if (mw === 'este') {
      delta = 0;
      k += 1;
    } else if (mw === 'pasado' || mw === 'último' || mw === 'ultimo') {
      delta = -1;
      k += 1;
    }
    if (word(tokens[k]) !== 'mes' || delta === undefined) return undefined;
    monthExpr = delta === 0 ? snapNow('month') : snapOffset(delta, 'month');
    k += 1;
  }
  const seek: TimeExpr = { op: 'seek', base: monthExpr, dir: 'next', target: { kind: 'weekday', weekday: wd }, n: nth };
  let expr: TimeExpr = seek;
  if (range !== undefined) expr = { op: 'intersect', parts: [seek, range] };
  else if (period !== undefined) expr = { op: 'intersect', parts: [seek, { op: 'literal', dayPeriod: period }] };
  return {
    expr,
    consumed: k - i,
    confidence: 1,
    role: period === undefined && range === undefined ? 'date' : 'datetime',
  };
};

/* ------------------------------------------------------------------ */
/* Weeks                                                              */
/* ------------------------------------------------------------------ */

/** The week containing `scope`'s 4th day, plus n−1 weeks (Recognizers style). */
function nthWeekExpr(scope: TimeExpr, scopeUnit: Unit, nth: number | 'last'): TimeExpr {
  if (nth === 'last') {
    return {
      op: 'snap',
      base: {
        op: 'offset',
        base: { op: 'snap', base: scope, unit: scopeUnit, edge: 'end' },
        amount: -4,
        unit: 'day',
      },
      unit: 'week',
    };
  }
  const first: TimeExpr = {
    op: 'snap',
    base: {
      op: 'offset',
      base: { op: 'snap', base: scope, unit: scopeUnit, edge: 'start' },
      amount: 3,
      unit: 'day',
    },
    unit: 'week',
  };
  return nth === 1 ? first : { op: 'offset', base: first, amount: nth - 1, unit: 'week' };
}

/**
 * "la semana del 15", "la semana de 10 de abril", "la semana que inicia el 4
 * de febrero", "la primera semana de 2021", "la tercera semana de enero",
 * "semana 31", "la semana 27 del año pasado", "semana 3 de dos mil veintisiete".
 */
const esWeekOf: Rule = (tokens, i, ctx) => {
  let at = i;
  if (word(tokens[at]) === 'la') at += 1;
  let nth: number | 'last' | undefined;
  const nw = word(tokens[at]);
  if (nw !== undefined && ORDINAL_WORDS[nw] !== undefined) {
    nth = ORDINAL_WORDS[nw]!;
    at += 1;
  } else if (nw === 'última' || nw === 'ultima') {
    nth = 'last';
    at += 1;
  } else {
    const ow = ordinalWord(nw);
    if (ow !== undefined && ow <= 5) {
      nth = ow;
      at += 1;
    } else if (tokens[at]?.type === 'number' && !((tokens[at] as { ordinal: boolean }).ordinal)) {
      const v = (tokens[at] as { value: number }).value;
      // "3ª semana" arrives as a plain number (º/ª are outside the token class).
      if (v >= 1 && v <= 5 && word(tokens[at + 1]) === 'semana') {
        nth = v;
        at += 1;
      }
    }
  }
  if (word(tokens[at]) !== 'semana') return undefined;
  at += 1;

  // "la semana que inicia/comienza/va del 4 de febrero" / "a partir del 4 …".
  if (word(tokens[at]) === 'que') {
    let k = at + 1;
    const vw = word(tokens[k]);
    if (!['inicia', 'comienza', 'empieza', 'va', 'comience', 'inicie'].includes(vw ?? '')) return undefined;
    k += 1;
    if (['el', 'del', 'de'].includes(word(tokens[k]) ?? '')) k += 1;
    const inner = esDayMonth(tokens, k, ctx) ?? esNumdate(tokens, k, ctx);
    if (inner) {
      return {
        expr: { op: 'snap', base: inner.expr, unit: 'week' },
        consumed: k + inner.consumed - i,
        confidence: 1,
        role: 'date',
      };
    }
    return undefined;
  }
  if (word(tokens[at]) === 'a' && word(tokens[at + 1]) === 'partir') {
    let k = at + 2;
    if (['del', 'de'].includes(word(tokens[k]) ?? '')) k += 1;
    if (word(tokens[k]) === 'el') k += 1;
    const inner = esDayMonth(tokens, k, ctx) ?? esNumdate(tokens, k, ctx);
    if (inner) {
      return {
        expr: { op: 'snap', base: inner.expr, unit: 'week' },
        consumed: k + inner.consumed - i,
        confidence: 1,
        role: 'date',
      };
    }
    return undefined;
  }

  // "semana 31 [de <year> | del año pasado]" — ISO week number.
  const numTok = tokens[at];
  if (nth === undefined && numTok?.type === 'number' && !numTok.ordinal && numTok.value >= 1 && numTok.value <= 53) {
    const n = numTok.value;
    let k = at + 1;
    let yearScope: TimeExpr | undefined;
    let jan4: TimeExpr | undefined;
    if (['de', 'del'].includes(word(tokens[k]) ?? '')) {
      let k2 = k + 1;
      if (word(tokens[k2]) === 'el') k2 += 1;
      const y = yearAt(tokens, k2) ?? (() => {
        const wn = readWordNum(tokens, k2);
        return wn && wn.value >= 1000 && wn.value <= 2999 ? wn.value : undefined;
      })();
      if (y !== undefined) {
        const wn = readWordNum(tokens, k2);
        jan4 = { op: 'literal', date: { year: y, month: 1, day: 4 } };
        k = k2 + (yearAt(tokens, k2) !== undefined ? 1 : wn!.consumed);
      } else {
        let delta: -1 | 0 | 1 = 0;
        let k3 = k2;
        const mw = word(tokens[k3]);
        if (mw === 'año' || mw === 'ano') {
          k3 += 1;
          const pm = word(tokens[k3]);
          if (pm === 'pasado' || pm === 'anterior') {
            delta = -1;
            k3 += 1;
          } else if (pm === 'próximo' || pm === 'proximo' || pm === 'siguiente') {
            delta = 1;
            k3 += 1;
          }
          yearScope = delta === 0 ? snapNow('year') : snapOffset(delta, 'year');
          k = k3;
        }
      }
    }
    if (jan4 === undefined) {
      const base = yearScope ?? snapNow('year');
      jan4 = { op: 'intersect', parts: [base, { op: 'literal', date: { month: 1, day: 4 } }] };
    }
    const week1: TimeExpr = { op: 'snap', base: jan4, unit: 'week' };
    const expr: TimeExpr = n === 1 ? week1 : { op: 'offset', base: week1, amount: n - 1, unit: 'week' };
    return { expr, consumed: k - i, confidence: 0.95, role: 'date' };
  }

  // Scope after "de/del": a date, month [year], or year.
  const dw = word(tokens[at]);
  if (dw === 'de' || dw === 'del') {
    let k = at + 1;
    if (word(tokens[k]) === 'el') k += 1;
    const month = MONTHS[word(tokens[k]) ?? ''];
    if (month !== undefined && nth !== undefined) {
      const y = yearAt(tokens, k + 1);
      const scope: TimeExpr = { op: 'literal', date: { month, ...(y !== undefined ? { year: y } : {}) } };
      return {
        expr: nthWeekExpr(scope, 'month', nth),
        consumed: (y !== undefined ? k + 2 : k + 1) - i,
        confidence: 1,
        role: 'date',
      };
    }
    const y0 = yearAt(tokens, k);
    if (y0 !== undefined && nth !== undefined) {
      return {
        expr: nthWeekExpr({ op: 'literal', date: { year: y0 } }, 'year', nth),
        consumed: k + 1 - i,
        confidence: 1,
        role: 'date',
      };
    }
    if (nth === undefined) {
      // "la semana del 15" / "la semana de 10 de abril" → the containing week.
      const inner = esDayMonth(tokens, k, ctx) ?? esNumdate(tokens, k, ctx);
      if (inner) {
        return {
          expr: { op: 'snap', base: inner.expr, unit: 'week' },
          consumed: k + inner.consumed - i,
          confidence: 1,
          role: 'date',
        };
      }
      const t0 = tokens[k];
      if (t0?.type === 'number' && !t0.ordinal && t0.value >= 1 && t0.value <= 31) {
        return {
          expr: { op: 'snap', base: { op: 'literal', date: { day: t0.value } }, unit: 'week' },
          consumed: k + 1 - i,
          confidence: 0.9,
          role: 'date',
        };
      }
    }
    return undefined;
  }
  return undefined;
};

/* ------------------------------------------------------------------ */
/* Edges (principios / mediados / finales) and early-late             */
/* ------------------------------------------------------------------ */

interface EdgeScope {
  expr: TimeExpr;
  kind: 'day' | 'unit' | 'year' | 'month' | 'period' | 'date';
  unit?: Unit;
  year?: number;
  month?: number;
  consumed: number;
}

/** Scope after "principios/finales de": unit, deictic day, weekday, month, year, date, period. */
function readEdgeScope(tokens: Token[], i: number, ctx: TimeContext): EdgeScope | undefined {
  let at = i;
  const w0 = word(tokens[at]);
  if (w0 === 'la' || w0 === 'el' || w0 === 'este' || w0 === 'esta') at += 1;
  const w = word(tokens[at]);
  // "esta mañana" / "la mañana" = the morning period, not tomorrow.
  if ((w0 === 'esta' || w0 === 'la') && (w === 'mañana' || w === 'manana')) {
    return {
      expr: { op: 'intersect', parts: [snapNow('day'), { op: 'literal', dayPeriod: 'morning' }] },
      kind: 'period',
      consumed: at + 1 - i,
    };
  }
  const deictic = ES_DEICTIC[w ?? ''];
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
  const month = MONTHS[w ?? ''];
  if (month !== undefined) {
    // A full date ("7 de enero") is read below via esDayMonth; bare month here.
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
  const dm = esDayMonth(tokens, at, ctx);
  if (dm && dm.expr.op === 'literal' && dm.expr.date?.day !== undefined) {
    return { expr: dm.expr, kind: 'date', consumed: at + dm.consumed - i };
  }
  const unit = ES_UNITS[w ?? ''];
  if (unit !== undefined && unit !== 'hour' && unit !== 'minute' && unit !== 'second') {
    let delta = 0;
    let consumed = at + 1 - i;
    const mod = word(tokens[at + 1]);
    if (mod !== undefined && ES_POST_MODS[mod] !== undefined) {
      delta = ES_POST_MODS[mod]!;
      consumed += 1;
    } else if (matchPhraseAt(tokens, at + 1, ['que', 'viene']) !== undefined) {
      delta = 1;
      consumed += 2;
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
  if (scope.kind === 'day' || scope.kind === 'date') {
    if (mode === 'end') return { op: 'snap', base: scope.expr, unit: 'day', edge: 'end' };
    return { ...scope.expr, mod: mode };
  }
  if (scope.kind === 'year' && scope.year !== undefined) {
    const startMonth = mode === 'start' ? 1 : mode === 'mid' ? 5 : 9;
    return {
      op: 'span',
      anchor: { op: 'literal', date: { year: scope.year, month: startMonth } },
      amount: { months: 4 },
    };
  }
  // Fixed half-splits of the current week/month/year (not reference-clamped).
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
  if (scope.kind === 'unit' && scope.unit === 'day') {
    if (mode === 'end') return { op: 'snap', base: scope.expr, unit: 'day', edge: 'end' };
    return { ...scope.expr, mod: mode };
  }
  return { ...scope.expr, mod: mode === 'mid' ? 'mid' : mode };
}

const EDGE_MODES: Record<string, 'start' | 'mid' | 'end'> = {
  principios: 'start', principio: 'start', comienzos: 'start', comienzo: 'start',
  inicios: 'start', inicio: 'start',
  mediados: 'mid',
  finales: 'end', final: 'end', fin: 'end', fines: 'end',
};

/** "a principios de julio", "a mediados de 2000", "al final del día", "a fin de mes". */
const esEdge: Rule = (tokens, i, ctx) => {
  let at = i;
  const w0 = word(tokens[at]);
  if (w0 === 'a' || w0 === 'al' || w0 === 'en' || w0 === 'hacia') {
    at += 1;
    if (word(tokens[at]) === 'el' || word(tokens[at]) === 'la') at += 1;
  }
  const modeWord = word(tokens[at]) ?? '';
  const mode = EDGE_MODES[modeWord];
  if (mode === undefined) return undefined;
  at += 1;
  const dw = word(tokens[at]);
  if (dw === 'de' || dw === 'del') at += 1;
  // "fin de semana" is the weekend, not the end of the week.
  if ((modeWord === 'fin' || modeWord === 'fines') && word(tokens[at]) === 'semana') return undefined;
  const scope = readEdgeScope(tokens, at, ctx);
  if (!scope) return undefined;
  return {
    expr: edgeExpr(mode, scope),
    consumed: at + scope.consumed - i,
    confidence: 0.95,
    role: scope.kind === 'period' ? 'datetime' : 'date',
  };
};

/** "temprano en la mañana", "más tarde esta semana", "más temprano de este mes". */
const esEarlyLate: Rule = (tokens, i, ctx) => {
  let at = i;
  let mode: 'start' | 'end' | undefined;
  const w0 = word(tokens[at]);
  if (w0 === 'temprano') {
    mode = 'start';
    at += 1;
  } else if (w0 === 'más' || w0 === 'mas') {
    const w1 = word(tokens[at + 1]);
    if (w1 === 'temprano') mode = 'start';
    else if (w1 === 'tarde') mode = 'end';
    else return undefined;
    at += 2;
  } else {
    return undefined;
  }
  let filler = 0;
  while (filler < 3) {
    const fw = word(tokens[at]);
    if (['en', 'de', 'del', 'la', 'el', 'este', 'esta', 'al', 'a'].includes(fw ?? '') &&
        !(fw === 'a' && WEEKDAYS[word(tokens[at + 1]) ?? ''] === undefined && ES_DEICTIC[word(tokens[at + 1]) ?? ''] === undefined && word(tokens[at + 1]) !== 'día' && word(tokens[at + 1]) !== 'la' && word(tokens[at + 1]) !== 'el')) {
      at += 1;
      filler += 1;
    } else break;
  }
  if (word(tokens[at]) === 'día' || word(tokens[at]) === 'dia') {
    const wd = WEEKDAYS[word(tokens[at + 1]) ?? ''];
    if (wd) {
      return {
        expr: { op: 'seek', base: NOW, dir: 'nearest', target: { kind: 'weekday', weekday: wd }, mod: mode },
        consumed: at + 2 - i,
        confidence: 0.95,
        role: 'date',
      };
    }
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
  const unit = ES_UNITS[uw ?? ''];
  if (unit !== undefined && unit !== 'hour' && unit !== 'minute' && unit !== 'second') {
    return { expr: { ...snapNow(unit), mod: mode }, consumed: at + 1 - i, confidence: 0.95, role: 'date' };
  }
  const deictic = ES_DEICTIC[uw ?? ''];
  if (deictic !== undefined && uw !== 'mañana') {
    // "más tarde hoy" (skip "mañana": "más tarde mañana" is rare and ambiguous).
    return { expr: { ...snapOffset(deictic, 'day'), mod: mode }, consumed: at + 1 - i, confidence: 0.95, role: 'date' };
  }
  if (uw === 'hoy') {
    return { expr: { ...snapNow('day'), mod: mode }, consumed: at + 1 - i, confidence: 0.95, role: 'date' };
  }
  void ctx;
  return undefined;
};

/* ------------------------------------------------------------------ */
/* Ranges                                                             */
/* ------------------------------------------------------------------ */

type Operand =
  | { kind: 'time'; time: PartialTime }
  | { kind: 'date'; date: PartialDate }
  | { kind: 'month'; month: number; year?: number; mod?: 'start' | 'mid' | 'end' }
  | { kind: 'year'; year: number }
  | { kind: 'num'; value: number }
  | { kind: 'expr'; expr: TimeExpr; qYear?: number; qMonth?: number };

function readRangeOperand(
  tokens: Token[],
  i: number,
  ctx: TimeContext,
  preferNum = false,
  preferMonth = false,
): { op: Operand; consumed: number } | undefined {
  let at = i;
  let guard = 0;
  let yearShift: -1 | 0 | 1 | undefined;
  while (guard < 2) {
    const w0 = word(tokens[at]);
    if (['el', 'la', 'los', 'las'].includes(w0 ?? '')) {
      at += 1;
    } else if (w0 === 'este' || w0 === 'esta') {
      yearShift = yearShift ?? 0;
      at += 1;
    } else if (w0 === 'próximo' || w0 === 'proximo' || w0 === 'próxima' || w0 === 'proxima') {
      yearShift = 1;
      at += 1;
    } else break;
    guard += 1;
  }
  const t = tokens[at];
  const w = word(t);

  if (w === 'ahora') {
    // Recognizers floors "ahora" range endpoints to the day.
    return {
      op: { kind: 'expr', expr: { op: 'snap', base: snapNow('day'), unit: 'day', edge: 'start' } },
      consumed: at + 1 - i,
    };
  }
  const deictic = ES_DEICTIC[w ?? ''];
  if (deictic !== undefined) {
    return { op: { kind: 'expr', expr: snapOffset(deictic, 'day') }, consumed: at + 1 - i };
  }

  // "N min después" as a range endpoint ("desde ahora hasta 3 min después").
  {
    const n = readWordNum(tokens, at);
    if (n) {
      const u = ES_UNITS[word(tokens[at + n.consumed]) ?? ''];
      const dw = word(tokens[at + n.consumed + 1]);
      if (u && (dw === 'después' || dw === 'despues')) {
        return {
          op: { kind: 'expr', expr: { op: 'offset', base: NOW, amount: n.value, unit: u } },
          consumed: at + n.consumed + 2 - i,
        };
      }
    }
  }

  // Edge operand: "finales de 2008", "mediados de marzo".
  const mode = EDGE_MODES[w ?? ''];
  if (mode !== undefined) {
    let cursor = at + 1;
    const dw = word(tokens[cursor]);
    if (dw === 'de' || dw === 'del') cursor += 1;
    const inner = readRangeOperand(tokens, cursor, ctx);
    if (!inner) return undefined;
    const io = inner.op;
    const consumedAll = cursor + inner.consumed - i;
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
      if (mode === 'mid') return { op: { kind: 'date', date: { ...date, day: 16 } }, consumed: consumedAll };
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

  // Quarter operands: "2017-t1", "primer trimestre de 2017".
  const q = readQuarterToken(tokens, at);
  if (q) {
    return {
      op: { kind: 'expr', expr: quarterExpr(q), qYear: q.year, qMonth: q.start },
      consumed: at + q.consumed - i,
    };
  }
  const oq = readOrdinalQuarter(tokens, at);
  if (oq) {
    const op: Operand = { kind: 'expr', expr: oq.expr };
    if (oq.year !== undefined) op.qYear = oq.year;
    if (oq.startMonth !== undefined) op.qMonth = oq.startMonth;
    return { op, consumed: at + oq.consumed - i };
  }

  // Clock forms (with optional period suffix).
  const time = readTime(tokens, at);
  if (time && !time.bare) {
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
    if (date) {
      let cursor = at + 1;
      if (yearShift !== undefined && yearShift !== 0 && date.year === undefined) {
        const expr: TimeExpr = {
          op: 'intersect',
          parts: [snapOffset(yearShift, 'year'), { op: 'literal', date }],
        };
        return { op: { kind: 'expr', expr }, consumed: cursor - i };
      }
      if (yearShift === 0 && date.year === undefined) {
        const expr: TimeExpr = {
          op: 'intersect',
          parts: [snapNow('year'), { op: 'literal', date }],
        };
        return { op: { kind: 'expr', expr }, consumed: cursor - i };
      }
      return { op: { kind: 'date', date }, consumed: cursor - i };
    }
  }
  // Slash/joined dates: "diciembre/2018", "01/agosto/2019".
  {
    const nd = esNumdate(tokens, at, ctx);
    if (nd && nd.role === 'date' && nd.expr.op === 'literal' && nd.expr.date !== undefined) {
      return { op: { kind: 'date', date: nd.expr.date }, consumed: at + nd.consumed - i };
    }
  }
  // Ambiguous month/weekday abbreviations ("mar"): a month left side reads a
  // month right side.
  if (preferMonth && monthOf(w) !== undefined) {
    const month = monthOf(w)!;
    let k = at + 1;
    if (word(tokens[k]) === 'de' || word(tokens[k]) === 'del') {
      const y = yearAt(tokens, k + 1);
      if (y !== undefined) return { op: { kind: 'month', month, year: y }, consumed: k + 2 - i };
    }
    const y = yearAt(tokens, k);
    if (y !== undefined) return { op: { kind: 'month', month, year: y }, consumed: k + 1 - i };
    return { op: { kind: 'month', month }, consumed: at + 1 - i };
  }
  const wd = WEEKDAYS[w ?? ''];
  if (wd) {
    let cursor = at + 1;
    let dir: 'next' | 'prev' | 'nearest' = yearShift === 1 ? 'next' : 'nearest';
    const pm = word(tokens[cursor]);
    if (pm === 'próximo' || pm === 'proximo' || pm === 'siguiente') {
      dir = 'next';
      cursor += 1;
    } else if (pm === 'pasado' || pm === 'anterior') {
      dir = 'prev';
      cursor += 1;
    }
    // weekday + explicit date → the date rules own it.
    const dm = esDayMonth(tokens, cursor, ctx) ?? esNumdate(tokens, cursor, ctx);
    if (dm && dm.expr.op === 'literal' && dm.expr.date !== undefined) {
      return { op: { kind: 'date', date: dm.expr.date }, consumed: cursor + dm.consumed - i };
    }
    const seek: TimeExpr = { op: 'seek', base: NOW, dir, target: { kind: 'weekday', weekday: wd } };
    return { op: { kind: 'expr', expr: seek }, consumed: cursor - i };
  }
  const year0 = yearAt(tokens, at);
  const month0 = monthOf(w);
  const numFirst = preferNum && (ONES[w ?? ''] !== undefined || TEENS[w ?? ''] !== undefined);
  if (month0 !== undefined && !numFirst) {
    let k = at + 1;
    if (word(tokens[k]) === 'de' || word(tokens[k]) === 'del') {
      const y = yearAt(tokens, k + 1);
      if (y !== undefined) return { op: { kind: 'month', month: month0, year: y }, consumed: k + 2 - i };
    }
    const y = yearAt(tokens, k);
    if (y !== undefined) return { op: { kind: 'month', month: month0, year: y }, consumed: k + 1 - i };
    if (yearShift !== undefined) {
      // "este mayo" → May of the current year.
      const yearExpr = yearShift === 0 ? snapNow('year') : snapOffset(yearShift, 'year');
      return {
        op: {
          kind: 'expr',
          expr: { op: 'intersect', parts: [yearExpr, { op: 'literal', date: { month: month0 } }] },
        },
        consumed: at + 1 - i,
      };
    }
    return { op: { kind: 'month', month: month0 }, consumed: at + 1 - i };
  }
  // "año 2014" — skip the noun.
  if ((w === 'año' || w === 'ano') && yearAt(tokens, at + 1) !== undefined) {
    return { op: { kind: 'year', year: yearAt(tokens, at + 1)! }, consumed: at + 2 - i };
  }
  // day + month (+ year) via the shared reader.
  const dm = esDayMonth(tokens, at, ctx);
  if (dm && dm.expr.op === 'literal' && dm.expr.date !== undefined && dm.expr.date.day !== undefined) {
    return { op: { kind: 'date', date: dm.expr.date }, consumed: at + dm.consumed - i };
  }
  if (year0 !== undefined) return { op: { kind: 'year', year: year0 }, consumed: at + 1 - i };
  const dnum = readWordNum(tokens, at);
  if (dnum && dnum.value >= 0 && dnum.value <= 31) {
    let cursor = at + dnum.consumed;
    // "3 de la mañana" → an hour with a period.
    const ps = readPeriodSuffix(tokens, cursor);
    if (ps !== undefined && dnum.value <= 23) {
      cursor += ps.consumed;
      const timeOp: PartialTime = { hour: dnum.value };
      if (dnum.value <= 12) timeOp.meridiem = meridiemFor(ps.period);
      return { op: { kind: 'time', time: timeOp }, consumed: cursor - i };
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

/** Day-number pair followed by a month scope: "de 18 a 19 el noviembre", "9 a 12 de junio". */
function finishNumPair(
  tokens: Token[],
  at: number,
  n1: number,
  n2: number,
  ruleStart: number,
): RuleMatch | undefined {
  let cursor = at;
  if (['el', 'del', 'de', 'en'].includes(word(tokens[cursor]) ?? '')) cursor += 1;
  const month = monthOf(word(tokens[cursor]));
  if (month !== undefined && n1 >= 1 && n1 <= 31 && n2 >= 1 && n2 <= 31) {
    let yAt = cursor + 1;
    if (['de', 'del', 'en'].includes(word(tokens[yAt]) ?? '')) yAt += 1;
    const y = yearAt(tokens, yAt);
    const mk = (d: number): TimeExpr =>
      y !== undefined
        ? { op: 'literal', date: { day: d, month, year: y } }
        : { op: 'literal', date: { day: d, month } };
    return {
      expr: { op: 'between', start: mk(n1), end: mk(n2) },
      consumed: (y !== undefined ? yAt + 1 : cursor + 1) - ruleStart,
      confidence: 1,
      role: 'date',
    };
  }
  return undefined;
}

/** "de X a Y", "entre X y Y", "desde X hasta Y", "del X al Y" ranges. */
const esRange: Rule = (tokens, i, ctx) => {
  let at = i;
  const w0 = word(tokens[at]);
  let hasPrefix = false;
  if (['de', 'del', 'desde', 'entre'].includes(w0 ?? '')) {
    hasPrefix = true;
    at += 1;
  }

  const readA = readRangeOperand(tokens, at, ctx);
  if (!readA) return undefined;
  let a = readA.op;
  at += readA.consumed;

  const conn = word(tokens[at]);
  const aQuarter = a.kind === 'expr' && a.qMonth !== undefined;
  const connOk =
    conn === 'a' || conn === 'al' || conn === 'hasta' || conn === '-' || conn === '~' ||
    conn === 'hacia' || (conn === 'y' && hasPrefix);
  if (!connOk) return undefined;
  // Prefixless ranges only for time-ish left sides, quarters, strong
  // connectors, or full dates joined by a dash.
  if (!hasPrefix && a.kind !== 'time' && a.kind !== 'num' && !aQuarter) {
    const strongConn = conn === 'hasta' || conn === '~';
    const dashDates = conn === '-' && (a.kind === 'date' || a.kind === 'expr' || a.kind === 'month' || a.kind === 'year');
    if (!strongConn && !dashDates) return undefined;
  }
  at += 1;

  const preferMonthB = a.kind === 'month' || a.kind === 'year' ||
    (a.kind === 'date' && a.date.month !== undefined);
  const readB = readRangeOperand(tokens, at, ctx, a.kind === 'num' || a.kind === 'time', preferMonthB);
  if (!readB) return undefined;
  let b = readB.op;
  at += readB.consumed;

  // Quarter-to-quarter ranges end at the start of the closing quarter
  // (Recognizers convention): "2017-t1 a 2018-t1" → 2017-01-01…2018-01-01.
  if (aQuarter && b.kind === 'expr' && b.qMonth !== undefined && b.qYear !== undefined) {
    return {
      expr: {
        op: 'between',
        start: a.kind === 'expr' ? a.expr : (undefined as never),
        end: {
          op: 'snap',
          base: { op: 'literal', date: { year: b.qYear, month: b.qMonth } },
          unit: 'month',
          edge: 'start',
        },
      },
      consumed: at - i,
      confidence: 0.95,
      role: 'date',
    };
  }

  // Month scope after a number pair: "de 18 a 19 el noviembre", "9 a 12 de junio".
  if (a.kind === 'num' && b.kind === 'num') {
    const scoped = finishNumPair(tokens, at, a.value, b.value, i);
    if (scoped) return scoped;
  }
  // "desde próximo lunes hasta viernes" — the bare closing weekday follows
  // the opening one.
  if (
    a.kind === 'expr' && a.expr.op === 'seek' && a.expr.target.kind === 'weekday' &&
    b.kind === 'expr' && b.expr.op === 'seek' && b.expr.target.kind === 'weekday' && b.expr.dir === 'nearest'
  ) {
    b = { kind: 'expr', expr: { op: 'seek', base: a.expr, dir: 'next', target: b.expr.target, n: 1 } };
  }
  // Month applies backward when only B got it: "de 26 a 28 de junio en 2020".
  if (a.kind === 'num' && b.kind === 'date' && b.date.month !== undefined) {
    const date: PartialDate = { day: a.value, month: b.date.month };
    if (b.date.year !== undefined) date.year = b.date.year;
    a = { kind: 'date', date };
    if (!hasPrefix) {
      // Prefixless "9 a 12 de junio" ends at the start of the closing day
      // (Recognizers convention for this bare form).
      return {
        expr: {
          op: 'between',
          start: { op: 'literal', date: a.date },
          end: { op: 'snap', base: { op: 'literal', date: b.date }, unit: 'day', edge: 'start' },
        },
        consumed: at - i,
        confidence: 0.9,
        role: 'date',
      };
    }
  }
  // Shared trailing year: "de enero a abril de 2015", "de noviembre a febrero de 2017".
  if (b.kind === 'month' && b.year !== undefined && a.kind === 'month' && a.year === undefined) {
    a = { ...a, year: a.month <= b.month ? b.year : b.year - 1 };
  }
  // "de noviembre a 5 de febrero de 2017" — month left, dated right.
  if (b.kind === 'date' && b.date.year !== undefined && a.kind === 'month' && a.year === undefined) {
    a = { ...a, year: a.month <= (b.date.month ?? 12) ? b.date.year : b.date.year - 1 };
  }
  if (b.kind === 'date' && b.date.year !== undefined && a.kind === 'date' && a.date.year === undefined) {
    const am = a.date.month ?? 0;
    const bm = b.date.month ?? 0;
    if (am < bm || (am === bm && (a.date.day ?? 0) <= (b.date.day ?? 32))) {
      a = { kind: 'date', date: { ...a.date, year: b.date.year } };
    }
  }
  // Trailing year applying to both sides: "de mayo a octubre, 2020", "… en 2020".
  if ((a.kind === 'date' || a.kind === 'month') && (b.kind === 'date' || b.kind === 'month')) {
    const aHasYear = a.kind === 'date' ? a.date.year !== undefined : a.year !== undefined;
    const bHasYear = b.kind === 'date' ? b.date.year !== undefined : b.year !== undefined;
    if (!aHasYear && !bHasYear) {
      let yAt = at;
      if (['de', 'del', 'en'].includes(word(tokens[yAt]) ?? '')) yAt += 1;
      const y = yearAt(tokens, yAt);
      if (y !== undefined) {
        if (a.kind === 'date') a = { kind: 'date', date: { ...a.date, year: y } };
        else a = { ...a, year: y };
        if (b.kind === 'date') b = { kind: 'date', date: { ...b.date, year: y } };
        else b = { ...b, year: y };
        at = yAt + 1;
      }
    }
  }
  // Trailing period: "las cinco a las siete de la mañana".
  let sharedPeriod: DayPeriod | 'madrugada' | undefined;
  if ((a.kind === 'time' || a.kind === 'num') && (b.kind === 'time' || b.kind === 'num')) {
    const ps = readPeriodSuffix(tokens, at);
    if (ps) {
      sharedPeriod = ps.period;
      at += ps.consumed;
    }
  }

  const numToTime = (v: number): PartialTime => (v <= 12 ? { hour: v, meridiem: 'unknown' } : { hour: v });
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
    // Share B's meridiem with A within the same rising half of the day.
    if (ta.meridiem === 'unknown' && tb.meridiem !== undefined && tb.meridiem !== 'unknown' && (ta.hour ?? 0) < (tb.hour ?? 0)) {
      ta = { ...ta, meridiem: tb.meridiem };
    }
    // …and A's with B: "de las 4 p.m. y las 5" (rare; safe when rising and
    // the target is not the ambiguous hour 12).
    if (tb.meridiem === 'unknown' && ta.meridiem !== undefined && ta.meridiem !== 'unknown' &&
        (ta.hour ?? 0) < (tb.hour ?? 0) && tb.hour !== 12) {
      tb = { ...tb, meridiem: ta.meridiem };
    }
    // Descending across noon: "de 8 a.m. - 3" → 08:00–15:00.
    if (tb.meridiem === 'unknown' && ta.meridiem === 'am' && (tb.hour ?? 0) < (ta.hour ?? 0)) {
      tb = { ...tb, meridiem: 'pm' };
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
  if (!hasPrefix && conn !== 'hasta' && conn !== '~' && conn !== '-') return undefined;
  return {
    expr: { op: 'between', start: ea, end: eb },
    consumed: at - i,
    confidence: 0.95,
    role: 'date',
  };
};

/** "enero-febrero de 2017" → month range in dash-split tokens. */
const esMonthDashMonth: Rule = (tokens, i) => {
  const m1 = MONTHS[word(tokens[i]) ?? ''];
  if (m1 === undefined || word(tokens[i + 1]) !== '-') return undefined;
  const m2 = MONTHS[word(tokens[i + 2]) ?? ''];
  if (m2 === undefined) return undefined;
  let at = i + 3;
  let year: number | undefined;
  let yAt = at;
  if (['de', 'del'].includes(word(tokens[yAt]) ?? '')) yAt += 1;
  const y = yearAt(tokens, yAt);
  if (y !== undefined) {
    year = y;
    at = yAt + 1;
  }
  const mk = (mo: number, yy: number | undefined): TimeExpr => ({
    op: 'literal',
    date: { month: mo, ...(yy !== undefined ? { year: yy } : {}) },
  });
  const y1 = year !== undefined ? (m1 <= m2 ? year : year - 1) : undefined;
  return {
    expr: { op: 'between', start: mk(m1, y1), end: mk(m2, year) },
    consumed: at - i,
    confidence: 0.95,
    role: 'date',
  };
};

/* ------------------------------------------------------------------ */
/* Specials                                                           */
/* ------------------------------------------------------------------ */

const esSpecials: Rule = (tokens, i) => {
  const w0 = word(tokens[i]);
  // "de madrugada" → 04:00–08:00 (no matching day period; structural).
  if (w0 === 'de' && word(tokens[i + 1]) === 'madrugada') {
    return {
      expr: {
        op: 'between',
        start: timeLiteral({ hour: 4, meridiem: 'am' }),
        end: timeLiteral({ hour: 8, meridiem: 'am' }),
      },
      consumed: 2,
      confidence: 0.95,
      role: 'time',
    };
  }
  // "pasado mediodía", "este pasado mediodia" → afternoon.
  {
    let at = i;
    if (w0 === 'este' || w0 === 'el') at += 1;
    const pw = readPeriodWord(tokens, at);
    if (pw !== undefined && word(tokens[at]) === 'pasado') {
      return {
        expr: { op: 'literal', dayPeriod: pw.period },
        consumed: at + pw.consumed - i,
        confidence: 0.9,
        role: 'time',
      };
    }
  }
  // "hora de almuerzo" / "almuerzo" → the lunch block (11:00–13:00).
  if (w0 === 'hora' && word(tokens[i + 1]) === 'de' && word(tokens[i + 2]) === 'almuerzo') {
    return {
      expr: { op: 'between', start: timeLiteral({ hour: 11 }), end: timeLiteral({ hour: 13 }) },
      consumed: 3,
      confidence: 0.95,
      role: 'time',
    };
  }
  if (w0 === 'almuerzo') {
    return {
      expr: { op: 'between', start: timeLiteral({ hour: 11 }), end: timeLiteral({ hour: 13 }) },
      consumed: 1,
      confidence: 0.7,
      role: 'time',
    };
  }
  // "la cena" → the dinner block (Recognizers: 16:00–20:00 evening).
  if (w0 === 'cena') {
    return { expr: { op: 'literal', dayPeriod: 'evening' }, consumed: 1, confidence: 0.7, role: 'time' };
  }
  return undefined;
};

/**
 * "ayer por la tarde" as one datetime match, so an adjacent explicit time
 * range keeps precedence over the period block when the parser merges parts.
 */
const esDeicticPeriod: Rule = (tokens, i) => {
  const w0 = word(tokens[i]);
  const deictic = w0 !== undefined ? ES_DEICTIC[w0] : undefined;
  if (deictic === undefined) return undefined;
  const ps = readPeriodSuffix(tokens, i + 1);
  if (!ps || ps.period === 'madrugada') return undefined;
  return {
    expr: {
      op: 'intersect',
      parts: [snapOffset(deictic, 'day'), { op: 'literal', dayPeriod: ps.period }],
    },
    consumed: 1 + ps.consumed,
    confidence: 1,
    role: 'datetime',
  };
};

/* ------------------------------------------------------------------ */
/* Lexicon                                                            */
/* ------------------------------------------------------------------ */

const ES_UNITS: Record<string, Unit> = {
  segundo: 'second', segundos: 'second', seg: 'second', segs: 'second',
  minuto: 'minute', minutos: 'minute', min: 'minute', mins: 'minute',
  hora: 'hour', horas: 'hour', h: 'hour', hs: 'hour',
  día: 'day', días: 'day', dia: 'day', dias: 'day',
  semana: 'week', semanas: 'week',
  mes: 'month', meses: 'month',
  trimestre: 'quarter', trimestres: 'quarter',
  año: 'year', años: 'year', ano: 'year', anos: 'year',
};

const ES_DEICTIC: Record<string, number> = {
  hoy: 0, ayer: -1, mañana: 1, manana: 1, anteayer: -2,
};

const ES_POST_MODS: Record<string, -1 | 0 | 1> = {
  pasado: -1, pasada: -1,
  anterior: -1, anteriores: -1,
  previo: -1, previa: -1,
  próximo: 1, proximo: 1, próxima: 1, proxima: 1,
  siguiente: 1,
  actual: 0, actuales: 0,
};

const ES_LAST_ADJS = [
  'últimos', 'ultimos', 'últimas', 'ultimas', 'pasados', 'pasadas',
  'anteriores', 'previos', 'previas',
];
const ES_NEXT_ADJS = ['próximos', 'proximos', 'próximas', 'proximas', 'siguientes'];

export const ES_LEXICON: LatinLexicon = {
  articles: ['el', 'la', 'los', 'las', 'lo'],
  units: ES_UNITS,
  weekdays: WEEKDAYS,
  months: MONTHS,
  periods: PERIODS,
  smallNumbers: {
    ...ONES, ...TEENS, ...TENS,
    unos: 3, unas: 3, algunos: 3, algunas: 3, varios: 3, varias: 3,
  },
  deictic: ES_DEICTIC,
  deicticPhrases: [{ words: ['pasado', 'mañana'], delta: 2 }],
  preMods: {
    próximo: 1, proximo: 1, próxima: 1, proxima: 1,
    este: 0, esta: 0,
    mismo: 0, misma: 0,
    siguiente: 1,
    último: -1, ultimo: -1, última: -1, ultima: -1,
  },
  postMods: ES_POST_MODS,
  postModPhrases: [{ words: ['que', 'viene'], delta: 1 }],
  agoPrefixes: [['hace']],
  inPrefixes: [['dentro', 'de'], ['en']],
  lastNAdjs: ES_LAST_ADJS,
  nextNAdjs: ES_NEXT_ADJS,
  atPhrases: [['a', 'las'], ['a', 'la'], ['hacia', 'las']],
  periodMarkers: [['por', 'la'], ['de', 'la'], ['en', 'la'], ['por', 'el'], ['a', 'la'], ['esta'], ['este']],
  dateSep: ['de', 'del'],
  weekendPhrases: [['fin', 'de', 'semana']],
  specialPhrases: [
    {
      // "anoche" = last night
      words: ['anoche'],
      expr: {
        op: 'intersect',
        parts: [
          { op: 'snap', base: { op: 'offset', base: NOW, amount: -1, unit: 'day' }, unit: 'day' },
          { op: 'literal', dayPeriod: 'night' },
        ],
      },
    },
    { words: ['ahora', 'mismo'], expr: NOW, role: 'datetime' },
    { words: ['ahora'], expr: NOW, role: 'datetime' },
    {
      // "esta madrugada" → the small hours of today (04:00–08:00).
      words: ['esta', 'madrugada'],
      expr: {
        op: 'between',
        start: { op: 'literal', time: { hour: 4, meridiem: 'am' } },
        end: { op: 'literal', time: { hour: 8, meridiem: 'am' } },
      },
      role: 'time',
    },
  ],
  noonWords: ['mediodía', 'mediodia'],
  midnightWords: ['medianoche'],
  thousandWords: ['mil'],
  rangeFrom: [['desde'], ['entre'], ['de']],
  rangeTo: [['hasta'], ['a']],
  rangeAnd: ['y'],
  durationTriggers: ['durante', 'durará', 'durara', 'dura'],
  dateOrder: 'DMY',
  dayOrdinals: {
    primero: 1, primer: 1, segundo: 2, tercero: 3, cuarto: 4, quinto: 5,
  },
  endOfMarkers: [
    ['al', 'final', 'de'], ['al', 'final', 'del'], ['al', 'fin', 'de'], ['al', 'fin', 'del'],
  ],
  firstAdjs: ['primera', 'primer'],
  lastAdjs: ['última', 'ultima'],
};

const esExtras: { name: string; rule: Rule }[] = [
  { name: 'es-range', rule: esRange },
  { name: 'es-week-of', rule: esWeekOf },
  { name: 'es-nth-weekday-of-month', rule: esNthWeekdayOfMonth },
  { name: 'es-weekday-of-next-week', rule: esWeekdayOfNextWeek },
  { name: 'es-week-after-next', rule: esWeekAfterNext },
  { name: 'es-este-proximo', rule: esEsteProximo },
  { name: 'es-n-after-date', rule: esNAfterDate },
  { name: 'es-dentro-de', rule: esDentroDe },
  { name: 'es-first-last-n-of-scope', rule: esFirstLastNOfScope },
  { name: 'es-n-unit-span', rule: esNUnitSpan },
  { name: 'es-early-late', rule: esEarlyLate },
  { name: 'es-edge', rule: esEdge },
  { name: 'es-year-to-date', rule: esYearToDate },
  { name: 'es-year-anterior-a', rule: esYearAnteriorA },
  { name: 'es-rest-of', rule: esRestOf },
  { name: 'es-quarter', rule: esQuarter },
  { name: 'es-ordinal-quarter', rule: esOrdinalQuarter },
  { name: 'es-decade', rule: esDecade },
  { name: 'es-century', rule: esCentury },
  { name: 'es-cal-year', rule: esCalYear },
  { name: 'es-duration', rule: esDuration },
  { name: 'es-all-unit', rule: esAllUnit },
  { name: 'es-holiday', rule: esHoliday },
  { name: 'es-specials', rule: esSpecials },
  { name: 'es-deictic-period', rule: esDeicticPeriod },
  { name: 'es-time', rule: esTime },
  { name: 'es-day-month', rule: esDayMonth },
  { name: 'es-month-first', rule: esMonthFirst },
  { name: 'es-month-dash-month', rule: esMonthDashMonth },
  { name: 'es-spaced-date', rule: esSpacedDate },
  { name: 'es-numdate', rule: esNumdate },
  { name: 'es-weekday-day', rule: esWeekdayDay },
  { name: 'es-bare-day', rule: esBareDay },
  { name: 'es-bare-unit', rule: esBareUnit },
  { name: 'es-bare-year', rule: esBareYear },
];

export const ES_RULE_ENTRIES = makeLatinRules(ES_LEXICON, esExtras);

/** Connector words allowed between merged date & time parts. */
export const ES_CONNECTORS = [
  'a', 'al', 'las', 'la', 'el', 'los', 'de', 'del', 'por', 'en', 'para',
  'hacia', 'este', 'esta', 'entre', '-', '~',
];
