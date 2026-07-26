#!/usr/bin/env node
/**
 * Invert forward corpus cases into reverse (time→NL) cases (issue #12).
 *
 * Every clean forward case (text, ctx) → interval yields a reverse case:
 *   value   = the expected interval
 *   primary = describe(value, ctx).text  — pinned current behavior
 *   accept  = [the matched temporal span of the source text] — the human
 *             phrasing that provably denotes this value, forming the
 *             acceptance class for grading other systems / LLM output.
 *
 * The mapping is many-to-one by design ("3 o'clock yesterday afternoon",
 * "3pm on July 24", "15:00 on July 24" are one class), so the source text
 * lands in `accept`, not `primary`. Cases are regenerated, never hand-edited:
 *   node scripts/invert-corpus.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';

import { runReverseCase } from '../dist/corpus/runner.js';
import { TimeContext, Temporal, describe, parse } from '../dist/index.js';

const forwardUrl = new URL('../corpus/forward/handauthored-en.json', import.meta.url);
const outUrl = new URL('../corpus/reverse/inverted-handauthored-en.json', import.meta.url);
const { cases } = JSON.parse(readFileSync(forwardUrl, 'utf8'));

function localToInstant(local, timeZone) {
  return Temporal.PlainDateTime.from(local).toZonedDateTime(timeZone).toInstant();
}

function inferGrain(start, end) {
  if (Temporal.Instant.compare(start, end) === 0) return 'instant';
  const seconds = start.until(end).total({ unit: 'second' });
  if (seconds === 60) return 'minute';
  if (seconds === 3600) return 'hour';
  if (seconds <= 26 * 3600) return 'day';
  if (seconds <= 8 * 86400) return 'week';
  if (seconds <= 32 * 86400) return 'month';
  if (seconds <= 100 * 86400) return 'quarter';
  return 'year';
}

const out = [];
const seen = new Set();
const skipped = { nonInterval: 0, unparsable: 0, duplicate: 0, roundtripFail: 0 };

for (const c of cases) {
  if (c.expect.noMatch || c.expect.amount || c.expect.durationSeconds !== undefined) {
    skipped.nonInterval += 1;
    continue;
  }
  const spec = c.expect.first ?? c.expect.candidates?.[0] ?? c.expect.values?.[0];
  if (!spec) {
    skipped.nonInterval += 1;
    continue;
  }
  const ctx = TimeContext.make(c.ctx);
  let start;
  let end;
  if (spec.start !== undefined && spec.end !== undefined) {
    start = Temporal.Instant.from(spec.start);
    end = Temporal.Instant.from(spec.end);
  } else if (spec.startLocal !== undefined && spec.endLocal !== undefined) {
    start = localToInstant(spec.startLocal, ctx.timeZone);
    end = localToInstant(spec.endLocal, ctx.timeZone);
  } else {
    skipped.nonInterval += 1;
    continue;
  }
  const grain = spec.grain ?? inferGrain(start, end);

  // The accept phrase is the matched temporal span (drops sentence framing
  // like "the gardener aerated the lawn at …").
  const match = parse(c.text, ctx).matches[0];
  if (!match) {
    skipped.unparsable += 1;
    continue;
  }

  const key = `${start.toString()}|${end.toString()}|${grain}|${ctx.now.toString()}|${ctx.timeZone}|${ctx.locale}`;
  if (seen.has(key)) {
    skipped.duplicate += 1;
    continue;
  }
  seen.add(key);

  const value = { interval: { start: start.toString(), end: end.toString(), grain } };
  const d = describe(
    { kind: 'interval', start, end, grain },
    ctx,
  );
  const rev = {
    id: `rev-inv-${c.id}`,
    value,
    ctx: c.ctx,
    primary: d.text,
    accept: [match.text],
    framing: d.framing,
    level: 'core',
    source: { name: 'nl2time', license: 'MIT' },
    tags: ['inverted', `from:${c.id}`],
    note: `inverted from forward case ${c.id}: "${c.text}"`,
  };
  // Self-check: the pin must hold right now.
  const outcome = runReverseCase(rev);
  if (!outcome.pass) {
    skipped.roundtripFail += 1;
    console.warn(`  skip ${c.id}: ${outcome.detail}`);
    continue;
  }
  out.push(rev);
}

writeFileSync(
  outUrl,
  JSON.stringify(
    {
      description:
        'MACHINE-GENERATED from corpus/forward/handauthored-en.json by scripts/invert-corpus.mjs (issue #12) — do not hand-edit; regenerate instead. primary pins current describe() output; accept carries the source temporal phrase (the acceptance class member that provably denotes this value).',
      cases: out,
    },
    null,
    1,
  ) + '\n',
);
console.log(`inverted: ${out.length} reverse cases; skipped:`, skipped);
