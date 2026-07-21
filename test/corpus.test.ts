/**
 * Corpus gating for CI:
 *  - every `core` forward and reverse case must pass;
 *  - every imported case in the recorded baseline must keep passing.
 * Full pass-rate reporting: `npm run eval`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe as suite, expect, test } from 'vitest';

import {
  runForwardCase,
  runReverseCase,
  type ForwardCase,
  type ReverseCase,
} from '../src/corpus/runner.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function load<T>(rel: string): T {
  return JSON.parse(readFileSync(join(root, rel), 'utf8')) as T;
}

suite('corpus: forward hand-authored (core)', () => {
  const { cases } = load<{ cases: ForwardCase[] }>('corpus/forward/handauthored-en.json');
  for (const c of cases.filter((c) => c.level === 'core')) {
    test(`${c.id} "${c.text}"`, () => {
      const r = runForwardCase(c);
      expect(r.pass, r.detail).toBe(true);
    });
  }
});

suite('corpus: reverse golden (core)', () => {
  const fixture = load<{ defaults: object; cases: ReverseCase[] }>('corpus/reverse/golden-en.json');
  for (const raw of fixture.cases.filter((c) => c.level !== 'aspirational')) {
    const c = { ...raw, ctx: { ...fixture.defaults, ...raw.ctx } };
    test(`${c.id} → "${c.primary}"`, () => {
      const r = runReverseCase(c);
      expect(r.pass, r.detail).toBe(true);
    });
  }
});

suite('corpus: imported baseline (regression gate)', () => {
  const { cases } = load<{ cases: ForwardCase[] }>('corpus/forward/imported-recognizers-en.json');
  const baseline = load<{ passingIds: string[] }>('corpus/baselines/forward-imported.json');
  const byId = new Map(cases.map((c) => [c.id, c]));
  test(`all ${baseline.passingIds.length} baselined cases still pass`, () => {
    const regressions: string[] = [];
    for (const id of baseline.passingIds) {
      const c = byId.get(id);
      if (!c || !runForwardCase(c).pass) regressions.push(id);
    }
    expect(regressions, `regressions: ${regressions.slice(0, 10).join(', ')}`).toHaveLength(0);
  });
});
