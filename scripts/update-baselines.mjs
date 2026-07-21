#!/usr/bin/env node
/**
 * Re-run the imported forward corpus and record which case ids currently pass.
 * The baseline is the CI regression gate: every id listed must keep passing
 * (test/corpus.test.ts); newly-passing cases are promoted by re-running this
 * script (`npm run baselines`).
 */
import { readFileSync, writeFileSync } from 'node:fs';

import { runForwardCase } from '../dist/corpus/runner.js';

const corpusUrl = new URL('../corpus/forward/imported-recognizers-en.json', import.meta.url);
const { cases } = JSON.parse(readFileSync(corpusUrl, 'utf8'));

const passing = [];
const failing = [];
for (const c of cases) {
  const r = runForwardCase(c);
  (r.pass ? passing : failing).push(r.id);
}

const baseline = {
  corpus: 'forward/imported-recognizers-en.json',
  total: cases.length,
  passing: passing.length,
  passingIds: passing,
};
writeFileSync(
  new URL('../corpus/baselines/forward-imported.json', import.meta.url),
  JSON.stringify(baseline, null, 1) + '\n',
);
console.log(`baseline: ${passing.length}/${cases.length} imported cases pass (${((100 * passing.length) / cases.length).toFixed(1)}%)`);
