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
