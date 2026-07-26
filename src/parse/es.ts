/**
 * Spanish rules: lexicon for the Latin factory plus language-specific extras.
 * Corpus: corpus/forward/imported-recognizers-es.json (climb with
 * `npm run baselines`).
 */
import type { TimeExpr } from '../ir/types.js';
import type { Rule } from './en.js';
import { makeLatinRules, type LatinLexicon } from './latin.js';

const NOW: TimeExpr = { op: 'now' };

export const ES_LEXICON: LatinLexicon = {
  articles: ['el', 'la', 'los', 'las', 'lo', 'un', 'una'],
  units: {
    segundo: 'second', segundos: 'second',
    minuto: 'minute', minutos: 'minute',
    hora: 'hour', horas: 'hour',
    día: 'day', días: 'day', dia: 'day', dias: 'day',
    semana: 'week', semanas: 'week',
    mes: 'month', meses: 'month',
    trimestre: 'quarter', trimestres: 'quarter',
    año: 'year', años: 'year', ano: 'year', anos: 'year',
  },
  weekdays: {
    lunes: 'mon', martes: 'tue', miércoles: 'wed', miercoles: 'wed',
    jueves: 'thu', viernes: 'fri', sábado: 'sat', sabado: 'sat', domingo: 'sun',
  },
  months: {
    enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
    julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10,
    noviembre: 11, diciembre: 12,
  },
  periods: {
    mañana: 'morning', manana: 'morning',
    tarde: 'afternoon',
    noche: 'night',
    madrugada: 'night',
  },
  smallNumbers: {
    un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6,
    siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, quince: 15,
    veinte: 20, treinta: 30,
  },
  deictic: { hoy: 0, ayer: -1, 'mañana': 1, manana: 1, anteayer: -2 },
  deicticPhrases: [{ words: ['pasado', 'mañana'], delta: 2 }],
  preMods: {
    próximo: 1, proximo: 1, próxima: 1, proxima: 1,
    este: 0, esta: 0,
    último: -1, ultimo: -1, última: -1, ultima: -1,
  },
  postMods: {
    pasado: -1, pasada: -1,
    anterior: -1,
    próximo: 1, proximo: 1, próxima: 1, proxima: 1,
    siguiente: 1,
  },
  postModPhrases: [{ words: ['que', 'viene'], delta: 1 }],
  agoPrefixes: [['hace']],
  inPrefixes: [['dentro', 'de'], ['en']],
  lastNAdjs: ['últimos', 'ultimos', 'últimas', 'ultimas', 'pasados', 'pasadas'],
  nextNAdjs: ['próximos', 'proximos', 'próximas', 'proximas', 'siguientes'],
  atPhrases: [['a', 'las'], ['a', 'la'], ['hacia', 'las']],
  periodMarkers: [['por', 'la'], ['de', 'la'], ['en', 'la'], ['por', 'el'], ['a', 'la']],
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
    {
      // "esta noche" is handled by rel-noun, but "esta madrugada" reads better
      // as the small hours of today.
      words: ['ahora', 'mismo'],
      expr: NOW,
      role: 'datetime',
    },
    { words: ['ahora'], expr: NOW, role: 'datetime' },
  ],
  noonWords: ['mediodía', 'mediodia'],
  midnightWords: ['medianoche'],
};

/** Spanish extras: "el 15" (bare day with article), "a las 3 y media". */
const esExtras: { name: string; rule: Rule }[] = [
  {
    name: 'es-bare-day',
    rule: (tokens, i) => {
      // "el 15" — article + day number, common for dates within the month.
      const art = tokens[i];
      if (art?.type !== 'word' || art.value !== 'el') return undefined;
      const n = tokens[i + 1];
      if (n?.type !== 'number' || n.ordinal || n.value < 1 || n.value > 31) return undefined;
      // Don't swallow "el 15 de marzo" — month-day handles that with priority
      // via longer match; this fires only when nothing follows.
      const next = tokens[i + 2];
      if (next?.type === 'word' && ['de', 'del'].includes(next.value)) return undefined;
      return {
        expr: { op: 'literal', date: { day: n.value } },
        consumed: 2,
        confidence: 0.8,
        role: 'date',
      };
    },
  },
  {
    name: 'es-media-cuarto',
    rule: (tokens, i) => {
      // "las 3 y media" / "las 3 y cuarto" — half/quarter past.
      const n = tokens[i];
      if (n?.type !== 'number' || n.value < 1 || n.value > 12) return undefined;
      if (tokens[i + 1]?.type !== 'word' || (tokens[i + 1] as { value: string }).value !== 'y') return undefined;
      const frac = tokens[i + 2];
      if (frac?.type !== 'word') return undefined;
      const minute = frac.value === 'media' ? 30 : frac.value === 'cuarto' ? 15 : undefined;
      if (minute === undefined) return undefined;
      return {
        expr: { op: 'literal', time: { hour: n.value, minute, meridiem: 'unknown' } },
        consumed: 3,
        confidence: 0.95,
        role: 'time',
      };
    },
  },
];

export const ES_RULE_ENTRIES = makeLatinRules(ES_LEXICON, esExtras);

/** Connector words allowed between merged date & time parts. */
export const ES_CONNECTORS = ['a', 'las', 'la', 'el', 'de', 'del', 'por', 'en', '-'];
