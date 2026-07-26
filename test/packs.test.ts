import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe as suite, expect, test } from 'vitest';

import {
  runForwardCase,
  type ForwardCase,
} from '../src/corpus/runner.js';
import {
  PackError,
  TimeContext,
  createParser,
  parse,
  resolve,
  validatePack,
  type DomainPack,
} from '../src/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pack = validatePack(
  JSON.parse(readFileSync(join(root, 'examples/fiscal-july/pack.json'), 'utf8')),
) as DomainPack;
const fixture = JSON.parse(
  readFileSync(join(root, 'examples/fiscal-july/cases.json'), 'utf8'),
) as { defaults: object; cases: ForwardCase[] };

suite('domain packs: fiscal-july example', () => {
  for (const raw of fixture.cases) {
    const c: ForwardCase = { ...raw, ctx: { ...fixture.defaults, ...raw.ctx }, packs: [pack] };
    test(`${c.id} "${c.text}"`, () => {
      const r = runForwardCase(c);
      expect(r.pass, r.detail).toBe(true);
    });
  }
});

suite('domain packs: mechanics', () => {
  const ctx = TimeContext.make({
    now: '2026-07-20T17:00:00Z',
    timeZone: 'America/Los_Angeles',
    locale: 'en-US',
  });

  test('createParser precompiles and matches parse(opts)', () => {
    const parser = createParser({ packs: [pack] });
    const a = parser('Q2 FY26', ctx).matches[0]!;
    const b = parse('Q2 FY26', ctx, { packs: [pack] }).matches[0]!;
    expect(a.expr).toEqual(b.expr);
    const v = resolve(a.expr, ctx).candidates[0]!;
    expect(v.kind).toBe('interval');
    if (v.kind === 'interval') {
      expect(v.start.toString()).toBe('2025-10-01T07:00:00Z');
    }
  });

  test('without the pack, EOD keeps its built-in end-of-day reading', () => {
    const m = parse('due by EOD', ctx).matches[0]!;
    const v = resolve(m.expr, ctx).candidates[0]!;
    if (v.kind === 'interval') {
      // Built-in eod = end-of-day point (midnight boundary), not 5pm.
      expect(v.start.toString()).toBe('2026-07-21T07:00:00Z');
    }
  });

  test('disable turns off a built-in rule by name', () => {
    const withHoliday = parse('christmas', ctx);
    expect(withHoliday.matches.length).toBeGreaterThan(0);
    const without = parse('christmas', ctx, { disable: ['holiday'] });
    expect(without.matches).toHaveLength(0);
  });

  test('period shorthand produces a mergeable time-of-day interval', () => {
    const shifts: DomainPack = {
      name: 'shifts',
      vocabulary: [{ phrases: ['swing shift'], period: { from: 16, before: 24 } }],
    };
    const m = parse('yesterday swing shift', ctx, { packs: [shifts] }).matches[0]!;
    const v = resolve(m.expr, ctx).candidates[0]!;
    if (v.kind === 'interval') {
      expect(v.start.toString()).toBe('2026-07-19T23:00:00Z'); // 16:00 PDT Jul 19
      expect(v.end.toString()).toBe('2026-07-20T07:00:00Z'); // 24:00 PDT Jul 19
    }
  });

  test('validatePack rejects malformed templates with a path', () => {
    expect(() =>
      validatePack({
        name: 'bad',
        vocabulary: [{ phrases: ['x'], expr: { op: 'nope' } }],
      }),
    ).toThrow(PackError);
    expect(() =>
      validatePack({
        name: 'bad2',
        vocabulary: [{ phrases: ['x'] }],
      }),
    ).toThrow(/exactly one of/);
  });
});
