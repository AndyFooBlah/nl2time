/**
 * The round-trip invariant: resolve(describe(v, ctx).expr, ctx) must produce
 * a first candidate containing v at the stated grain — what we say must read
 * back to the thing we said it about.
 */
import { describe as suite, expect, test } from 'vitest';

import { TimeContext, Temporal, describe, resolveOne } from '../src/index.js';

const NOW_ISO = '2026-07-20T17:00:00Z';

const CTXS = [
  { timeZone: 'America/Los_Angeles', locale: 'en-US' },
  { timeZone: 'Europe/London', locale: 'en-GB' },
  { timeZone: 'Asia/Kathmandu', locale: 'en-IN' },
  { timeZone: 'Australia/Sydney', locale: 'en-AU' },
];

// Hour offsets from now spanning minutes → months, both directions, crossing
// midnights, weeks, and month boundaries.
const OFFSETS_HOURS = [
  0, -1, -3, -13, -25, -48, -100, -200, -400, -800, -1600,
  1, 3, 13, 25, 48, 100, 200, 400, 800, 1600,
];

const STYLES = ['neutral', 'casual'] as const;
const FRAMINGS = ['auto', 'elapsed', 'absolute'] as const;

// One grain unit of slack (generous for DST-stretched days).
const GRAIN_SLACK_SECONDS: Record<string, number> = {
  instant: 1,
  second: 1,
  minute: 60,
  hour: 3600,
  day: 90000,
  week: 7 * 90000,
  month: 32 * 86400,
  quarter: 93 * 86400,
  year: 367 * 86400,
};

function gapSeconds(
  start: InstanceType<typeof Temporal.Instant>,
  end: InstanceType<typeof Temporal.Instant>,
  instant: InstanceType<typeof Temporal.Instant>,
): number {
  if (Temporal.Instant.compare(instant, start) < 0) {
    return start.since(instant).total({ unit: 'second' });
  }
  if (Temporal.Instant.compare(instant, end) >= 0) {
    return instant.since(end).total({ unit: 'second' });
  }
  return 0;
}

suite('round-trip invariant', () => {
  for (const ctxOpts of CTXS) {
    test(`${ctxOpts.timeZone} / ${ctxOpts.locale}`, () => {
      const ctx = TimeContext.make({ now: NOW_ISO, ...ctxOpts });
      for (const h of OFFSETS_HOURS) {
        const instant = Temporal.Instant.from(NOW_ISO).add({ hours: h });
        for (const style of STYLES) {
          for (const framing of FRAMINGS) {
            const d = describe(instant, ctx, { style, framing });
            const v = resolveOne(d.expr, ctx);
            expect(v.kind).toBe('interval');
            if (v.kind !== 'interval') continue;
            const contains =
              Temporal.Instant.compare(v.start, instant) <= 0 &&
              (Temporal.Instant.compare(instant, v.end) < 0 ||
                Temporal.Instant.compare(v.start, v.end) === 0);
            // Elapsed framing truncates ("4 days ago" covers 4.0–4.99 days),
            // so the read-back may miss by up to one grain unit; calendar and
            // absolute framings must contain exactly.
            const ok =
              contains ||
              (d.framing === 'elapsed' &&
                gapSeconds(v.start, v.end, instant) <= GRAIN_SLACK_SECONDS[d.grain]!);
            expect(
              ok,
              `${instant.toString()} (${style}/${framing}) → "${d.text}" → [${v.start.toString()}, ${v.end.toString()})`,
            ).toBe(true);
          }
        }
      }
    });
  }
});
