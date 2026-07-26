#!/usr/bin/env node
/**
 * Generate engine-parity fixtures for ports (docs/porting.md).
 *
 * For every corpus case the JS reference implementation can parse, record the
 * language-independent triple (expr, ctx) → resolved candidates. A port's
 * ENGINE is then fully testable against these — no parser or renderer needed
 * first. Regenerate whenever engine semantics legitimately change:
 *   node scripts/generate-ir-fixtures.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

import { TimeContext, parse, resolve } from '../dist/index.js';

const SOURCES = [
  { file: 'corpus/forward/handauthored-en.json', out: 'resolved-hand-en.json' },
  ...['en', 'es', 'fr', 'de', 'ja', 'zh'].map((l) => ({
    file: `corpus/forward/imported-recognizers-${l}.json`,
    out: `resolved-${l}.json`,
  })),
];

mkdirSync(new URL('../corpus/ir/', import.meta.url), { recursive: true });

let total = 0;
for (const src of SOURCES) {
  const { cases } = JSON.parse(readFileSync(new URL(`../${src.file}`, import.meta.url), 'utf8'));
  const out = [];
  for (const c of cases) {
    let ctx;
    try {
      ctx = TimeContext.make(c.ctx);
    } catch {
      continue;
    }
    const match = parse(c.text, ctx).matches[0];
    if (!match) continue;
    let candidates;
    try {
      candidates = resolve(match.expr, ctx).candidates;
    } catch {
      continue;
    }
    out.push({
      id: c.id,
      ctx: c.ctx,
      expr: match.expr,
      candidates: candidates.map((v) =>
        v.kind === 'interval'
          ? { kind: 'interval', start: v.start.toString(), end: v.end.toString(), grain: v.grain }
          : v,
      ),
    });
  }
  writeFileSync(
    new URL(`../corpus/ir/${src.out}`, import.meta.url),
    JSON.stringify(
      {
        description:
          'MACHINE-GENERATED engine-parity fixtures: (expr, ctx) → candidates from the JS reference implementation. Ports must reproduce candidates exactly (values, grains, order). Regenerate with scripts/generate-ir-fixtures.mjs; never hand-edit.',
        source: src.file,
        cases: out,
      },
      null,
      1,
    ) + '\n',
  );
  console.log(`${src.out}: ${out.length} fixtures`);
  total += out.length;
}
console.log(`total: ${total}`);
