# Reference architectures: nl2time with LLM agents

The IR is the contract between probabilistic language understanding and deterministic time arithmetic. These are the five patterns we expect applications to use; all of them share one rule: **the model never emits a concrete date — it emits (or receives) `TimeExpr`, and the engine computes.**

Why: published benchmarks (Test of Time, PRIMETIME, DateLogicQA) show LLMs fail at exactly the operations this library does deterministically — leap-year spans, DST boundaries, large offsets, even date *tokenization*. Meanwhile they are excellent at mapping "the week before last" to symbols. Split the work accordingly.

## 1. Tool-calling agent (the default)

Expose two tools to the model:

```
resolve_time(expr: TimeExpr) -> { candidates: [{start, end, grain}] }
describe_time(instant | interval, opts?) -> { text, expr }
```

The tool schema for `expr` is `irJsonSchema()` — provider structured-output/constrained decoding guarantees well-formed IR, and `validateExpr()` re-checks at the boundary. The system prompt should include the context summary (`ctxSummary(ctx)`): reference instant, user timezone, locale, week start. **Always carry the clock** — never let the model infer "now" from its training prior.

```
User: "how did sales do the week before last?"
  └─ LLM (function call): resolve_time({op:'snap', base:{op:'offset',
       base:{op:'now'}, amount:-2, unit:'week'}, unit:'week'})
       └─ engine → [{start: 2026-07-05T07:00Z, end: 2026-07-12T07:00Z, grain: 'week'}]
  └─ LLM: runs SQL with those bounds, answers.
```

An MCP server wrapping these two tools makes this pattern available to any agent runtime.

## 2. Analytics / NL-to-SQL agent

The "how many shoes did I sell last week" flow, with auditability:

1. `parse()` (rules) or the LLM (IR emission) turns the temporal phrase into `TimeExpr`.
2. `resolve(expr, ctx)` — ctx built from the *requesting user's* timezone + locale profile — yields the interval; inject `[start, end)` into the SQL `WHERE`. Half-open bounds map directly to `>= start AND < end` (never `BETWEEN`).
3. **Echo the interpretation back**: `describe()` the resolved interval (or `render()` the IR) in the response — *"Last week (Jul 12 – Jul 18): 214 shoes"*. Because the en-US and en-GB user get different intervals for the same words, showing the resolution is what makes the ambiguity policy visible and correctable.
4. Log `(utterance, expr, ctx-summary, interval)` — the expr is the audit record; re-running it against the logged context reproduces the query exactly.

## 3. Deferred resolution (saved queries, alerts, scheduled reports)

Store the **IR**, not the resolved dates. A saved report "shoe sales, last week" persists
`{op:'snap', base:{op:'offset', base:{op:'now'}, amount:-1, unit:'week'}, unit:'week'}` and resolves at each run with a fresh `now` — same expression, always the right week. This is also the recurrence story: `{op:'recur', every:'week', ...}` is serializable today (resolution lands in v2), so "every Monday" can already be *stored* symbolically.

Same IR + different context = per-user localization of one saved artifact: resolve with each recipient's timezone/week-start.

## 4. Timestamps → prose in agent responses (the reverse direction)

Any agent that reads timestamped data (logs, messages, DB rows) and talks about it should route every timestamp through `describe()` with the *user's* context rather than letting the model verbalize raw ISO strings:

- deterministic, DST-correct: `2026-07-20T04:00Z` → "9pm last night" for a Pacific user, "5am this morning" for a London user;
- framing policy is configurable and consistent across the whole product, instead of varying with model mood;
- `Description.expr` gives you the symbolic form for logging/round-trip checks.

Practical shape: post-process tool results before they reach the model (attach `display_time` fields), or expose `describe_time` as a tool the model must call.

## 5. Rules-first with LLM fallback (`parseWithFallback`)

For free-text input fields ("remind me a fortnight from Tuesday"):

```
text ──► rule parser ──match?──► IR ──► resolve
              │ no
              └──► your LLM (buildPrompt + irJsonSchema constrained output)
                        └──► validateExpr ──ok?──► IR (source:'llm', lower confidence)
                                  │ invalid
                                  └──► no match (never guess)
```

Properties: the deterministic path handles the common 90% at zero cost/latency; the LLM path is schema-constrained and validated; both paths produce the same IR, so downstream code and golden tests don't care which fired. Cache LLM results keyed on `(normalized text, locale)` — the IR is context-free (that's the point), so the cache never staleness-drifts with the clock.

## Anti-patterns

- **Model emits ISO dates directly** — untestable, DST-wrong, drifts with the model's notion of "today".
- **Resolving at parse time and storing concrete dates for standing queries** — "last week" frozen at save time.
- **One global context** — timezone/week-start are per-user; context construction belongs at the request boundary.
- **Treating candidate lists as noise** — two candidates for "at 4" is the feature; surface a disambiguation question or apply an explicit `bias`, don't `[0]` blindly without deciding to.
