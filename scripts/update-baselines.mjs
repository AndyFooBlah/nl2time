#!/usr/bin/env node
/**
 * Re-run each language's imported forward corpus and record which case ids
 * currently pass. Baselines are the CI regression gate (test/corpus.test.ts);
 * newly-passing cases are promoted by re-running this script.
 */
import { readFileSync, writeFileSync } from 'node:fs';

import { runForwardCase } from '../dist/corpus/runner.js';

const ALL_LANGS = ['en', 'es', 'fr', 'de', 'ja', 'zh'];
// Optional arg restricts to one language: `node scripts/update-baselines.mjs fr`
const LANGS = process.argv[2] ? [process.argv[2]] : ALL_LANGS;

for (const lang of LANGS) {
  const corpusRel = `corpus/forward/imported-recognizers-${lang}.json`;
  const { cases } = JSON.parse(readFileSync(new URL(`../${corpusRel}`, import.meta.url), 'utf8'));
  const passing = [];
  for (const c of cases) {
    if (runForwardCase(c).pass) passing.push(c.id);
  }
  const baselineName = lang === 'en' ? 'forward-imported.json' : `forward-imported-${lang}.json`;
  writeFileSync(
    new URL(`../corpus/baselines/${baselineName}`, import.meta.url),
    JSON.stringify({ corpus: corpusRel, total: cases.length, passing: passing.length, passingIds: passing }, null, 1) + '\n',
  );
  console.log(`${lang}: ${passing.length}/${cases.length} (${((100 * passing.length) / cases.length).toFixed(1)}%)`);
}
