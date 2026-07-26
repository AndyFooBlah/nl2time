/**
 * German rules — STARTER. Lexicon for the Latin factory; being filled in
 * against corpus/forward/imported-recognizers-de.json (issue #13).
 */
import { makeLatinRules, type LatinLexicon } from './latin.js';

export const DE_LEXICON: LatinLexicon = {
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

export const DE_RULE_ENTRIES = makeLatinRules(DE_LEXICON);
export const DE_CONNECTORS: string[] = ['-'];
