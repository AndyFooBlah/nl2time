/**
 * Chinese rules — STARTER. CJK text arrives as per-character word tokens
 * (see tokenizer); rules match character sequences. Being filled in against
 * corpus/forward/imported-recognizers-zh.json (issue #13).
 */
import type { Rule } from './en.js';

export const ZH_RULE_ENTRIES: readonly { name: string; rule: Rule }[] = [];
export const ZH_CONNECTORS: string[] = [];
