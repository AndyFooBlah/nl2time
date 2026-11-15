import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe as suite, expect, test } from 'vitest';

import { IRValidationError, validateExpr } from '../src/index.js';

suite('IR validation (untrusted input boundary)', () => {
  test('accepts well-formed expressions', () => {
    expect(() =>
      validateExpr({
        op: 'snap',
        base: { op: 'offset', base: { op: 'now' }, amount: -1, unit: 'week' },
        unit: 'week',
      }),
    ).not.toThrow();
    expect(() =>
      validateExpr({
        op: 'intersect',
        parts: [
          { op: 'seek', base: { op: 'now' }, dir: 'next', target: { kind: 'weekday', weekday: 'tue' } },
          { op: 'literal', time: { hour: 4, meridiem: 'unknown' } },
        ],
      }),
    ).not.toThrow();
    expect(() =>
      validateExpr({ op: 'recur', every: 'week', filter: { op: 'literal', dayPeriod: 'morning' } }),
    ).not.toThrow();
  });

  test('rejects malformed expressions with a path', () => {
    expect(() => validateExpr({ op: 'nope' })).toThrow(IRValidationError);
    expect(() => validateExpr({ op: 'offset', base: { op: 'now' }, amount: 1.5, unit: 'day' })).toThrow(
      /amount/,
    );
    expect(() => validateExpr({ op: 'offset', base: { op: 'now' }, amount: 1, unit: 'fortnight' })).toThrow(
      /unit/,
    );
    expect(() => validateExpr({ op: 'literal' })).toThrow(/literal requires/);
    expect(() => validateExpr({ op: 'literal', date: { month: 13 } })).toThrow(/month/);
    expect(() => validateExpr({ op: 'span', anchor: { op: 'now' }, amount: {} })).toThrow(/amount/);
    expect(() => validateExpr({ op: 'intersect', parts: [{ op: 'now' }] })).toThrow(/parts/);
    expect(() =>
      validateExpr({ op: 'seek', base: { op: 'now' }, dir: 'sideways', target: { kind: 'unit', unit: 'day' } }),
    ).toThrow(/dir/);
    // Prototype-pollution-shaped junk must not slip through.
    expect(() => validateExpr(JSON.parse('{"op":"now","__proto__":{"x":1}}'))).not.toThrow();
    expect(() => validateExpr('now')).toThrow(IRValidationError);
    expect(() => validateExpr(null)).toThrow(IRValidationError);
  });
});

suite("the parser's own output validates (#16)", () => {
  // Every expression the rule parsers emit for the corpora is recorded in
  // corpus/ir; the library's validator must accept all of them, or LLM
  // fallback validation and ports disagree with the parser.
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'corpus', 'ir');
  for (const file of readdirSync(root).filter((f) => f.endsWith('.json'))) {
    test(file, () => {
      const data = JSON.parse(readFileSync(join(root, file), 'utf8')) as { cases: { id: string; expr: unknown }[] };
      const bad: string[] = [];
      for (const f of data.cases) {
        try {
          validateExpr(f.expr);
        } catch (e) {
          bad.push(`${f.id}: ${(e as Error).message}`);
        }
      }
      expect(bad).toEqual([]);
    });
  }
});

suite('until (#32)', () => {
  test('accepts until with an optional boolean exclusive', () => {
    expect(() => validateExpr({ op: 'until', end: { op: 'literal', date: { year: 2022, month: 3 } }, exclusive: true })).not.toThrow();
    expect(() => validateExpr({ op: 'until', end: { op: 'now' } })).not.toThrow();
  });
  test('rejects a missing end or a non-boolean exclusive', () => {
    expect(() => validateExpr({ op: 'until' })).toThrow(IRValidationError);
    expect(() => validateExpr({ op: 'until', end: { op: 'now' }, exclusive: 'yes' })).toThrow(IRValidationError);
  });
});
