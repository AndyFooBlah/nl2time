#!/usr/bin/env node
/**
 * Corpus evaluation report: pass rates per corpus and per tag, plus baseline
 * regressions. Reporting only — CI gating lives in test/corpus.test.ts.
 */
import { readFileSync } from 'node:fs';

import { runForwardCase, runReverseCase } from '../dist/corpus/runner.js';

function load(rel) {
  return JSON.parse(readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8'));
}

function report(name, outcomes, cases) {
  const pass = outcomes.filter((o) => o.pass).length;
  console.log(`\n${name}: ${pass}/${outcomes.length} (${((100 * pass) / outcomes.length).toFixed(1)}%)`);
  const byTag = new Map();
  for (const [i, o] of outcomes.entries()) {
    for (const t of cases[i].tags ?? []) {
      const s = byTag.get(t) ?? { pass: 0, total: 0 };
      s.total += 1;
      if (o.pass) s.pass += 1;
      byTag.set(t, s);
    }
  }
  for (const [tag, s] of [...byTag.entries()].sort()) {
    console.log(`  ${tag.padEnd(22)} ${s.pass}/${s.total}`);
  }
  return pass;
}

const hand = load('corpus/forward/handauthored-en.json').cases;
report('forward/handauthored-en (core)', hand.map(runForwardCase), hand);

const rev = load('corpus/reverse/golden-en.json');
const revCases = rev.cases.map((c) => ({ ...c, ctx: { ...rev.defaults, ...c.ctx } }));
const revOutcomes = revCases.map(runReverseCase);
report('reverse/golden-en (core)', revOutcomes, revCases);
for (const o of revOutcomes.filter((o) => !o.pass)) console.log(`  FAIL ${o.id}: ${o.detail}`);

const imported = load('corpus/forward/imported-recognizers-en.json').cases;
const impOutcomes = imported.map(runForwardCase);
report('forward/imported-recognizers-en (aspirational)', impOutcomes, imported);

const baseline = load('corpus/baselines/forward-imported.json');
const passingNow = new Set(impOutcomes.filter((o) => o.pass).map((o) => o.id));
const regressions = baseline.passingIds.filter((id) => !passingNow.has(id));
if (regressions.length) {
  console.log(`\nREGRESSIONS vs baseline (${regressions.length}):`, regressions.slice(0, 20).join(', '));
  process.exitCode = 1;
} else {
  const newly = passingNow.size - baseline.passing;
  console.log(`\nno baseline regressions${newly > 0 ? `; ${newly} newly passing (run npm run baselines to promote)` : ''}`);
}
