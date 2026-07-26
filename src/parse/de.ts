/**
 * German rules: lexicon for the Latin factory plus language-specific extras.
 * Corpus: corpus/forward/imported-recognizers-de.json (issue #13).
 *
 * German quirks handled in extras rather than the shared factory:
 *  - "22.04" / "28.Oktober" arrive as single word tokens (dot inside);
 *  - "halb acht" = 7:30 (half TO eight), "viertel/dreiviertel acht" likewise;
 *  - "<h> Uhr <m>" postfix clock ("18 Uhr 12");
 *  - ordinal day/month words ("siebten vierten" = April 7);
 *  - weekday+period compounds ("Montagnachmittag", "Dienstag Morgen");
 *  - übernächste/vorletzte (+2/−2) beyond the factory's ±1 modifiers;
 *  - von/bis & zwischen/und ranges (the factory has no range grammar).
 */
import type { DayPeriod, PartialTime, TimeExpr, Unit, Weekday } from '../ir/types.js';
import type { Rule, RuleMatch } from './en.js';
import { makeLatinRules, type LatinLexicon } from './latin.js';
import type { Token } from './tokenizer.js';

const NOW: TimeExpr = { op: 'now' };

function word(t: Token | undefined): string | undefined {
  return t?.type === 'word' ? t.value : undefined;
}

const UNITS: Record<string, Unit> = {
  sekunde: 'second', sekunden: 'second', sek: 'second',
  minute: 'minute', minuten: 'minute', min: 'minute',
  stunde: 'hour', stunden: 'hour', std: 'hour',
  tag: 'day', tage: 'day', tagen: 'day', tages: 'day', tg: 'day',
  woche: 'week', wochen: 'week',
  monat: 'month', monate: 'month', monaten: 'month', monats: 'month',
  quartal: 'quarter', quartale: 'quarter', quartalen: 'quarter',
  jahr: 'year', jahre: 'year', jahren: 'year', jahres: 'year',
};

const WEEKDAYS: Record<string, Weekday> = {
  montag: 'mon', dienstag: 'tue', mittwoch: 'wed', donnerstag: 'thu',
  freitag: 'fri', samstag: 'sat', sonnabend: 'sat', sonntag: 'sun',
};

const MONTHS: Record<string, number> = {
  januar: 1, februar: 2, märz: 3, maerz: 3, april: 4, mai: 5, juni: 6,
  juli: 7, august: 8, september: 9, oktober: 10, november: 11, dezember: 12,
  jan: 1, feb: 2, mär: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9,
  okt: 10, nov: 11, dez: 12,
};

/** Period nouns and adverbs (morgens, abends, …). "morgen" is ALSO the
 * deictic tomorrow; the factory prefers the deictic for bare uses. */
const PERIODS: Record<string, DayPeriod> = {
  morgen: 'morning', vormittag: 'morning', mittag: 'afternoon',
  nachmittag: 'afternoon', abend: 'evening', nacht: 'night',
  morgens: 'morning', vormittags: 'morning', nachmittags: 'afternoon',
  abends: 'evening', nachts: 'night',
  frühmorgens: 'morning', früh: 'morning',
  spätnachmittag: 'afternoon', spätnachmittags: 'afternoon',
  spätabend: 'evening', spätabends: 'evening',
};

/** Period words usable as an AM/PM suffix after a clock reading. */
const PERIOD_MERIDIEM: Record<string, 'am' | 'pm'> = {
  morgens: 'am', vormittags: 'am', früh: 'am', frühmorgens: 'am',
  mittags: 'pm', nachmittags: 'pm', abends: 'pm', nachts: 'am',
  spätabends: 'pm', spätnachmittags: 'pm',
  morgen: 'am', vormittag: 'am', nachmittag: 'pm', abend: 'pm', nacht: 'am',
};

const CARDINALS: Record<string, number> = {
  ein: 1, eine: 1, einen: 1, einem: 1, einer: 1, eins: 1,
  zwei: 2, beide: 2, beiden: 2, drei: 3, vier: 4, fünf: 5, fuenf: 5,
  sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10, elf: 11, zwölf: 12,
  zwoelf: 12, fünfzehn: 15, zwanzig: 20, dreißig: 30, dreissig: 30,
};

/** German ordinal words 1–31 in all adjective inflections. */
const ORDINALS: Record<string, number> = (() => {
  const stems: [number, string][] = [
    [1, 'erst'], [2, 'zweit'], [3, 'dritt'], [4, 'viert'], [5, 'fünft'],
    [5, 'fuenft'], [6, 'sechst'], [7, 'siebt'], [7, 'siebent'], [8, 'acht'],
    [9, 'neunt'], [10, 'zehnt'], [11, 'elft'], [12, 'zwölft'], [12, 'zwoelft'],
    [13, 'dreizehnt'], [14, 'vierzehnt'], [15, 'fünfzehnt'], [15, 'fuenfzehnt'],
    [16, 'sechzehnt'], [17, 'siebzehnt'], [18, 'achtzehnt'], [19, 'neunzehnt'],
  ];
  const ones = ['', 'ein', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun'];
  for (let n = 20; n <= 31; n += 1) {
    const one = n % 10;
    const prefix = one ? `${ones[one]}und` : '';
    stems.push([n, `${prefix}zwanzigst`.replace('zwanzigst', n < 30 ? 'zwanzigst' : 'dreißigst')]);
    if (n >= 30) stems.push([n, `${prefix}dreissigst`]);
  }
  const out: Record<string, number> = {};
  for (const [n, stem] of stems) {
    for (const suffix of ['e', 'en', 'er', 'es', 'em']) out[stem + suffix] = n;
  }
  return out;
})();

export const DE_LEXICON: LatinLexicon = {
  articles: ['der', 'die', 'das', 'den', 'dem', 'des'],
  units: UNITS,
  weekdays: WEEKDAYS,
  months: MONTHS,
  periods: PERIODS,
  smallNumbers: CARDINALS,
  deictic: { heute: 0, gestern: -1, morgen: 1, übermorgen: 2, uebermorgen: 2, vorgestern: -2 },
  preMods: {
    letzte: -1, letzten: -1, letztes: -1, letzter: -1, letztem: -1,
    vergangene: -1, vergangenen: -1,
    nächste: 1, nächsten: 1, nächstes: 1, nächster: 1, nächstem: 1,
    kommende: 1, kommenden: 1,
    diese: 0, diesen: 0, dieses: 0, dieser: 0, diesem: 0,
  },
  postMods: {},
  agoPrefixes: [['vor']],
  inPrefixes: [['in', 'den'], ['in'], ['innerhalb', 'von'], ['innerhalb']],
  lastNAdjs: ['letzten', 'letzte', 'vergangenen'],
  nextNAdjs: ['nächsten', 'nächste', 'kommenden', 'folgenden'],
  // Clock lead-ins are handled entirely in deExtras ("um 15" alone is too
  // eager: "um 15% gefallen").
  atPhrases: [],
  periodMarkers: [['am'], ['an'], ['gegen'], ['in', 'der'], ['auf'], ['zur'], ['zum']],
  dateSep: [],
  weekendPhrases: [['wochenende']],
  specialPhrases: [
    { words: ['jetzt'], expr: NOW, role: 'datetime' },
    { words: ['aktuelle', 'uhrzeit'], expr: NOW, role: 'time' },
  ],
  noonWords: ['mittag', 'mittags', 'mittagszeit'],
  midnightWords: ['mitternacht', 'mitternachts'],
};

// ---------------------------------------------------------------------------
// Extras
// ---------------------------------------------------------------------------

interface TimeRead {
  time: PartialTime;
  consumed: number;
  /** Whether the reading is licensed on its own (clock token / "N Uhr"). */
  anchored: boolean;
}

function readHourish(tokens: Token[], i: number): { value: number; consumed: number } | undefined {
  const t = tokens[i];
  if (t?.type === 'number' && !t.ordinal && t.value >= 0 && t.value <= 24) {
    return { value: t.value, consumed: 1 };
  }
  const w = word(t);
  if (w !== undefined && CARDINALS[w] !== undefined && CARDINALS[w]! <= 24) {
    return { value: CARDINALS[w]!, consumed: 1 };
  }
  return undefined;
}

function applyMeridiem(time: PartialTime, meridiem: 'am' | 'pm'): void {
  const h = time.hour ?? 0;
  if (h > 12) return; // 15 Uhr abends — hour already unambiguous
  time.meridiem = meridiem;
}

/** Read AM/PM suffix words ("8 Uhr abends"); hour 12 at night → midnight. */
function readMeridiemSuffix(tokens: Token[], i: number, time: PartialTime): number {
  const w = word(tokens[i]);
  if (w === undefined) return 0;
  const m = PERIOD_MERIDIEM[w];
  if (m === undefined) return 0;
  if (time.hour === 12 && (w.includes('nacht') || w.includes('abend'))) {
    // "12 Uhr nachts/abends" — midnight, expressed as 12am.
    applyMeridiem(time, 'am');
  } else {
    applyMeridiem(time, m);
  }
  return 1;
}

/**
 * Core clock reading:  <clock> ["uhr"]  |  N "uhr" [["und"] M]  |
 * (lead required) N — each with an optional meridiem suffix word.
 */
function readClock(tokens: Token[], i: number, hasLead: boolean): TimeRead | undefined {
  const t = tokens[i];
  if (t?.type === 'clock') {
    const time: PartialTime = { hour: t.hour };
    if (t.explicitMinute) time.minute = t.minute;
    if (t.second !== undefined) time.second = t.second;
    if (t.meridiem) time.meridiem = t.meridiem;
    else if (t.hour <= 12) time.meridiem = 'unknown';
    let consumed = 1;
    if (word(tokens[i + 1]) === 'uhr') consumed += 1;
    consumed += readMeridiemSuffix(tokens, i + consumed, time);
    return { time, consumed, anchored: true };
  }
  // Word tokens like "18.12" followed by "uhr" ("um 18.12 Uhr" = 18:12).
  const wt = word(t);
  if (wt !== undefined && word(tokens[i + 1]) === 'uhr') {
    const m = wt.match(/^(\d{1,2})\.(\d{1,2})$/);
    if (m) {
      const hour = Number(m[1]);
      const minute = Number(m[2]);
      if (hour <= 23 && minute <= 59) {
        const time: PartialTime = { hour, minute };
        if (hour <= 12) time.meridiem = 'unknown';
        let consumed = 2;
        consumed += readMeridiemSuffix(tokens, i + consumed, time);
        return { time, consumed, anchored: true };
      }
    }
  }
  const h = readHourish(tokens, i);
  if (!h) return undefined;
  let consumed = h.consumed;
  const time: PartialTime = { hour: h.value };
  if (h.value <= 12) time.meridiem = 'unknown';
  let anchored = false;
  if (word(tokens[i + consumed]) === 'uhr') {
    anchored = true;
    consumed += 1;
    // "18 Uhr 12" / "18 Uhr und 12"
    let mAt = i + consumed;
    let extra = 1;
    if (word(tokens[mAt]) === 'und') {
      mAt += 1;
      extra = 2;
    }
    const mt = tokens[mAt];
    if (mt?.type === 'number' && !mt.ordinal && mt.value <= 59 && word(tokens[mAt + 1]) !== 'uhr') {
      time.minute = mt.value;
      consumed += extra;
    }
  }
  const suffix = readMeridiemSuffix(tokens, i + consumed, time);
  if (suffix > 0) {
    anchored = true;
    consumed += suffix;
  }
  if (!anchored && !hasLead) return undefined;
  return { time, consumed, anchored };
}

const LEADS = ['um', 'gegen'];

/** um/gegen + clock, bare clock tokens, "N Uhr [M]", meridiem suffixes. */
const deClock: Rule = (tokens, i) => {
  let at = i;
  let hasLead = false;
  if (LEADS.includes(word(tokens[at]) ?? '')) {
    hasLead = true;
    at += 1;
  }
  const read = readClock(tokens, at, hasLead);
  if (!read) return undefined;
  // A bare number is never licensed here, even after "um": "um 15% gefallen"
  // must not read as 15:00. An anchor (clock token, Uhr, AM/PM word) is
  // required; leads only widen the consumed span.
  if (!read.anchored) return undefined;
  return {
    expr: { op: 'literal', time: read.time },
    consumed: at + read.consumed - i,
    confidence: 0.95,
    role: 'time',
  };
};

/** "halb acht" = 7:30, "viertel acht" = 7:15, "dreiviertel acht" = 7:45,
 * "viertel nach/vor acht" = 8:15 / 7:45. */
const deFractionClock: Rule = (tokens, i) => {
  let at = i;
  if (LEADS.includes(word(tokens[at]) ?? '')) at += 1;
  const w = word(tokens[at]);
  if (w === undefined) return undefined;

  let hourAt = at + 1;
  let minute: number | undefined;
  let hourShift = 0; // −1 → minutes before the *coming* hour
  if (w === 'halb') {
    minute = 30;
    hourShift = -1;
  } else if (w === 'dreiviertel') {
    minute = 45;
    hourShift = -1;
  } else if (w === 'viertel') {
    const nx = word(tokens[at + 1]);
    if (nx === 'nach') {
      minute = 15;
      hourAt = at + 2;
    } else if (nx === 'vor') {
      minute = 45;
      hourShift = -1;
      hourAt = at + 2;
    } else {
      minute = 15;
      hourShift = -1;
    }
  } else {
    return undefined;
  }
  const h = readHourish(tokens, hourAt);
  if (!h || h.value < 1 || h.value > 24) return undefined;
  let hour = h.value + hourShift;
  if (hour === 0) hour = 12;
  const time: PartialTime = { hour, minute };
  if (hour <= 12) time.meridiem = 'unknown';
  let consumed = hourAt + h.consumed - i;
  consumed += readMeridiemSuffix(tokens, i + consumed, time);
  return { expr: { op: 'literal', time }, consumed, confidence: 0.95, role: 'time' };
};

/** DMY numeric dates: "22.01.2016", "29/2", "27.02.2022". */
function numericDMY(parts: number[]): { year?: number; month: number; day: number } | undefined {
  const [a, b, c] = [parts[0]!, parts[1], parts[2]];
  if (b === undefined) return undefined;
  const valid = (d: { year?: number; month: number; day: number }): typeof d | undefined =>
    d.month >= 1 && d.month <= 12 && d.day >= 1 && d.day <= 31 ? d : undefined;
  const year = c === undefined ? undefined : c < 100 ? 2000 + c : c;
  const mk = (day: number, month: number): { year?: number; month: number; day: number } => {
    const d: { year?: number; month: number; day: number } = { month, day };
    if (year !== undefined) d.year = year;
    return d;
  };
  if (a >= 1000) return undefined;
  return valid(mk(a, b)) ?? valid(mk(b, a));
}

const deNumDate: Rule = (tokens, i) => {
  const t = tokens[i];
  if (t?.type !== 'numdate') return undefined;
  const date = numericDMY(t.parts);
  if (!date) return undefined;
  return { expr: { op: 'literal', date }, consumed: 1, confidence: 0.9, role: 'date' };
};

/** Single word tokens "22.04" (day.month) and "28.oktober" (day.Month). */
const deWordDate: Rule = (tokens, i) => {
  const w = word(tokens[i]);
  if (w === undefined) return undefined;
  // "18.12 Uhr" is a time; deClock owns that shape.
  if (word(tokens[i + 1]) === 'uhr') return undefined;
  let m = w.match(/^(\d{1,2})\.(\d{1,2})$/);
  if (m) {
    const date = numericDMY([Number(m[1]), Number(m[2])]);
    if (!date) return undefined;
    return { expr: { op: 'literal', date }, consumed: 1, confidence: 0.85, role: 'date' };
  }
  m = w.match(/^(\d{1,2})\.([a-zäöüß]+)$/);
  if (m) {
    const month = MONTHS[m[2]!];
    const day = Number(m[1]);
    if (month === undefined || day < 1 || day > 31) return undefined;
    return { expr: { op: 'literal', date: { month, day } }, consumed: 1, confidence: 0.95, role: 'date' };
  }
  return undefined;
};

function readDayish(tokens: Token[], i: number): { value: number; consumed: number } | undefined {
  const t = tokens[i];
  if (t?.type === 'number' && t.value >= 1 && t.value <= 31) return { value: t.value, consumed: 1 };
  const w = word(t);
  if (w !== undefined && ORDINALS[w] !== undefined) return { value: ORDINALS[w]!, consumed: 1 };
  return undefined;
}

function readMonthish(
  tokens: Token[],
  i: number,
): { value: number; consumed: number; named: boolean } | undefined {
  const w = word(tokens[i]);
  if (w !== undefined) {
    if (MONTHS[w] !== undefined) return { value: MONTHS[w]!, consumed: 1, named: true };
    if (ORDINALS[w] !== undefined && ORDINALS[w]! <= 12) {
      return { value: ORDINALS[w]!, consumed: 1, named: true };
    }
  }
  const t = tokens[i];
  if (t?.type === 'number' && t.value >= 1 && t.value <= 12) {
    return { value: t.value, consumed: 1, named: false };
  }
  return undefined;
}

/**
 * Day + month in German shapes the factory doesn't know: ordinal words
 * ("neunundzwanzigsten Mai", "siebten vierten"), ordinal + numeric month
 * ("siebter 4."), numeric + ordinal ("7. vierter"), "27. 11.".
 */
const deDayMonth: Rule = (tokens, i) => {
  const d = readDayish(tokens, i);
  if (!d) return undefined;
  const mAt = i + d.consumed;
  const m = readMonthish(tokens, mAt);
  if (!m) return undefined;
  const dayNamed = tokens[i]?.type === 'word';
  if (!dayNamed && !m.named) {
    // Two plain numbers: only read as a date if nothing time/unit-like follows
    // ("3 5 Jahre" from "3,5 Jahre" must not become May 3).
    const after = word(tokens[mAt + m.consumed]);
    if (after !== undefined && (UNITS[after] !== undefined || after === 'uhr' || CARDINALS[after] !== undefined)) {
      return undefined;
    }
  }
  const date: { year?: number; month: number; day: number } = { month: m.value, day: d.value };
  let consumed = d.consumed + m.consumed;
  const yt = tokens[mAt + m.consumed];
  if (yt?.type === 'number' && !yt.ordinal && yt.value >= 1000 && yt.value <= 9999) {
    date.year = yt.value;
    consumed += 1;
  }
  return {
    expr: { op: 'literal', date },
    consumed,
    confidence: dayNamed || m.named ? 0.95 : 0.7,
    role: 'date',
  };
};

/** "übernächste Woche" (+2), "vorletztes Jahr" (−2). */
const deTwoStep: Rule = (tokens, i) => {
  let at = i;
  while (DE_LEXICON.articles.includes(word(tokens[at]) ?? '')) at += 1;
  const w = word(tokens[at]);
  if (w === undefined) return undefined;
  let step: number | undefined;
  if (/^übernächste[nrms]?$/.test(w) || /^uebernaechste[nrms]?$/.test(w)) step = 2;
  else if (/^vorletzte[nrms]?$/.test(w) || /^vorvergangene[nrms]?$/.test(w)) step = -2;
  if (step === undefined) return undefined;
  let nounAt = at + 1;
  while (DE_LEXICON.articles.includes(word(tokens[nounAt]) ?? '')) nounAt += 1;
  const noun = word(tokens[nounAt]);
  if (noun === undefined) return undefined;
  const unit = UNITS[noun];
  if (unit !== undefined) {
    return {
      expr: { op: 'snap', base: { op: 'offset', base: NOW, amount: step, unit }, unit },
      consumed: nounAt + 1 - i,
      confidence: 1,
      role: 'date',
    };
  }
  const weekday = WEEKDAYS[noun];
  if (weekday !== undefined && step === 2) {
    return {
      expr: { op: 'seek', base: NOW, dir: 'next', target: { kind: 'weekday', weekday }, n: 2 },
      consumed: nounAt + 1 - i,
      confidence: 1,
      role: 'date',
    };
  }
  return undefined;
};

/** "Dienstag Morgen", "Montagnachmittag", "sonntag spätabend". */
const deWeekdayPeriod: Rule = (tokens, i) => {
  const w = word(tokens[i]);
  if (w === undefined) return undefined;

  const build = (weekday: Weekday, period: DayPeriod, consumed: number): RuleMatch => ({
    expr: {
      op: 'intersect',
      parts: [
        { op: 'seek', base: NOW, dir: 'nearest', target: { kind: 'weekday', weekday } },
        { op: 'literal', dayPeriod: period },
      ],
    },
    consumed,
    confidence: 0.95,
    role: 'datetime',
  });

  const wd = WEEKDAYS[w];
  if (wd !== undefined) {
    const p = word(tokens[i + 1]);
    const period = p !== undefined ? PERIODS[p] : undefined;
    if (period !== undefined) return build(wd, period, 2);
    return undefined;
  }
  // Single-token compound: weekday name + period suffix.
  for (const [name, weekday] of Object.entries(WEEKDAYS)) {
    if (w.startsWith(name)) {
      const rest = w.slice(name.length).replace(/^s/, '');
      const period = PERIODS[rest] ?? (rest === '' ? undefined : undefined);
      if (period !== undefined) return build(weekday, period, 1);
    }
  }
  return undefined;
};

/** Bare period adverbs/nouns without an article ("morgens", "nachmittag"). */
const deBarePeriod: Rule = (tokens, i) => {
  const w = word(tokens[i]);
  if (w === undefined) return undefined;
  if (DE_LEXICON.deictic[w] !== undefined) return undefined; // "morgen" = tomorrow
  const period = PERIODS[w];
  if (period === undefined) return undefined;
  return { expr: { op: 'literal', dayPeriod: period }, consumed: 1, confidence: 0.55, role: 'time' };
};

/** "[im/aus dem/für das] Jahr 2009" → that calendar year. */
const deYearNoun: Rule = (tokens, i) => {
  let at = i;
  while (DE_LEXICON.articles.includes(word(tokens[at]) ?? '')) at += 1;
  const w = word(tokens[at]);
  if (w !== 'jahr' && w !== 'jahre' && w !== 'jahres') return undefined;
  const yt = tokens[at + 1];
  if (yt?.type !== 'number' || yt.ordinal || yt.value < 1000 || yt.value > 9999) return undefined;
  return {
    expr: { op: 'literal', date: { year: yt.value } },
    consumed: at + 2 - i,
    confidence: 0.95,
    role: 'date',
  };
};

/** Durations: "3 Stunden", "eine Viertelstunde", "anderthalb Stunden". */
const deDuration: Rule = (tokens, i) => {
  const w0 = word(tokens[i]);

  const special = (name: string): number | undefined =>
    name === 'viertelstunde' ? 15 : name === 'dreiviertelstunde' ? 45 : name === 'halbstunde' ? 30 : undefined;

  // [ein/eine] Viertelstunde / Dreiviertelstunde
  if (w0 !== undefined) {
    const minutes = special(w0);
    if (minutes !== undefined) {
      return { expr: { op: 'duration', iso: `PT${minutes}M` }, consumed: 1, confidence: 0.9, role: 'duration' };
    }
    // "eine halbe Stunde"
    if ((w0 === 'halbe' || w0 === 'halben') && UNITS[word(tokens[i + 1]) ?? ''] === 'hour') {
      return { expr: { op: 'duration', iso: 'PT30M' }, consumed: 2, confidence: 0.9, role: 'duration' };
    }
    // anderthalb / zweieinhalb / fünfeinhalb Stunden
    const halfMatch = w0 === 'anderthalb' ? 1 : /^([a-zäöü]+)einhalb$/.exec(w0)?.[1];
    if (halfMatch !== undefined) {
      const base = halfMatch === 1 ? 1 : CARDINALS[halfMatch as string];
      if (base !== undefined && UNITS[word(tokens[i + 1]) ?? ''] === 'hour') {
        const minutes = base * 60 + 30;
        // "Spule anderthalb Stunden vor" — the elapsed stretch ending now.
        if (word(tokens[i + 2]) === 'vor') {
          return {
            expr: { op: 'span', anchor: NOW, amount: { minutes: -minutes } },
            consumed: 3,
            confidence: 0.9,
            role: 'datetime',
          };
        }
        return {
          expr: { op: 'duration', iso: `PT${minutes}M` },
          consumed: 2,
          confidence: 0.9,
          role: 'duration',
        };
      }
    }
    // "den ganzen Tag" — a whole unit as a duration.
    if ((w0 === 'ganzen' || w0 === 'ganze') && UNITS[word(tokens[i + 1]) ?? ''] !== undefined) {
      const unit = UNITS[word(tokens[i + 1]) ?? '']!;
      const amount = unit === 'quarter' ? { months: 3 } : { [`${unit}s`]: 1 };
      return { expr: { op: 'amount', amount }, consumed: 2, confidence: 0.9, role: 'duration' };
    }
  }

  // N + unit ("3 Stunden", "drei Minuten")
  const t = tokens[i];
  let n: number | undefined;
  if (t?.type === 'number' && !t.ordinal) n = t.value;
  else if (w0 !== undefined && CARDINALS[w0] !== undefined) n = CARDINALS[w0];
  if (n === undefined) return undefined;
  const unit = UNITS[word(tokens[i + 1]) ?? ''];
  if (unit === undefined) return undefined;
  const amount = unit === 'quarter' ? { months: 3 * n } : { [`${unit}s`]: n };
  return { expr: { op: 'amount', amount }, consumed: 2, confidence: 0.7, role: 'duration' };
};

// --- Ranges -----------------------------------------------------------------

interface Endpoint {
  kind: 'time' | 'date';
  expr: TimeExpr;
  time?: PartialTime;
  date?: { year?: number; month?: number; day?: number };
  weekday?: Weekday;
  consumed: number;
  anchored: boolean; // time endpoints: had uhr/clock/period
}

function readEndpoint(tokens: Token[], i: number): Endpoint | undefined {
  let at = i;
  while (DE_LEXICON.articles.includes(word(tokens[at]) ?? '')) at += 1;

  // Optional weekday prefix ("von Montag 7 Uhr …").
  let weekday: Weekday | undefined;
  const w = word(tokens[at]);
  if (w !== undefined && WEEKDAYS[w] !== undefined) {
    weekday = WEEKDAYS[w];
    at += 1;
  }

  // Date shapes: numdate token, "dd.mm" word, day + Month [year].
  const t = tokens[at];
  if (t?.type === 'numdate') {
    const date = numericDMY(t.parts);
    if (date) {
      return {
        kind: 'date', expr: { op: 'literal', date }, date,
        consumed: at + 1 - i, anchored: true,
        ...(weekday !== undefined ? { weekday } : {}),
      };
    }
  }
  const wt = word(t);
  if (wt !== undefined && !weekday) {
    const m = wt.match(/^(\d{1,2})\.(\d{1,2})$/);
    if (m) {
      const date = numericDMY([Number(m[1]), Number(m[2])]);
      if (date) {
        return { kind: 'date', expr: { op: 'literal', date }, date, consumed: at + 1 - i, anchored: true };
      }
    }
  }

  const d = readDayish(tokens, at);
  if (d !== undefined && !weekday) {
    const m = readMonthish(tokens, at + d.consumed);
    if (m?.named) {
      const date: { year?: number; month: number; day: number } = { month: m.value, day: d.value };
      let consumed = at + d.consumed + m.consumed - i;
      const yt = tokens[at + d.consumed + m.consumed];
      if (yt?.type === 'number' && !yt.ordinal && yt.value >= 1000 && yt.value <= 9999) {
        date.year = yt.value;
        consumed += 1;
      }
      return { kind: 'date', expr: { op: 'literal', date }, date, consumed, anchored: true };
    }
  }

  // Time shape (also absorbs bare numbers — classification happens later).
  const time = readClock(tokens, at, true);
  if (time) {
    return {
      kind: 'time',
      expr: { op: 'literal', time: time.time },
      time: time.time,
      consumed: at + time.consumed - i,
      anchored: time.anchored,
      ...(weekday !== undefined ? { weekday } : {}),
    };
  }
  if (d !== undefined && !weekday) {
    // Bare day number ("vom 4. bis zum 23.").
    return {
      kind: 'date',
      expr: { op: 'literal', date: { day: d.value } },
      date: { day: d.value },
      consumed: at + d.consumed - i,
      anchored: false,
    };
  }
  return undefined;
}

function endpointExpr(e: Endpoint): TimeExpr {
  if (e.weekday === undefined) return e.expr;
  const seek: TimeExpr = {
    op: 'seek', base: NOW, dir: 'nearest', target: { kind: 'weekday', weekday: e.weekday },
  };
  if (e.kind === 'time') return { op: 'intersect', parts: [seek, e.expr] };
  return seek;
}

/**
 * "von X bis Y" / "zwischen X und Y" ranges — the factory has no range
 * grammar, so German builds `between` here for the common date & time shapes.
 */
const deRange: Rule = (tokens, i) => {
  const lead = word(tokens[i]);
  if (lead !== 'von' && lead !== 'vom' && lead !== 'zwischen') return undefined;
  const a = readEndpoint(tokens, i + 1);
  if (!a) return undefined;
  let mid = i + 1 + a.consumed;
  const midWord = word(tokens[mid]);
  if (midWord !== 'bis' && midWord !== 'und') return undefined;
  mid += 1;
  while (['zum', 'zur', 'zu', 'dem', 'den', 'der'].includes(word(tokens[mid]) ?? '')) mid += 1;
  const b = readEndpoint(tokens, mid);
  if (!b) return undefined;
  const consumed = mid + b.consumed - i;

  // Classify: any anchored-time endpoint or weekday+time → time range;
  // month/named date → date range; "vom"/"zwischen dem" default to dates,
  // plain "von" defaults to times.
  const timeish =
    (a.kind === 'time' && a.anchored) || (b.kind === 'time' && b.anchored) ||
    a.weekday !== undefined || b.weekday !== undefined;
  const dateish =
    (a.kind === 'date' && (a.anchored || a.date?.month !== undefined)) ||
    (b.kind === 'date' && (b.anchored || b.date?.month !== undefined));

  if (!timeish && (dateish || lead === 'vom' || (lead === 'zwischen' && a.kind === 'date'))) {
    // Date range; borrow month/year from the other endpoint when missing.
    const asDate = (e: Endpoint): { year?: number; month?: number; day?: number } | undefined => {
      if (e.date) return e.date;
      if (e.kind === 'time' && e.time?.hour !== undefined && e.time.minute === undefined) {
        return { day: e.time.hour };
      }
      return undefined;
    };
    const da = asDate(a);
    const db = asDate(b);
    if (!da?.day || !db?.day) return undefined;
    if (da.month === undefined && db.month !== undefined) da.month = db.month;
    if (da.year === undefined && db.year !== undefined && da.month === db.month) da.year = db.year;
    const clean = (d: { year?: number; month?: number; day?: number }): { year?: number; month?: number; day?: number } => {
      const out: { year?: number; month?: number; day?: number } = { day: d.day! };
      if (d.month !== undefined) out.month = d.month;
      if (d.year !== undefined) out.year = d.year;
      return out;
    };
    return {
      expr: {
        op: 'between',
        start: { op: 'literal', date: clean(da) },
        end: { op: 'literal', date: clean(db) },
      },
      consumed,
      confidence: 0.9,
      role: 'date',
    };
  }

  if (a.kind === 'time' && b.kind === 'time' && a.time && b.time) {
    // Propagate a trailing meridiem backwards ("von 5 bis 6 Uhr Nachmittags").
    if (b.time.meridiem !== undefined && b.time.meridiem !== 'unknown' && a.time.meridiem === 'unknown') {
      a.time.meridiem = b.time.meridiem;
    }
    return {
      expr: { op: 'between', start: endpointExpr(a), end: endpointExpr(b) },
      consumed,
      confidence: 0.9,
      role: a.weekday !== undefined ? 'datetime' : 'time',
    };
  }
  return undefined;
};

/**
 * Dash-joined date component sequences from the tokenizer's split
 * ("Sep-23-2020", "23-2020-September"): a month name, a day, and optionally a
 * year in any order, joined by '-' word tokens.
 */
const deDashDate: Rule = (tokens, i) => {
  let month: number | undefined;
  let day: number | undefined;
  let year: number | undefined;
  let at = i;
  let parts = 0;
  while (parts < 3) {
    const t = tokens[at];
    const w = word(t);
    if (w !== undefined && MONTHS[w] !== undefined && month === undefined) {
      month = MONTHS[w];
    } else if (t?.type === 'number' && !t.ordinal && t.value >= 1000 && t.value <= 9999 && year === undefined) {
      year = t.value;
    } else if (t?.type === 'number' && !t.ordinal && t.value >= 1 && t.value <= 31 && day === undefined) {
      day = t.value;
    } else {
      break;
    }
    parts += 1;
    at += 1;
    if (word(tokens[at]) === '-') at += 1;
    else break;
  }
  if (month === undefined || day === undefined || parts < 2) return undefined;
  // Require at least one '-' join so plain "23 September" stays with the
  // factory month-day rule (which also reads bare numbers after).
  if (at - i === parts) return undefined;
  const date: { year?: number; month: number; day: number } = { month, day };
  if (year !== undefined) date.year = year;
  return { expr: { op: 'literal', date }, consumed: at - i, confidence: 0.9, role: 'date' };
};

/** "November 19-20" — month + joined numeric day range token. */
const deMonthDayRange: Rule = (tokens, i) => {
  const month = MONTHS[word(tokens[i]) ?? ''];
  if (month === undefined) return undefined;
  const w = word(tokens[i + 1]);
  const m = w?.match(/^(\d{1,2})-(\d{1,2})$/);
  if (!m) return undefined;
  const d1 = Number(m[1]);
  const d2 = Number(m[2]);
  if (d1 < 1 || d1 > 31 || d2 < 1 || d2 > 31) return undefined;
  return {
    expr: {
      op: 'between',
      start: { op: 'literal', date: { month, day: d1 } },
      end: { op: 'literal', date: { month, day: d2 } },
    },
    consumed: 2,
    confidence: 0.9,
    role: 'date',
  };
};

/** Slash-joined single tokens: "23/Sep/2020", "2020/Sep/23", "dritter/11",
 * and slash-date ranges "28/2-1/3", "10/1-11/2/2017". */
const deSlashDate: Rule = (tokens, i) => {
  const w = word(tokens[i]);
  if (w === undefined || !w.includes('/')) return undefined;

  // "28/2-1/3" / "10/1-11/2/2017" — DMY on both sides.
  let m = w.match(/^(\d{1,2})\/(\d{1,2})-(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (m) {
    const year = m[5] !== undefined ? (Number(m[5]) < 100 ? 2000 + Number(m[5]) : Number(m[5])) : undefined;
    const start = numericDMY(year !== undefined ? [Number(m[1]), Number(m[2]), year] : [Number(m[1]), Number(m[2])]);
    const end = numericDMY(year !== undefined ? [Number(m[3]), Number(m[4]), year] : [Number(m[3]), Number(m[4])]);
    if (start && end) {
      return {
        expr: {
          op: 'between',
          start: { op: 'literal', date: start },
          end: { op: 'literal', date: end },
        },
        consumed: 1,
        confidence: 0.9,
        role: 'date',
      };
    }
  }

  // "dritter/11" — ordinal day / numeric month.
  m = w.match(/^([a-zäöüß]+)\/(\d{1,2})$/);
  if (m && ORDINALS[m[1]!] !== undefined) {
    const day = ORDINALS[m[1]!]!;
    const month = Number(m[2]);
    if (month >= 1 && month <= 12) {
      return { expr: { op: 'literal', date: { month, day } }, consumed: 1, confidence: 0.9, role: 'date' };
    }
  }

  // Three mixed segments with a month name: "2020/23/Sep", "23/Sep/2020".
  const segs = w.split('/');
  if (segs.length === 3) {
    let month: number | undefined;
    let day: number | undefined;
    let year: number | undefined;
    for (const seg of segs) {
      if (MONTHS[seg] !== undefined && month === undefined) month = MONTHS[seg];
      else if (/^\d{4}$/.test(seg) && year === undefined) year = Number(seg);
      else if (/^\d{1,2}$/.test(seg) && day === undefined && Number(seg) >= 1 && Number(seg) <= 31) day = Number(seg);
      else return undefined;
    }
    if (month !== undefined && day !== undefined && year !== undefined) {
      return {
        expr: { op: 'literal', date: { month, day, year } },
        consumed: 1,
        confidence: 0.9,
        role: 'date',
      };
    }
  }
  return undefined;
};

/** "nächsten Donnerstag bis Samstag" → between(seek, seek). */
const deWeekdayRange: Rule = (tokens, i) => {
  const readWd = (
    at: number,
  ): { dir: 'next' | 'prev' | 'nearest'; weekday: Weekday; end: number } | undefined => {
    let cursor = at;
    while (DE_LEXICON.articles.includes(word(tokens[cursor]) ?? '')) cursor += 1;
    let dir: 'next' | 'prev' | 'nearest' = 'nearest';
    const pm = word(tokens[cursor]);
    if (pm !== undefined && DE_LEXICON.preMods[pm] !== undefined) {
      const delta = DE_LEXICON.preMods[pm]!;
      dir = delta === 1 ? 'next' : delta === -1 ? 'prev' : 'nearest';
      cursor += 1;
    }
    const wd = WEEKDAYS[word(tokens[cursor]) ?? ''];
    if (wd === undefined) return undefined;
    return { dir, weekday: wd, end: cursor + 1 };
  };
  const a = readWd(i);
  if (!a) return undefined;
  if (word(tokens[a.end]) !== 'bis') return undefined;
  const b = readWd(a.end + 1);
  if (!b) return undefined;
  return {
    expr: {
      op: 'between',
      start: { op: 'seek', base: NOW, dir: a.dir, target: { kind: 'weekday', weekday: a.weekday } },
      end: { op: 'seek', base: NOW, dir: 'next', target: { kind: 'weekday', weekday: b.weekday } },
    },
    consumed: b.end - i,
    confidence: 0.95,
    role: 'date',
  };
};

/** "unter der Woche" / "nächste Arbeitswoche" / "letzte werktags" → Mon–Sat. */
const deWorkweek: Rule = (tokens, i) => {
  let at = i;
  let delta = 0;
  if (word(tokens[at]) === 'unter') {
    at += 1;
    while (DE_LEXICON.articles.includes(word(tokens[at]) ?? '')) at += 1;
    if (word(tokens[at]) !== 'woche') return undefined;
    at += 1;
  } else {
    const pm = word(tokens[at]);
    if (pm !== undefined && DE_LEXICON.preMods[pm] !== undefined) {
      delta = DE_LEXICON.preMods[pm]!;
      at += 1;
    }
    const noun = word(tokens[at]);
    if (noun !== 'arbeitswoche' && noun !== 'werktags' && noun !== 'werktage' && noun !== 'werktagen') {
      return undefined;
    }
    at += 1;
  }
  const week: TimeExpr =
    delta === 0
      ? { op: 'snap', base: NOW, unit: 'week' }
      : { op: 'snap', base: { op: 'offset', base: NOW, amount: delta, unit: 'week' }, unit: 'week' };
  return {
    expr: { op: 'span', anchor: week, amount: { days: 5 } },
    consumed: at - i,
    confidence: 0.95,
    role: 'date',
  };
};

/** Half-period adverbs: "Spätabends" 18–20, "Spätnachmittags" 14–16. */
const PERIOD_MODS: Record<string, 'start' | 'end'> = {
  frühmorgens: 'start', früh: 'start',
  spätabend: 'end', spätabends: 'end',
  spätnachmittag: 'end', spätnachmittags: 'end',
};

const MOD_PERIOD_MARKERS = ['am', 'an', 'auf', 'gegen', 'zur', 'zum', 'in', 'der'];

const deModPeriod: Rule = (tokens, i) => {
  let at = i;
  if (MOD_PERIOD_MARKERS.includes(word(tokens[at]) ?? '')) at += 1;
  const w = word(tokens[at]);
  if (w === undefined) return undefined;
  const mod = PERIOD_MODS[w];
  const period = PERIODS[w];
  if (mod === undefined || period === undefined) return undefined;
  return {
    expr: { op: 'literal', dayPeriod: period, mod },
    consumed: at + 1 - i,
    confidence: 0.95,
    role: 'time',
  };
};

/** Plain half-unit amounts (mod start/end would tighten to the reference
 * day, but the imported corpus expects the fixed half). */
const HALF_AMOUNT: Partial<Record<Unit, Record<string, number>>> = {
  year: { months: 6 },
  quarter: { days: 45 },
  month: { days: 15 },
  week: { days: 3 },
  day: { hours: 12 },
};

function unitHalf(unit: Unit, delta: 0 | 1 | -1, half: 'first' | 'second'): TimeExpr | undefined {
  const amount = HALF_AMOUNT[unit];
  if (!amount) return undefined;
  const shifted: TimeExpr = delta === 0 ? NOW : { op: 'offset', base: NOW, amount: delta, unit };
  if (half === 'first') {
    return { op: 'span', anchor: { op: 'snap', base: shifted, unit }, amount };
  }
  const neg = Object.fromEntries(Object.entries(amount).map(([k, v]) => [k, -v]));
  return { op: 'span', anchor: { op: 'snap', base: shifted, unit, edge: 'end' }, amount: neg };
}

/** "Anfang/Mitte/Ende des Monats" → first/middle/last stretch of the unit. */
const deEdge: Rule = (tokens, i) => {
  const w = word(tokens[i]);
  if (w !== 'anfang' && w !== 'mitte' && w !== 'ende') return undefined;
  let at = i + 1;
  while (DE_LEXICON.articles.includes(word(tokens[at]) ?? '') || word(tokens[at]) === 'dieses') at += 1;
  const unit = UNITS[word(tokens[at]) ?? ''];
  if (unit === undefined) return undefined;
  const expr =
    w === 'mitte'
      ? ({ op: 'snap', base: NOW, unit, mod: 'mid' } as TimeExpr)
      : unitHalf(unit, 0, w === 'anfang' ? 'first' : 'second');
  if (!expr) return undefined;
  return { expr, consumed: at + 1 - i, confidence: 0.95, role: 'date' };
};

/** "dieses Jahr später/früher" → the year's second/first half. */
const deModAfter: Rule = (tokens, i) => {
  const pm = word(tokens[i]);
  if (pm === undefined || DE_LEXICON.preMods[pm] === undefined) return undefined;
  const delta = DE_LEXICON.preMods[pm]!;
  const unit = UNITS[word(tokens[i + 1]) ?? ''];
  if (unit === undefined) return undefined;
  const after = word(tokens[i + 2]);
  const half = after === 'später' ? 'second' : after === 'früher' ? 'first' : undefined;
  if (half === undefined) return undefined;
  const expr = unitHalf(unit, delta, half);
  if (!expr) return undefined;
  return { expr, consumed: 3, confidence: 1, role: 'date' };
};

/** "der 25." — bare day-of-month with a mandatory article. */
const deBareDay: Rule = (tokens, i) => {
  let at = i;
  while (DE_LEXICON.articles.includes(word(tokens[at]) ?? '')) at += 1;
  if (at === i) return undefined;
  const t = tokens[at];
  if (t?.type !== 'number' || t.value < 1 || t.value > 31) return undefined;
  // Longer date shapes (day + month …) belong to other rules.
  const next = tokens[at + 1];
  if (next?.type === 'number') return undefined;
  const nw = word(next);
  if (nw !== undefined && (MONTHS[nw] !== undefined || UNITS[nw] !== undefined || nw === 'uhr')) {
    return undefined;
  }
  return {
    expr: { op: 'literal', date: { day: t.value } },
    consumed: at + 1 - i,
    confidence: 0.75,
    role: 'date',
  };
};

/** "in der letzten Woche im Juli" — the last week fully inside the month. */
const deLastWeekOfMonth: Rule = (tokens, i) => {
  let at = i;
  if (word(tokens[at]) === 'in') at += 1;
  while (DE_LEXICON.articles.includes(word(tokens[at]) ?? '')) at += 1;
  const pm = word(tokens[at]);
  if (pm === undefined || DE_LEXICON.preMods[pm] !== -1) return undefined;
  if (word(tokens[at + 1]) !== 'woche') return undefined;
  if (word(tokens[at + 2]) !== 'im' && word(tokens[at + 2]) !== 'von') return undefined;
  const month = MONTHS[word(tokens[at + 3]) ?? ''];
  if (month === undefined) return undefined;
  // Last Monday M with M+7 ≤ month end: seek prev Monday from (end − 6 days).
  return {
    expr: {
      op: 'span',
      anchor: {
        op: 'seek',
        base: {
          op: 'offset',
          base: { op: 'snap', base: { op: 'literal', date: { month } }, unit: 'month', edge: 'end' },
          amount: -6,
          unit: 'day',
        },
        dir: 'prev',
        target: { kind: 'weekday', weekday: 'mon' },
        n: 1,
      },
      amount: { days: 7 },
    },
    consumed: at + 4 - i,
    confidence: 1,
    role: 'date',
  };
};

/** Bare "das Jahr" / "in dem Jahr" / "des Jahres" → the current year. */
const deBareYear: Rule = (tokens, i) => {
  let at = i;
  while (DE_LEXICON.articles.includes(word(tokens[at]) ?? '')) at += 1;
  if (at === i) return undefined; // require an article: bare "Jahr" is too weak
  const w = word(tokens[at]);
  if (w !== 'jahr' && w !== 'jahres') return undefined;
  const nx = tokens[at + 1];
  if (nx?.type === 'number') return undefined; // "im Jahr 2020" → deYearNoun
  return {
    expr: { op: 'snap', base: NOW, unit: 'year' },
    consumed: at + 1 - i,
    confidence: 0.55,
    role: 'date',
  };
};

/** "123,45 sek" / "3,5 Jahre" — the comma splits into two number tokens. */
const UNIT_SECONDS: Record<Unit, number> = {
  second: 1, minute: 60, hour: 3600, day: 86400, week: 604800,
  month: 2592000, quarter: 7776000, year: 31536000,
};

const deDecimalDuration: Rule = (tokens, i) => {
  const a = tokens[i];
  const b = tokens[i + 1];
  if (a?.type !== 'number' || a.ordinal || b?.type !== 'number' || b.ordinal) return undefined;
  const unit = UNITS[word(tokens[i + 2]) ?? ''];
  if (unit === undefined) return undefined;
  const digits = b.end - b.start;
  if (digits > 2 || b.value >= 100) return undefined;
  const value = a.value + b.value / 10 ** digits;
  const seconds = value * UNIT_SECONDS[unit];
  return {
    expr: { op: 'duration', iso: `PT${seconds}S` },
    consumed: 3,
    confidence: 0.85,
    role: 'duration',
  };
};

// --- Holidays ---------------------------------------------------------------

const FIXED_HOLIDAYS: { words: string[]; month: number; day: number }[] = [
  { words: ['neujahr'], month: 1, day: 1 },
  { words: ['heilige', 'drei', 'könige'], month: 1, day: 6 },
  { words: ['weltkindertag'], month: 6, day: 1 },
  { words: ['johannistag'], month: 6, day: 24 },
  { words: ['peter', 'und', 'paul'], month: 6, day: 29 },
  { words: ['augsburger', 'friedensfest'], month: 8, day: 8 },
  { words: ['herbstanfang'], month: 9, day: 22 },
  { words: ['tag', 'der', 'deutschen', 'einheit'], month: 10, day: 3 },
  { words: ['allerheiligen'], month: 11, day: 1 },
  { words: ['allerseelen'], month: 11, day: 2 },
  { words: ['barbaratag'], month: 12, day: 4 },
  { words: ['nikolaus'], month: 12, day: 6 },
  { words: ['heiligabend'], month: 12, day: 24 },
  { words: ['silvester'], month: 12, day: 31 },
];

/** Easter-anchored days as day offsets from Easter Sunday. */
const EASTER_HOLIDAYS: { words: string[]; offset: number }[] = [
  { words: ['rosenmontag'], offset: -48 },
  { words: ['fastnachtssamstag'], offset: -50 },
  { words: ['fastnachtssonntag'], offset: -49 },
  { words: ['aschermittwoch'], offset: -46 },
  { words: ['palmsonntag'], offset: -7 },
  { words: ['karfreitag'], offset: -2 },
  { words: ['karsamstag'], offset: -1 },
  { words: ['ostersonntag'], offset: 0 },
  { words: ['ostern'], offset: 0 },
  { words: ['ostermontag'], offset: 1 },
  { words: ['himmelfahrt'], offset: 39 },
  { words: ['pfingsten'], offset: 49 },
  { words: ['pfingstsonntag'], offset: 49 },
  { words: ['pfingstmontag'], offset: 50 },
  { words: ['fronleichnam'], offset: 60 },
];

/** Weekday-computed holidays (built per optional year). */
const COMPUTED_HOLIDAYS: { words: string[]; build: (year?: number) => TimeExpr }[] = [
  {
    // First Sunday of October.
    words: ['erntedankfest'],
    build: (year) => ({
      op: 'seek',
      base: { op: 'literal', date: year !== undefined ? { month: 10, year } : { month: 10 } },
      dir: 'next',
      target: { kind: 'weekday', weekday: 'sun' },
      n: 1,
    }),
  },
  {
    // Last Sunday before the 1st of Advent (falls on Nov 20–26).
    words: ['ewigkeitssonntag'],
    build: (year) => ({
      op: 'seek',
      base: { op: 'literal', date: year !== undefined ? { month: 11, day: 26, year } : { month: 11, day: 26 } },
      dir: 'prev',
      target: { kind: 'weekday', weekday: 'sun' },
    }),
  },
  {
    words: ['totensonntag'],
    build: (year) => ({
      op: 'seek',
      base: { op: 'literal', date: year !== undefined ? { month: 11, day: 26, year } : { month: 11, day: 26 } },
      dir: 'prev',
      target: { kind: 'weekday', weekday: 'sun' },
    }),
  },
];

function matchWords(tokens: Token[], i: number, words: string[]): number | undefined {
  for (const [k, w] of words.entries()) {
    if (word(tokens[i + k]) !== w) return undefined;
  }
  return i + words.length;
}

/** Optional year qualifier after a holiday name: "2019", "im Jahr 2020",
 * "letzten Jahres", "im nächsten Jahr". */
function readYearQualifier(
  tokens: Token[],
  i: number,
): { year?: number; yearDelta?: -1 | 0 | 1; consumed: number } {
  let at = i;
  if (word(tokens[at]) === 'im') at += 1;
  const pm = word(tokens[at]);
  if (pm !== undefined && DE_LEXICON.preMods[pm] !== undefined) {
    const nx = word(tokens[at + 1]);
    if (nx === 'jahr' || nx === 'jahres' || nx === 'jahre') {
      return { yearDelta: DE_LEXICON.preMods[pm]!, consumed: at + 2 - i };
    }
  }
  if (word(tokens[at]) === 'jahr' || word(tokens[at]) === 'jahre') at += 1;
  const yt = tokens[at];
  if (yt?.type === 'number' && !yt.ordinal && yt.value >= 1000 && yt.value <= 9999) {
    return { year: yt.value, consumed: at + 1 - i };
  }
  return { consumed: 0 };
}

const deHoliday: Rule = (tokens, i) => {
  const finish = (core: TimeExpr, end: number, applyYear: boolean): RuleMatch => {
    const q = readYearQualifier(tokens, end);
    let expr = core;
    let consumed = end - i;
    if (q.yearDelta !== undefined) {
      const yearExpr: TimeExpr =
        q.yearDelta === 0
          ? { op: 'snap', base: NOW, unit: 'year' }
          : { op: 'snap', base: { op: 'offset', base: NOW, amount: q.yearDelta, unit: 'year' }, unit: 'year' };
      expr = { op: 'intersect', parts: [yearExpr, core] };
      consumed += q.consumed;
    } else if (q.year !== undefined && applyYear) {
      consumed += q.consumed;
    }
    return { expr, consumed, confidence: 1, role: 'date' };
  };

  for (const h of FIXED_HOLIDAYS) {
    const end = matchWords(tokens, i, h.words);
    if (end === undefined) continue;
    const q = readYearQualifier(tokens, end);
    const date: { year?: number; month: number; day: number } = { month: h.month, day: h.day };
    if (q.year !== undefined) date.year = q.year;
    const core: TimeExpr = { op: 'literal', date };
    if (q.year !== undefined) {
      return { expr: core, consumed: end + q.consumed - i, confidence: 1, role: 'date' };
    }
    return finish(core, end, false);
  }
  for (const h of EASTER_HOLIDAYS) {
    const end = matchWords(tokens, i, h.words);
    if (end === undefined) continue;
    const q = readYearQualifier(tokens, end);
    const base: TimeExpr =
      q.year !== undefined
        ? { op: 'holiday', name: 'easter', year: q.year }
        : { op: 'holiday', name: 'easter' };
    const core: TimeExpr =
      h.offset === 0 ? base : { op: 'offset', base, amount: h.offset, unit: 'day' };
    if (q.year !== undefined) {
      return { expr: core, consumed: end + q.consumed - i, confidence: 1, role: 'date' };
    }
    return finish(core, end, false);
  }
  for (const h of COMPUTED_HOLIDAYS) {
    const end = matchWords(tokens, i, h.words);
    if (end === undefined) continue;
    const q = readYearQualifier(tokens, end);
    if (q.year !== undefined) {
      return { expr: h.build(q.year), consumed: end + q.consumed - i, confidence: 1, role: 'date' };
    }
    return finish(h.build(), end, false);
  }
  return undefined;
};

const deExtras: { name: string; rule: Rule }[] = [
  { name: 'de-range', rule: deRange },
  { name: 'de-weekday-range', rule: deWeekdayRange },
  { name: 'de-holiday', rule: deHoliday },
  { name: 'de-fraction-clock', rule: deFractionClock },
  { name: 'de-clock', rule: deClock },
  { name: 'de-numdate', rule: deNumDate },
  { name: 'de-word-date', rule: deWordDate },
  { name: 'de-slash-date', rule: deSlashDate },
  { name: 'de-day-month', rule: deDayMonth },
  { name: 'de-two-step', rule: deTwoStep },
  { name: 'de-mod-after', rule: deModAfter },
  { name: 'de-last-week-of-month', rule: deLastWeekOfMonth },
  { name: 'de-bare-day', rule: deBareDay },
  { name: 'de-workweek', rule: deWorkweek },
  { name: 'de-weekday-period', rule: deWeekdayPeriod },
  { name: 'de-year-noun', rule: deYearNoun },
  { name: 'de-bare-year', rule: deBareYear },
  { name: 'de-edge', rule: deEdge },
  { name: 'de-decimal-duration', rule: deDecimalDuration },
  { name: 'de-duration', rule: deDuration },
  { name: 'de-dash-date', rule: deDashDate },
  { name: 'de-month-day-range', rule: deMonthDayRange },
  { name: 'de-mod-period', rule: deModPeriod },
  { name: 'de-bare-period', rule: deBarePeriod },
];

export const DE_RULE_ENTRIES = makeLatinRules(DE_LEXICON, deExtras);

/** Connector words allowed between merged date & time parts. */
export const DE_CONNECTORS: string[] = [
  'um', 'am', 'an', 'im', 'gegen', 'der', 'die', 'das', 'den', 'dem', 'zur', 'auf', '-',
];
