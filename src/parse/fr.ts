/**
 * French rules — STARTER. Lexicon for the Latin factory; being filled in
 * against corpus/forward/imported-recognizers-fr.json (issue #13).
 */
import { makeLatinRules, type LatinLexicon } from './latin.js';

export const FR_LEXICON: LatinLexicon = {
  articles: [],
  units: {},
  weekdays: {},
  months: {},
  periods: {},
  smallNumbers: {},
  deictic: {},
  preMods: {},
  postMods: {},
  agoPrefixes: [],
  inPrefixes: [],
  lastNAdjs: [],
  nextNAdjs: [],
  atPhrases: [],
  periodMarkers: [],
  dateSep: [],
  weekendPhrases: [],
};

export const FR_RULE_ENTRIES = makeLatinRules(FR_LEXICON);
export const FR_CONNECTORS: string[] = ['-'];
