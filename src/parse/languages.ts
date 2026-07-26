/**
 * Language registry: rule sets and merge connectors per BCP-47 language.
 * Unknown languages fall back to English. Adding a language = a rules module
 * (Latin-factory lexicon or bespoke rules for non-Latin scripts) plus its
 * imported corpus + baseline (docs/evals.md, issue #13).
 */
import { EN_RULE_ENTRIES, type Rule } from './en.js';
import { ES_CONNECTORS, ES_RULE_ENTRIES } from './es.js';
import { FR_CONNECTORS, FR_RULE_ENTRIES } from './fr.js';
import { DE_CONNECTORS, DE_RULE_ENTRIES } from './de.js';
import { JA_CONNECTORS, JA_RULE_ENTRIES } from './ja.js';
import { ZH_CONNECTORS, ZH_RULE_ENTRIES } from './zh.js';

export interface LanguageDef {
  ruleEntries: readonly { name: string; rule: Rule }[];
  /** Words transparent between a date part and a time part when merging. */
  connectors: readonly string[];
}

const EN_CONNECTORS = ['at', 'on', 'in', 'of', 'the', 'for', 'from', 'around', 'about', '-'];

const REGISTRY: Record<string, LanguageDef> = {
  en: { ruleEntries: EN_RULE_ENTRIES, connectors: EN_CONNECTORS },
  es: { ruleEntries: ES_RULE_ENTRIES, connectors: ES_CONNECTORS },
  fr: { ruleEntries: FR_RULE_ENTRIES, connectors: FR_CONNECTORS },
  de: { ruleEntries: DE_RULE_ENTRIES, connectors: DE_CONNECTORS },
  ja: { ruleEntries: JA_RULE_ENTRIES, connectors: JA_CONNECTORS },
  zh: { ruleEntries: ZH_RULE_ENTRIES, connectors: ZH_CONNECTORS },
};

export function languageDef(language: string): LanguageDef {
  return REGISTRY[language] ?? REGISTRY['en']!;
}

export const SUPPORTED_LANGUAGES = Object.keys(REGISTRY);
