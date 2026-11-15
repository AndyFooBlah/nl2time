/**
 * Behaviour the corpus format can't pin (match counts, confidence, describe
 * of open ranges) for the 2026-11 bug round. Context from the issue reports.
 */
import { describe as suite, expect, test } from 'vitest';

import { describe, parse, resolve, TimeContext } from '../src/index.js';

const ctx = TimeContext.make({
  now: '2026-10-13T08:00:00-05:00',
  timeZone: 'America/Chicago',
  locale: 'en-US',
  weekStart: 'mon',
  bias: 'past',
  partialPeriod: 'exclude',
});

const texts = (t: string): string[] => parse(t, ctx).matches.map((m) => m.text);

suite('#32 open-start ranges', () => {
  test('a past boundary resolves with start null, never zero candidates', () => {
    const [m] = parse('orders placed before March 2022', ctx).matches;
    const [c] = resolve(m!.expr, ctx).candidates;
    expect(c).toMatchObject({ kind: 'interval', start: null, grain: 'month' });
  });
  test('describe() renders an open-start interval as "before …" and round-trips', () => {
    const [m] = parse('before March 2022', ctx).matches;
    const [c] = resolve(m!.expr, ctx).candidates;
    const d = describe(c!, ctx);
    expect(d.text.startsWith('before ')).toBe(true);
    const [back] = resolve(d.expr, ctx).candidates;
    expect(back).toMatchObject({ start: null });
    expect(back!.kind === 'interval' && c!.kind === 'interval' && back!.end.equals(c!.end)).toBe(true);
  });
});

suite('#34 weekday + date', () => {
  test('one match, not a relative weekday plus the date', () => {
    expect(texts('Thursday 2026-08-20')).toEqual(['Thursday 2026-08-20']);
  });
  test('a contradicting weekday keeps the date at lower confidence', () => {
    const [m] = parse('Wednesday 2026-08-20', ctx).matches;
    expect(m!.confidence).toBeLessThan(0.9);
  });
});

suite('#35 disjunctions and anaphora', () => {
  test('both years of a coordination are matched', () => {
    expect(texts('2024 or 2025')).toEqual(['2024', '2025']);
    expect(texts('in 2024 and 2025')).toEqual(['2024', '2025']);
  });
  test('"between 2020 and 2022" stays one range', () => {
    expect(texts('between 2020 and 2022')).toEqual(['between 2020 and 2022']);
  });
});
