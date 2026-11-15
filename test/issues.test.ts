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

suite('#58 "after X" open ranges', () => {
  test('a future start resolves with end null', () => {
    const [m] = parse('after next week', ctx).matches;
    const [c] = resolve(m!.expr, ctx).candidates;
    expect(c).toMatchObject({ kind: 'interval', end: null, grain: 'week' });
  });
  test('describe() renders an open-end interval as "from … on" and round-trips', () => {
    const [m] = parse('after March 2027', ctx).matches;
    const [c] = resolve(m!.expr, ctx).candidates;
    const d = describe(c!, ctx);
    expect(d.text).toMatch(/^from .* on$/);
    const [back] = resolve(d.expr, ctx).candidates;
    expect(back).toMatchObject({ end: null });
    expect(back!.kind === 'interval' && c!.kind === 'interval' && back!.start!.equals(c!.start!)).toBe(true);
  });
  test('"after" that does not introduce a time is left alone', () => {
    expect(texts('after 2000 attempts')).toEqual([]);
    expect(texts('after the meeting')).toEqual([]);
    expect(texts('I can only leave on 1/1/2016 and after my work item is done')).toEqual(['1/1/2016']);
  });
  test('"for a week starting tomorrow" stays a span anchored on tomorrow', () => {
    const [m] = parse('for a week starting tomorrow', ctx).matches;
    expect(m!.expr).toMatchObject({ op: 'span', anchor: { op: 'snap' }, amount: { weeks: 1 } });
  });
});
