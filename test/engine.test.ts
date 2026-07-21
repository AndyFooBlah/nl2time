/**
 * Adversarial date battery: DST transitions in both hemispheres, odd-offset
 * zones, leap days, week-start variation. These run against the engine
 * directly with hand-built IR.
 */
import { describe as suite, expect, test } from 'vitest';

import {
  TimeContext,
  resolve,
  resolveOne,
  NotResolvableError,
  type TimeExpr,
} from '../src/index.js';

const NOW: TimeExpr = { op: 'now' };
const YESTERDAY: TimeExpr = {
  op: 'snap',
  base: { op: 'offset', base: NOW, amount: -1, unit: 'day' },
  unit: 'day',
};

function interval(expr: TimeExpr, ctx: TimeContext): { start: string; end: string } {
  const v = resolveOne(expr, ctx);
  if (v.kind !== 'interval') throw new Error('expected interval');
  return { start: v.start.toString(), end: v.end.toString() };
}

suite('DST battery', () => {
  test('spring forward US: yesterday is a 23-hour day', () => {
    // 2026-03-08 02:00 PST → 03:00 PDT (US spring forward).
    const ctx = TimeContext.make({
      now: '2026-03-09T18:00:00Z',
      timeZone: 'America/Los_Angeles',
      locale: 'en-US',
    });
    expect(interval(YESTERDAY, ctx)).toEqual({
      start: '2026-03-08T08:00:00Z', // midnight PST
      end: '2026-03-09T07:00:00Z', // midnight PDT — 23 hours later
    });
  });

  test('fall back US: yesterday is a 25-hour day', () => {
    // 2026-11-01 02:00 PDT → 01:00 PST.
    const ctx = TimeContext.make({
      now: '2026-11-02T20:00:00Z',
      timeZone: 'America/Los_Angeles',
      locale: 'en-US',
    });
    expect(interval(YESTERDAY, ctx)).toEqual({
      start: '2026-11-01T07:00:00Z', // midnight PDT
      end: '2026-11-02T08:00:00Z', // midnight PST — 25 hours later
    });
  });

  test('southern hemisphere spring forward (Sydney, Oct 4 2026)', () => {
    const ctx = TimeContext.make({
      now: '2026-10-05T02:00:00Z',
      timeZone: 'Australia/Sydney',
      locale: 'en-AU',
    });
    // Oct 4: 02:00 AEST → 03:00 AEDT; the day is 23 hours.
    expect(interval(YESTERDAY, ctx)).toEqual({
      start: '2026-10-03T14:00:00Z', // midnight AEST (UTC+10)
      end: '2026-10-04T13:00:00Z', // midnight AEDT (UTC+11)
    });
  });

  test('a time inside the spring-forward gap resolves compatibly (02:30 → 03:30)', () => {
    const ctx = TimeContext.make({
      now: '2026-03-08T20:00:00Z',
      timeZone: 'America/Los_Angeles',
      locale: 'en-US',
    });
    const expr: TimeExpr = {
      op: 'intersect',
      parts: [
        { op: 'snap', base: NOW, unit: 'day' },
        { op: 'literal', time: { hour: 2, minute: 30, meridiem: 'am' } },
      ],
    };
    // 02:30 doesn't exist on 2026-03-08 in LA; Temporal 'compatible' moves forward.
    const v = interval(expr, ctx);
    expect(v.start).toBe('2026-03-08T10:30:00Z'); // 03:30 PDT
  });

  test('half-hour-offset zone (Asia/Kathmandu, UTC+05:45)', () => {
    const ctx = TimeContext.make({
      now: '2026-07-20T12:00:00Z', // 17:45 local
      timeZone: 'Asia/Kathmandu',
      locale: 'en-IN',
    });
    expect(interval({ op: 'snap', base: NOW, unit: 'day' }, ctx)).toEqual({
      start: '2026-07-19T18:15:00Z',
      end: '2026-07-20T18:15:00Z',
    });
  });
});

suite('calendar edges', () => {
  test('leap day: Feb 2024 snap', () => {
    const ctx = TimeContext.make({
      now: '2024-02-29T12:00:00Z',
      timeZone: 'UTC',
      locale: 'en-US',
    });
    expect(interval({ op: 'snap', base: NOW, unit: 'month' }, ctx)).toEqual({
      start: '2024-02-01T00:00:00Z',
      end: '2024-03-01T00:00:00Z',
    });
  });

  test('month arithmetic clamps: Jan 31 + 1 month = Feb 29 (leap year)', () => {
    const ctx = TimeContext.make({
      now: '2024-01-31T12:00:00Z',
      timeZone: 'UTC',
      locale: 'en-US',
    });
    const v = interval(
      { op: 'snap', base: { op: 'offset', base: NOW, amount: 1, unit: 'month' }, unit: 'day' },
      ctx,
    );
    expect(v.start).toBe('2024-02-29T00:00:00Z');
  });

  test('week snap across a year boundary honors week start', () => {
    // Thu Jan 1 2026. en-US (Sunday start): week began Sun Dec 28 2025.
    const us = TimeContext.make({ now: '2026-01-01T12:00:00Z', timeZone: 'UTC', locale: 'en-US' });
    expect(interval({ op: 'snap', base: NOW, unit: 'week' }, us).start).toBe('2025-12-28T00:00:00Z');
    // en-GB (Monday start): week began Mon Dec 29 2025.
    const gb = TimeContext.make({ now: '2026-01-01T12:00:00Z', timeZone: 'UTC', locale: 'en-GB' });
    expect(interval({ op: 'snap', base: NOW, unit: 'week' }, gb).start).toBe('2025-12-29T00:00:00Z');
    // ar-EG (Saturday start): week began Sat Dec 27 2025. (Note: CLDR has
    // Saudi Arabia on Sunday start since its 2013 weekend change.)
    const eg = TimeContext.make({ now: '2026-01-01T12:00:00Z', timeZone: 'UTC', locale: 'ar-EG' });
    expect(interval({ op: 'snap', base: NOW, unit: 'week' }, eg).start).toBe('2025-12-27T00:00:00Z');
  });

  test('nth weekday within a month: 2nd Monday of March 2026', () => {
    const ctx = TimeContext.make({ now: '2026-07-20T17:00:00Z', timeZone: 'UTC', locale: 'en-US' });
    const march: TimeExpr = { op: 'literal', date: { year: 2026, month: 3 } };
    const v = interval(
      { op: 'seek', base: march, dir: 'next', target: { kind: 'weekday', weekday: 'mon' }, n: 2 },
      ctx,
    );
    expect(v.start).toBe('2026-03-09T00:00:00Z');
  });

  test('5th Monday of a month with only 4 yields no candidates', () => {
    const ctx = TimeContext.make({ now: '2026-07-20T17:00:00Z', timeZone: 'UTC', locale: 'en-US' });
    const feb: TimeExpr = { op: 'literal', date: { year: 2026, month: 2 } };
    const { candidates } = resolve(
      { op: 'seek', base: feb, dir: 'next', target: { kind: 'weekday', weekday: 'mon' }, n: 5 },
      ctx,
    );
    expect(candidates).toHaveLength(0);
  });

  test('recur is representable but not resolvable in v1', () => {
    const ctx = TimeContext.make({ now: '2026-07-20T17:00:00Z', timeZone: 'UTC', locale: 'en-US' });
    expect(() =>
      resolve(
        {
          op: 'recur',
          every: 'week',
          filter: { op: 'seek', base: NOW, dir: 'next', target: { kind: 'weekday', weekday: 'tue' } },
        },
        ctx,
      ),
    ).toThrow(NotResolvableError);
  });
});
