/**
 * Corpus runner: executes golden-set cases (corpus/) against this
 * implementation. Exported as `nl2time/corpus` so evals, ports, and consumers
 * can grade their own pipelines against the same cases.
 *
 * Case format: see corpus/README.md. All comparisons here are pure functions
 * of (case, implementation output) — no I/O.
 */
import { Temporal, toZoned } from '../clock/index.js';
import { TimeContext, type TimeContextOptions } from '../context.js';
import { describe, type DescribeOptions } from '../describe/index.js';
import { resolve, type TimeValue } from '../engine/resolve.js';
import type { CalendarAmount, Grain } from '../ir/types.js';
import type { DomainPack } from '../packs/index.js';
import { parse } from '../parse/index.js';

export interface SourceInfo {
  name: string;
  license: string;
  url?: string;
  path?: string;
  commit?: string;
  index?: number;
}

export interface IntervalExpect {
  /** Instant expectations (ISO with offset/Z). */
  start?: string;
  end?: string;
  /** Civil expectations, compared in the case's timeZone ("YYYY-MM-DDTHH:MM:SS"). */
  startLocal?: string;
  endLocal?: string;
  /** Civil point: candidate interval start must equal it. */
  pointLocal?: string;
  /** Omit or null to skip the grain check (imported cases). */
  grain?: Grain | null;
}

export interface ForwardExpect {
  noMatch?: boolean;
  amount?: CalendarAmount;
  durationSeconds?: number;
  /** Ordered: candidate i must match spec i (hand-authored cases). */
  first?: IntervalExpect;
  candidates?: IntervalExpect[];
  /** Unordered: every value must appear among resolved candidates (imported). */
  values?: IntervalExpect[];
}

export interface ForwardCase {
  id: string;
  text: string;
  ctx: TimeContextOptions;
  expect: ForwardExpect;
  /** Domain packs to activate for this case (docs/extending.md). */
  packs?: DomainPack[];
  /** Default: 'core'. */
  level?: 'core' | 'aspirational';
  source?: SourceInfo;
  tags?: string[];
  note?: string;
}

export interface ReverseCase {
  id: string;
  value: { instant?: string; interval?: { start: string; end: string; grain: Grain } };
  ctx: TimeContextOptions;
  opts?: DescribeOptions;
  /** Expected nl2time output (normalized). Graded exactly for level 'core'. */
  primary: string;
  /** Additional acceptable renderings, for grading other systems/LLM output. */
  accept?: string[];
  framing?: string;
  /** Default: 'core'. */
  level?: 'core' | 'aspirational';
  source?: SourceInfo;
  tags?: string[];
  note?: string;
}

export interface CaseOutcome {
  id: string;
  pass: boolean;
  detail?: string;
}

/** Lowercase, unify NBSP/NNBSP, collapse whitespace, strip trailing period. */
export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[  ]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\.$/, '')
    .trim();
}

function localString(instant: Temporal.Instant, timeZone: string): string {
  const pdt = toZoned(instant, timeZone).toPlainDateTime();
  // Normalize to second precision: "YYYY-MM-DDTHH:MM:SS".
  return pdt.toString({ smallestUnit: 'second' });
}

function normLocal(s: string): string {
  // Pad "2016-11-07T16:12" → "2016-11-07T16:12:00".
  return s.length === 16 ? `${s}:00` : s;
}

/**
 * Equality with inclusive-end tolerance: some upstream corpora express
 * interval ends as the last included second ("23:59:59"); our half-open
 * convention lands one second later ("00:00:00" next day). Accept both.
 */
function localEq(actual: string, expected: string): boolean {
  if (actual === expected) return true;
  if (!expected.endsWith(':59:59') && !expected.endsWith(':59')) return false;
  const bumped = Temporal.PlainDateTime.from(expected).add({ seconds: 1 }).toString({
    smallestUnit: 'second',
  });
  return actual === bumped;
}

const AMOUNT_SECONDS: Record<string, number> = {
  years: 31536000,
  months: 2592000,
  weeks: 604800,
  days: 86400,
  hours: 3600,
  minutes: 60,
  seconds: 1,
};

function amountToSeconds(amount: CalendarAmount): number {
  let total = 0;
  for (const [k, v] of Object.entries(amount)) {
    if (typeof v === 'number') total += v * (AMOUNT_SECONDS[k] ?? 0);
  }
  return total;
}

function isoDurationToSeconds(iso: string): number | undefined {
  const m = iso.match(/^(-)?P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/);
  if (!m) return undefined;
  const [, neg, y, mo, w, d, h, mi, s] = m;
  const total =
    (Number(y ?? 0) * 31536000) +
    (Number(mo ?? 0) * 2592000) +
    (Number(w ?? 0) * 604800) +
    (Number(d ?? 0) * 86400) +
    (Number(h ?? 0) * 3600) +
    (Number(mi ?? 0) * 60) +
    Number(s ?? 0);
  return neg ? -total : total;
}

function matchesInterval(v: TimeValue, spec: IntervalExpect, timeZone: string): boolean {
  if (v.kind !== 'interval') return false;
  if (spec.grain !== undefined && spec.grain !== null && v.grain !== spec.grain) return false;
  if (spec.start !== undefined && v.start.toString() !== spec.start) return false;
  if (spec.end !== undefined && v.end.toString() !== spec.end) return false;
  if (spec.startLocal !== undefined && !localEq(localString(v.start, timeZone), normLocal(spec.startLocal))) return false;
  if (spec.endLocal !== undefined) {
    const actualEnd = localString(v.end, timeZone);
    let expectedEnd = normLocal(spec.endLocal);
    // Some upstream time ranges emit a cross-midnight end without the date
    // roll (end textually before start) — accept the next-day equivalent.
    if (spec.startLocal !== undefined && expectedEnd < normLocal(spec.startLocal)) {
      const rolled = Temporal.PlainDateTime.from(expectedEnd).add({ days: 1 }).toString({ smallestUnit: 'second' });
      if (!localEq(actualEnd, expectedEnd) && !localEq(actualEnd, rolled)) return false;
    } else if (!localEq(actualEnd, expectedEnd)) {
      return false;
    }
  }
  if (spec.pointLocal !== undefined && !localEq(localString(v.start, timeZone), normLocal(spec.pointLocal))) return false;
  return true;
}

function matchesAmountish(v: TimeValue, seconds: number): boolean {
  if (v.kind === 'amount') return amountToSeconds(v.amount) === seconds;
  if (v.kind === 'duration') return isoDurationToSeconds(v.iso) === seconds;
  return false;
}

export function runForwardCase(c: ForwardCase): CaseOutcome {
  let ctx: TimeContext;
  try {
    ctx = TimeContext.make(c.ctx);
  } catch (e) {
    return { id: c.id, pass: false, detail: `context: ${String(e)}` };
  }
  const { matches } = parse(c.text, ctx, c.packs ? { packs: c.packs } : undefined);

  if (c.expect.noMatch) {
    return matches.length === 0
      ? { id: c.id, pass: true }
      : { id: c.id, pass: false, detail: `unexpected match "${matches[0]!.text}"` };
  }
  if (matches.length === 0) return { id: c.id, pass: false, detail: 'no match' };

  const tz = ctx.timeZone;
  // Hand-authored expectations grade the first match; imported `values`
  // expectations accept any match (multi-span utterances).
  for (const [mi, m] of matches.entries()) {
    let candidates: TimeValue[];
    try {
      candidates = resolve(m.expr, ctx).candidates;
    } catch {
      continue;
    }

    let ok = true;
    if (c.expect.amount) {
      ok = candidates.some(
        (v) => v.kind === 'amount' && JSON.stringify(v.amount) === JSON.stringify(c.expect.amount),
      );
    }
    if (ok && c.expect.durationSeconds !== undefined) {
      ok = candidates.some((v) => matchesAmountish(v, c.expect.durationSeconds!));
    }
    if (ok && c.expect.first) {
      ok = candidates.length > 0 && matchesInterval(candidates[0]!, c.expect.first, tz);
    }
    if (ok && c.expect.candidates) {
      ok =
        candidates.length >= c.expect.candidates.length &&
        c.expect.candidates.every((spec, i) => matchesInterval(candidates[i]!, spec, tz));
    }
    if (ok && c.expect.values) {
      ok = c.expect.values.every((spec) => candidates.some((v) => matchesInterval(v, spec, tz)));
    }
    if (ok) return { id: c.id, pass: true };
    if (mi === 0 && (c.expect.first || c.expect.candidates)) {
      // Ordered expectations are strict about the first match.
      return { id: c.id, pass: false, detail: describeMismatch(candidates, tz) };
    }
  }
  return { id: c.id, pass: false, detail: describeMismatch(resolveSafe(matches[0]!.expr, ctx), tz) };
}

function resolveSafe(expr: Parameters<typeof resolve>[0], ctx: TimeContext): TimeValue[] {
  try {
    return resolve(expr, ctx).candidates;
  } catch {
    return [];
  }
}

function describeMismatch(candidates: TimeValue[], tz: string): string {
  const shown = candidates
    .slice(0, 3)
    .map((v) =>
      v.kind === 'interval'
        ? `[${localString(v.start, tz)}, ${localString(v.end, tz)}) ${v.grain}`
        : JSON.stringify(v),
    )
    .join(' | ');
  return `got: ${shown || '(none)'}`;
}

export function runReverseCase(c: ReverseCase): CaseOutcome {
  let ctx: TimeContext;
  try {
    ctx = TimeContext.make(c.ctx);
  } catch (e) {
    return { id: c.id, pass: false, detail: `context: ${String(e)}` };
  }
  const value = c.value.instant
    ? Temporal.Instant.from(c.value.instant)
    : ({
        kind: 'interval',
        start: Temporal.Instant.from(c.value.interval!.start),
        end: Temporal.Instant.from(c.value.interval!.end),
        grain: c.value.interval!.grain,
      } as TimeValue);
  const d = describe(value, ctx, c.opts);
  const got = normalizeText(d.text);
  if (got === normalizeText(c.primary)) {
    if (c.framing && d.framing !== c.framing) {
      return { id: c.id, pass: false, detail: `framing ${d.framing} ≠ ${c.framing}` };
    }
    return { id: c.id, pass: true };
  }
  return { id: c.id, pass: false, detail: `got "${d.text}"` };
}

/**
 * Grade arbitrary text (another system, an LLM) against a reverse case:
 * primary and every accept entry are acceptable.
 */
export function gradeReverseText(c: ReverseCase, text: string): boolean {
  const got = normalizeText(text);
  if (got === normalizeText(c.primary)) return true;
  return (c.accept ?? []).some((a) => normalizeText(a) === got);
}
