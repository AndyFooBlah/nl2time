# nl2time

Bidirectional natural language ⇄ date/time. Parse expressions like *"last week"* into concrete, timezone- and locale-correct intervals — and describe instants back as *"9pm last night"*. Deterministic core; optional LLM assist that can only ever emit the same symbolic IR the rule parser emits.

```ts
import { TimeContext, parse, resolve, describe, Temporal } from 'nl2time';

const ctx = TimeContext.make({
  now: '2026-07-20T17:00:00Z',        // omit for system time; pass for reproducibility
  timeZone: 'America/Los_Angeles',    // the user's zone, not the machine's
  locale: 'en-US',                    // region matters: week start, date order, …
});

// NL → time -----------------------------------------------------------------
const { matches } = parse('how many shoes did I sell last week', ctx);
resolve(matches[0].expr, ctx).candidates[0];
// { kind: 'interval', start: 2026-07-12T07:00:00Z, end: 2026-07-19T07:00:00Z, grain: 'week' }
// …with locale 'en-GB' the same words give Jul 13 – Jul 20 (Monday week start).

// time → NL -----------------------------------------------------------------
describe(Temporal.Instant.from('2026-07-20T04:00:00Z'), ctx, { style: 'casual' }).text;
// '9pm last night'   (4am UTC Jul 20 = 9pm Jul 19 in LA; today is Jul 20 there)
describe(Temporal.Instant.from('2026-07-20T04:00:00Z'), ctx).text;
// 'yesterday at 9:00 PM'
```

## Why another date library?

Existing tools do one direction, half-way:

- **Parsers** (chrono-node, Duckling, dateparser) collapse text straight to a concrete datetime, losing granularity ("July" is a month, not a millisecond), ambiguity (which "Friday"?), and the week-start question entirely.
- **Formatters** (`Intl.RelativeTimeFormat`, Luxon, timeago) take a pre-computed `(value, unit)` — *you* decide the framing, the unit, and when "23 hours ago" should become "yesterday". Nobody owns that decision.
- **LLMs** are demonstrably bad at raw date arithmetic (leap years, DST, large offsets) but good at language.

nl2time puts a small symbolic IR in the middle of both directions:

```
   text ──parse──►┐                       ┌──◄─select── instant/interval
                  │   TimeExpr (JSON IR)  │
                  └──►─resolve──► value   └──render──► "9pm last night"
```

- **`TimeExpr`** — a JSON operator tree (`now`, `literal`, `offset`, `snap`, `span`, `seek`, `between`, `intersect`, `recur`) over timeline intervals. [Spec](docs/ir-spec.md), [JSON Schema](schema/timeexpr.schema.json).
- **`resolve(expr, ctx)`** — deterministic evaluation against a `TimeContext` (reference instant, IANA timezone, locale, week start, ambiguity policies). Ambiguity is data: candidates come back ordered, never silently guessed.
- **`describe(value, ctx)`** — chooses framing (calendar / elapsed / absolute), builds the IR expression that describes the value, renders it via `Intl`. Round-trip invariant: `resolve(describe(v).expr, ctx)` contains `v`.
- **Everything language refers to is an interval with a grain.** "Last week" is seven days; "9pm" is an hour; "March" is a month.

## The LLM boundary (optional)

nl2time never makes network calls. Rules run first; you can supply a fallback for the long tail, and its output is schema-validated **IR, never concrete dates** — all arithmetic stays deterministic and testable:

```ts
import { parseWithFallback, buildPrompt, irJsonSchema } from 'nl2time/llm';

const result = await parseWithFallback(text, ctx, async (text, ctxSummary) => {
  // call your LLM with buildPrompt(text, ctx) + irJsonSchema() constrained output
  return llmClient.structured(buildPrompt(text, ctx), irJsonSchema());
});
```

See [docs/agents.md](docs/agents.md) for reference architectures (analytics agents, tool-calling, deferred resolution).

## Policy, not guesses

Cultural/ambiguous semantics are explicit `TimeContext` knobs with CLDR-derived defaults:

| Question | Knob | Default |
|---|---|---|
| Does a week start Sunday or Monday? | `weekStart` | CLDR, by locale *region* (en-US: sun, en-GB: mon) |
| Is 5/2 May 2nd or Feb 5th? | `dateOrder` | CLDR-style by region |
| "Friday" — which one? | `bias: 'past' \| 'future' \| 'none'` | `none` (nearest) |
| "Next Tuesday" on a Sunday? | `nextWeekday: 'nearest' \| 'week-after'` | `nearest` |
| Does "last 3 days" include today? | `partialPeriod: 'include' \| 'exclude'` | `include` |
| "At 4" — am or pm? | — | both candidates, plausibility-ordered |

## Status

v0.1 — English parsing, en-* describe, core engine with a DST/edge-case battery. Recurrence (`every Tuesday`) is representable in the IR but resolves in v2.

**Corpus** ([corpus/](corpus/), runner exported as `nl2time/corpus`): a bidirectional golden set with per-case license provenance — 41 hand-authored NL→time cases (all passing), a 65-case datetime→NL golden set (all passing; to our knowledge the first published eval set for humanized time generation), and 693 cases imported from Microsoft Recognizers-Text (MIT) of which 12.6% currently pass — the honest coverage baseline the parser climbs against (`npm run eval`, `npm run baselines`). See [corpus/ATTRIBUTIONS.md](corpus/ATTRIBUTIONS.md) and [docs/porting.md](docs/porting.md).

## Development

```
npm install
npm test          # vitest: conformance fixtures + DST battery + round-trip invariant
npm run typecheck
npm run build
```

MIT.
