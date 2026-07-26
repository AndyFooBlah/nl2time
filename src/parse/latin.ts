/**
 * Parameterized rule factory for Latin-script languages (Spanish, French,
 * German, …). A LatinLexicon supplies the vocabulary; the factory supplies
 * the grammar patterns these languages share:
 *
 *   deictic days        hoy / hier / übermorgen
 *   rel + unit          la semana pasada · nächste Woche · le mois dernier
 *   rel + weekday       el próximo martes · letzten Montag
 *   ago / in            hace 3 días · il y a 3 jours · vor 3 Tagen · in 3 Tagen
 *   last/next N units   los últimos 3 días · les 3 derniers jours
 *   month-day dates     15 de marzo de 2026 · 15. März 2026 · le 15 mars
 *   day periods         por la mañana · le matin · am Abend
 *   clock times         a las 15:30 · à 15h30 (via extras) · um 15 Uhr
 *   weekend             el fin de semana · le week-end · das Wochenende
 *
 * Modifier placement is handled on both sides of the noun (Romance languages
 * postpose: "semana pasada"). Language-specific oddities go in `extras`,
 * which run before the factory rules.
 */
import type { DayPeriod, TimeExpr, Unit, Weekday } from '../ir/types.js';
import type { Rule } from './en.js';
import type { Token } from './tokenizer.js';

export interface LatinLexicon {
  /** Articles / filler tokens skippable inside phrases (el, la, le, der, die…). */
  articles: string[];
  units: Record<string, Unit>;
  weekdays: Record<string, Weekday>;
  months: Record<string, number>;
  /** Day-period nouns. Words also used deictically (Spanish "mañana") must be
   * listed here AND in `deictic`; bare uses read as the deictic. */
  periods: Record<string, DayPeriod>;
  smallNumbers: Record<string, number>;
  /** Single-word deictics: hoy 0, ayer −1, mañana +1, anteayer −2, vorgestern −2… */
  deictic: Record<string, number>;
  /** Multi-word deictics: "pasado mañana" +2. */
  deicticPhrases?: { words: string[]; delta: number }[];
  /** Modifiers before the noun: próximo +1, este 0, letzte −1. */
  preMods: Record<string, -1 | 0 | 1>;
  /** Modifiers after the noun: pasada −1, dernier −1, prochain +1. */
  postMods: Record<string, -1 | 0 | 1>;
  /** Multi-word post-modifiers: "que viene" +1. */
  postModPhrases?: { words: string[]; delta: -1 | 0 | 1 }[];
  /** "ago" marker phrases that PRECEDE the amount: hace, il y a, vor. */
  agoPrefixes: string[][];
  /** "in/within" marker phrases: en, dans, in, dentro de. */
  inPrefixes: string[][];
  /** Plural adjectives for "last N units": últimos, derniers, letzten. */
  lastNAdjs: string[];
  /** Plural adjectives for "next N units": próximos, prochains, nächsten. */
  nextNAdjs: string[];
  /** Clock-time lead-ins licensing a bare hour: a las, à, um. */
  atPhrases: string[][];
  /** Period markers before a period noun: por la, de la, am, le. */
  periodMarkers: string[][];
  /** Word(s) linking day-month-year: de ("15 de marzo de 2026"). Empty for German. */
  dateSep: string[];
  /** Weekend noun phrase: fin de semana, week-end, wochenende. */
  weekendPhrases: string[][];
  /** Special single/multi-word datetimes: anoche → yesterday∩night. */
  specialPhrases?: { words: string[]; expr: TimeExpr; role?: 'date' | 'time' | 'datetime' }[];
  /** noon / midnight words. */
  noonWords?: string[];
  midnightWords?: string[];
}

const NOW: TimeExpr = { op: 'now' };

function snapNow(unit: Unit): TimeExpr {
  return { op: 'snap', base: NOW, unit };
}

function snapOffset(amount: number, unit: Unit): TimeExpr {
  return { op: 'snap', base: { op: 'offset', base: NOW, amount, unit }, unit };
}

function amountFor(unit: Unit, n: number): Record<string, number> {
  return unit === 'quarter' ? { months: 3 * n } : { [`${unit}s`]: n };
}

function word(t: Token | undefined): string | undefined {
  return t?.type === 'word' ? t.value : undefined;
}

export function makeLatinRules(
  lex: LatinLexicon,
  extras: { name: string; rule: Rule }[] = [],
): { name: string; rule: Rule }[] {
  const isArticle = (w: string | undefined): boolean => w !== undefined && lex.articles.includes(w);

  /** Skip leading articles; returns first non-article index. */
  const skipArticles = (tokens: Token[], i: number): number => {
    let at = i;
    while (isArticle(word(tokens[at]))) at += 1;
    return at;
  };

  const matchPhrase = (tokens: Token[], i: number, words: string[]): number | undefined => {
    for (const [k, w] of words.entries()) {
      if (word(tokens[i + k]) !== w) return undefined;
    }
    return i + words.length;
  };

  const readNum = (tokens: Token[], i: number): { value: number; consumed: number } | undefined => {
    const t = tokens[i];
    if (t?.type === 'number' && !t.ordinal) return { value: t.value, consumed: 1 };
    if (t?.type === 'number' && t.ordinal) return { value: t.value, consumed: 1 };
    const w = word(t);
    if (w !== undefined && lex.smallNumbers[w] !== undefined) {
      return { value: lex.smallNumbers[w]!, consumed: 1 };
    }
    return undefined;
  };

  const yearAt = (tokens: Token[], i: number): number | undefined => {
    const t = tokens[i];
    return t?.type === 'number' && !t.ordinal && t.value >= 1000 && t.value <= 9999 ? t.value : undefined;
  };

  const subDay = (unit: Unit): boolean => unit === 'second' || unit === 'minute' || unit === 'hour';

  const relExpr = (delta: -1 | 0 | 1, unit: Unit): TimeExpr => {
    if (subDay(unit)) {
      return delta === 0
        ? snapNow(unit)
        : { op: 'span', anchor: NOW, amount: amountFor(unit, delta) };
    }
    return delta === 0 ? snapNow(unit) : snapOffset(delta, unit);
  };

  const specials: Rule = (tokens, i) => {
    for (const s of lex.specialPhrases ?? []) {
      const end = matchPhrase(tokens, i, s.words);
      if (end !== undefined) {
        return { expr: s.expr, consumed: end - i, confidence: 1, role: s.role ?? 'datetime' };
      }
    }
    return undefined;
  };

  const deictic: Rule = (tokens, i) => {
    for (const p of lex.deicticPhrases ?? []) {
      const end = matchPhrase(tokens, i, p.words);
      if (end !== undefined) {
        return { expr: snapOffset(p.delta, 'day'), consumed: end - i, confidence: 1, role: 'date' };
      }
    }
    const w = word(tokens[i]);
    if (w !== undefined && lex.deictic[w] !== undefined) {
      const delta = lex.deictic[w]!;
      return {
        expr: delta === 0 ? snapNow('day') : snapOffset(delta, 'day'),
        consumed: 1,
        confidence: 1,
        role: 'date',
      };
    }
    return undefined;
  };

  /** [article]* (preMod noun | noun postMod) for unit / weekday / period / weekend nouns. */
  const relNoun: Rule = (tokens, i) => {
    const at = skipArticles(tokens, i);
    if (at !== i && at === i + 2) return undefined; // at most one article
    const w0 = word(tokens[at]);
    if (w0 === undefined) return undefined;

    const readPost = (
      nounEnd: number,
    ): { delta: -1 | 0 | 1; end: number } | undefined => {
      const pw = word(tokens[nounEnd]);
      if (pw !== undefined && lex.postMods[pw] !== undefined) {
        return { delta: lex.postMods[pw]!, end: nounEnd + 1 };
      }
      for (const p of lex.postModPhrases ?? []) {
        const end = matchPhrase(tokens, nounEnd, p.words);
        if (end !== undefined) return { delta: p.delta, end };
      }
      return undefined;
    };

    const buildFor = (
      delta: -1 | 0 | 1,
      nounWord: string,
      start: number,
      end: number,
    ): ReturnType<Rule> => {
      const unit = lex.units[nounWord];
      if (unit !== undefined) {
        return { expr: relExpr(delta, unit), consumed: end - i, confidence: 1, role: 'date' };
      }
      const weekday = lex.weekdays[nounWord];
      if (weekday !== undefined) {
        const dir = delta === -1 ? 'prev' : delta === 1 ? 'next' : 'nearest';
        return {
          expr: { op: 'seek', base: NOW, dir, target: { kind: 'weekday', weekday } },
          consumed: end - i,
          confidence: 1,
          role: 'date',
        };
      }
      const period = lex.periods[nounWord];
      if (period !== undefined && lex.deictic[nounWord] === undefined) {
        const dayExpr = delta === 0 ? snapNow('day') : snapOffset(delta, 'day');
        return {
          expr: { op: 'intersect', parts: [dayExpr, { op: 'literal', dayPeriod: period }] },
          consumed: end - i,
          confidence: 1,
          role: 'datetime',
        };
      }
      for (const wp of lex.weekendPhrases) {
        if (matchPhrase(tokens, start, wp) === end || matchPhrase(tokens, start, wp) !== undefined) {
          const dir = delta === -1 ? 'prev' : delta === 1 ? 'next' : 'nearest';
          return {
            expr: {
              op: 'span',
              anchor: { op: 'seek', base: NOW, dir, target: { kind: 'weekday', weekday: 'sat' } },
              amount: { days: 2 },
            },
            consumed: (matchPhrase(tokens, start, wp) ?? end) - i,
            confidence: 1,
            role: 'date',
          };
        }
      }
      return undefined;
    };

    // preMod + noun (incl. weekend phrase)
    if (lex.preMods[w0] !== undefined) {
      const delta = lex.preMods[w0]!;
      const nounAt = skipArticles(tokens, at + 1);
      const nw = word(tokens[nounAt]);
      if (nw !== undefined) {
        for (const wp of lex.weekendPhrases) {
          const end = matchPhrase(tokens, nounAt, wp);
          if (end !== undefined) {
            const dir = delta === -1 ? 'prev' : delta === 1 ? 'next' : 'nearest';
            return {
              expr: {
                op: 'span',
                anchor: { op: 'seek', base: NOW, dir, target: { kind: 'weekday', weekday: 'sat' } },
                amount: { days: 2 },
              },
              consumed: end - i,
              confidence: 1,
              role: 'date',
            };
          }
        }
        const built = buildFor(delta, nw, nounAt, nounAt + 1);
        if (built) return built;
      }
      return undefined;
    }

    // noun + postMod
    const post = readPost(at + 1);
    if (post) {
      const built = buildFor(post.delta, w0, at, post.end);
      if (built) return built;
    }
    // weekend phrase (bare or postmodified)
    for (const wp of lex.weekendPhrases) {
      const end = matchPhrase(tokens, at, wp);
      if (end !== undefined) {
        const post2 = readPost(end);
        const delta = post2 ? post2.delta : 0;
        const dir = delta === -1 ? 'prev' : delta === 1 ? 'next' : 'nearest';
        return {
          expr: {
            op: 'span',
            anchor: { op: 'seek', base: NOW, dir, target: { kind: 'weekday', weekday: 'sat' } },
            amount: { days: 2 },
          },
          consumed: (post2 ? post2.end : end) - i,
          confidence: 0.9,
          role: 'date',
        };
      }
    }
    return undefined;
  };

  /** Bare weekday (with optional article): "el martes" → nearest dual. */
  const bareWeekday: Rule = (tokens, i) => {
    const at = skipArticles(tokens, i);
    const w = word(tokens[at]);
    const weekday = w !== undefined ? lex.weekdays[w] : undefined;
    if (!weekday) return undefined;
    // A following postmod belongs to relNoun.
    const pw = word(tokens[at + 1]);
    if (pw !== undefined && lex.postMods[pw] !== undefined) return undefined;
    return {
      expr: { op: 'seek', base: NOW, dir: 'nearest', target: { kind: 'weekday', weekday } },
      consumed: at + 1 - i,
      confidence: 0.9,
      role: 'date',
    };
  };

  /** "hace 3 días" / "il y a 3 jours" / "vor 3 Tagen" → past offset. */
  const agoRule: Rule = (tokens, i) => {
    for (const prefix of lex.agoPrefixes) {
      const numAt = matchPhrase(tokens, i, prefix);
      if (numAt === undefined) continue;
      const n = readNum(tokens, numAt);
      if (!n) continue;
      const unit = lex.units[word(tokens[numAt + n.consumed]) ?? ''];
      if (!unit) continue;
      const shifted: TimeExpr = { op: 'offset', base: NOW, amount: -n.value, unit };
      return {
        expr: subDay(unit) ? shifted : { op: 'snap', base: shifted, unit: 'day' },
        consumed: numAt + n.consumed + 1 - i,
        confidence: 1,
        role: 'datetime',
      };
    }
    return undefined;
  };

  /** "en 3 días" / "dans 3 jours" / "in 3 Tagen" → future offset. */
  const inRule: Rule = (tokens, i) => {
    for (const prefix of lex.inPrefixes) {
      const numAt = matchPhrase(tokens, i, prefix);
      if (numAt === undefined) continue;
      const n = readNum(tokens, numAt);
      if (!n) continue;
      const unit = lex.units[word(tokens[numAt + n.consumed]) ?? ''];
      if (!unit) continue;
      const shifted: TimeExpr = { op: 'offset', base: NOW, amount: n.value, unit };
      return {
        expr: subDay(unit) ? shifted : { op: 'snap', base: shifted, unit: 'day' },
        consumed: numAt + n.consumed + 1 - i,
        confidence: 1,
        role: 'datetime',
      };
    }
    return undefined;
  };

  /** "[los] últimos 3 días" / "les 3 derniers jours" → span. */
  const lastNextN: Rule = (tokens, i) => {
    const at = skipArticles(tokens, i);
    const tryOrder = (adjFirst: boolean): ReturnType<Rule> => {
      let cursor = at;
      let sign: 1 | -1 | undefined;
      const readAdj = (): boolean => {
        const w = word(tokens[cursor]);
        if (w !== undefined && lex.lastNAdjs.includes(w)) {
          sign = -1;
          cursor += 1;
          return true;
        }
        if (w !== undefined && lex.nextNAdjs.includes(w)) {
          sign = 1;
          cursor += 1;
          return true;
        }
        return false;
      };
      if (adjFirst && !readAdj()) return undefined;
      const n = readNum(tokens, cursor);
      if (!n) return undefined;
      cursor += n.consumed;
      if (!adjFirst && !readAdj()) return undefined;
      const unit = lex.units[word(tokens[cursor]) ?? ''];
      if (!unit || sign === undefined) return undefined;
      return {
        expr: { op: 'span', anchor: NOW, amount: amountFor(unit, sign * n.value) },
        consumed: cursor + 1 - i,
        confidence: 1,
        role: 'date',
      };
    };
    return tryOrder(true) ?? tryOrder(false);
  };

  /** "15 de marzo [de 2026]" / "15. März [2026]" / "marzo de 2026". */
  const monthDay: Rule = (tokens, i) => {
    const at = skipArticles(tokens, i);
    const sep = (k: number): number => {
      let c = k;
      while (lex.dateSep.includes(word(tokens[c]) ?? '')) c += 1;
      return c;
    };
    const dayTok = tokens[at];
    if (dayTok?.type === 'number' && dayTok.value >= 1 && dayTok.value <= 31) {
      const mAt = sep(at + 1);
      const month = lex.months[word(tokens[mAt]) ?? ''];
      if (month !== undefined) {
        const yAt = sep(mAt + 1);
        const year = yearAt(tokens, yAt);
        const date: { month: number; day: number; year?: number } = { month, day: dayTok.value };
        if (year !== undefined) date.year = year;
        return {
          expr: { op: 'literal', date },
          consumed: (year !== undefined ? yAt + 1 : mAt + 1) - i,
          confidence: 1,
          role: 'date',
        };
      }
    }
    const month0 = lex.months[word(tokens[at]) ?? ''];
    if (month0 !== undefined) {
      const yAt = sep(at + 1);
      const year = yearAt(tokens, yAt);
      if (year !== undefined) {
        return {
          expr: { op: 'literal', date: { month: month0, year } },
          consumed: yAt + 1 - i,
          confidence: 1,
          role: 'date',
        };
      }
      return {
        expr: { op: 'literal', date: { month: month0 } },
        consumed: at + 1 - i,
        confidence: 0.8,
        role: 'date',
      };
    }
    return undefined;
  };

  /** "por la mañana" / "le matin" / "am Abend" → period literal (merges with dates). */
  const periodMarker: Rule = (tokens, i) => {
    for (const marker of lex.periodMarkers) {
      const pAt = matchPhrase(tokens, i, marker);
      if (pAt === undefined) continue;
      const w = word(tokens[pAt]);
      const period = w !== undefined ? lex.periods[w] : undefined;
      if (period !== undefined) {
        return {
          expr: { op: 'literal', dayPeriod: period },
          consumed: pAt + 1 - i,
          confidence: 0.9,
          role: 'time',
        };
      }
    }
    // Bare period noun (only when unambiguous — not a deictic word).
    const at = skipArticles(tokens, i);
    const w = word(tokens[at]);
    const period = w !== undefined ? lex.periods[w] : undefined;
    if (period !== undefined && lex.deictic[w!] === undefined && at > i) {
      return { expr: { op: 'literal', dayPeriod: period }, consumed: at + 1 - i, confidence: 0.6, role: 'time' };
    }
    return undefined;
  };

  /** "a las 3" / "à 15" / "um 15" (+ noon/midnight words). */
  const clockLead: Rule = (tokens, i) => {
    const w = word(tokens[i]);
    if (w !== undefined && (lex.noonWords ?? []).includes(w)) {
      return { expr: { op: 'literal', time: { hour: 12, meridiem: 'pm' } }, consumed: 1, confidence: 1, role: 'time' };
    }
    if (w !== undefined && (lex.midnightWords ?? []).includes(w)) {
      return { expr: { op: 'literal', time: { hour: 12, meridiem: 'am' } }, consumed: 1, confidence: 1, role: 'time' };
    }
    for (const at of lex.atPhrases) {
      const hAt = matchPhrase(tokens, i, at);
      if (hAt === undefined) continue;
      const t = tokens[hAt];
      if (t?.type === 'clock') {
        const time: { hour: number; minute?: number; meridiem?: 'am' | 'pm' | 'unknown' } = { hour: t.hour };
        if (t.explicitMinute) time.minute = t.minute;
        if (t.meridiem) time.meridiem = t.meridiem;
        else if (t.hour <= 12) time.meridiem = 'unknown';
        return { expr: { op: 'literal', time }, consumed: hAt + 1 - i, confidence: 1, role: 'time' };
      }
      if (t?.type === 'number' && !t.ordinal && t.value >= 0 && t.value <= 23) {
        const time: { hour: number; meridiem?: 'am' | 'pm' | 'unknown' } = { hour: t.value };
        if (t.value <= 12) time.meridiem = 'unknown';
        return { expr: { op: 'literal', time }, consumed: hAt + 1 - i, confidence: 0.95, role: 'time' };
      }
    }
    return undefined;
  };

  return [
    ...extras,
    { name: 'special', rule: specials },
    { name: 'deictic-day', rule: deictic },
    { name: 'ago', rule: agoRule },
    { name: 'in-n', rule: inRule },
    { name: 'last-next-n', rule: lastNextN },
    { name: 'rel-noun', rule: relNoun },
    { name: 'month-day', rule: monthDay },
    { name: 'clock-lead', rule: clockLead },
    { name: 'period-marker', rule: periodMarker },
    { name: 'bare-weekday', rule: bareWeekday },
  ];
}
