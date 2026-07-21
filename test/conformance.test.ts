import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe as suite, expect, test } from 'vitest';

import {
  TimeContext,
  Temporal,
  describe,
  parse,
  resolve,
  type TimeContextOptions,
  type TimeValue,
} from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));

function loadFixture<T>(name: string): T {
  return JSON.parse(readFileSync(join(here, 'fixtures', name), 'utf8')) as T;
}

/** ICU inserts U+202F before AM/PM; normalize for stable comparisons. */
function norm(s: string): string {
  return s.replace(/[  ]/g, ' ');
}

interface IntervalSpec {
  start: string;
  end: string;
  grain: string;
}

interface ParseCase {
  text: string;
  ctx?: Partial<TimeContextOptions>;
  first?: IntervalSpec;
  candidates?: IntervalSpec[];
  candidateCount?: number;
  amount?: Record<string, number>;
  noMatch?: boolean;
  note?: string;
}

interface ParseFixture {
  defaults: TimeContextOptions;
  cases: ParseCase[];
}

function expectInterval(value: TimeValue | undefined, spec: IntervalSpec): void {
  expect(value).toBeDefined();
  expect(value!.kind).toBe('interval');
  if (value!.kind !== 'interval') return;
  expect(value!.start.toString()).toBe(spec.start);
  expect(value!.end.toString()).toBe(spec.end);
  expect(value!.grain).toBe(spec.grain);
}

suite('parse→resolve conformance (en)', () => {
  const fixture = loadFixture<ParseFixture>('parse-en.json');
  for (const c of fixture.cases) {
    test(`"${c.text}"${c.ctx ? ` ${JSON.stringify(c.ctx)}` : ''}`, () => {
      const ctx = TimeContext.make({ ...fixture.defaults, ...c.ctx });
      const result = parse(c.text, ctx);

      if (c.noMatch) {
        expect(result.matches).toHaveLength(0);
        return;
      }
      expect(result.matches.length).toBeGreaterThan(0);
      const { candidates } = resolve(result.matches[0]!.expr, ctx);

      if (c.amount) {
        expect(candidates[0]).toEqual({ kind: 'amount', amount: c.amount });
        return;
      }
      if (c.candidateCount !== undefined) {
        expect(candidates).toHaveLength(c.candidateCount);
      }
      if (c.first) expectInterval(candidates[0], c.first);
      if (c.candidates) {
        expect(candidates.length).toBeGreaterThanOrEqual(c.candidates.length);
        c.candidates.forEach((spec, i) => expectInterval(candidates[i], spec));
      }
    });
  }
});

interface DescribeCase {
  instant?: string;
  interval?: IntervalSpec;
  ctx?: Partial<TimeContextOptions>;
  opts?: { style?: 'neutral' | 'casual'; framing?: 'auto' | 'calendar' | 'elapsed' | 'absolute' };
  text: string;
  framing: string;
  note?: string;
}

interface DescribeFixture {
  defaults: TimeContextOptions;
  cases: DescribeCase[];
}

suite('describe conformance (en)', () => {
  const fixture = loadFixture<DescribeFixture>('describe-en.json');
  for (const c of fixture.cases) {
    test(`${c.instant ?? c.interval!.start} → "${c.text}"`, () => {
      const ctx = TimeContext.make({ ...fixture.defaults, ...c.ctx });
      const value = c.instant
        ? Temporal.Instant.from(c.instant)
        : ({
            kind: 'interval',
            start: Temporal.Instant.from(c.interval!.start),
            end: Temporal.Instant.from(c.interval!.end),
            grain: c.interval!.grain,
          } as TimeValue);
      const d = describe(value, ctx, c.opts);
      expect(norm(d.text)).toBe(c.text);
      expect(d.framing).toBe(c.framing);
    });
  }
});
