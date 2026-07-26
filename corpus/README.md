# nl2time conformance & evaluation corpus

Golden sets for **both directions**, in one JSON format, shared by tests, evals, and future ports. Licensing and provenance: [ATTRIBUTIONS.md](ATTRIBUTIONS.md).

## Layout

```
corpus/
  forward/handauthored-en.json               NL→time, hand-authored (all `core`)
  forward/imported-recognizers-{lang}.json   NL→time, generated from vendored Recognizers-Text specs
                                             (lang ∈ en, es, fr, de, ja, zh)
  reverse/golden-en.json                     time→NL, hand-authored (novel — no prior dataset exists)
  reverse/inverted-handauthored-en.json      time→NL, machine-inverted from forward cases (issue #12)
  ir/resolved-*.json                         engine-parity fixtures: (expr, ctx) → candidates from the
                                             JS reference (gates the Python port; regenerate, don't edit)
  baselines/forward-imported[-{lang}].json   ids of imported cases that currently pass (CI regression gates)
  vendor/recognizers-text/                   vendored upstream specs + their MIT license (do not edit)
```

## Case format

Executed by the runner exported as **`nl2time/corpus`** (`runForwardCase`, `runReverseCase`, `gradeReverseText`). Ports implement the same runner semantics against these files.

**Forward** — `(text, ctx) → expected resolution`:

```jsonc
{
  "id": "fw-0001",
  "text": "last week",
  "ctx": { "now": "2026-07-20T17:00:00Z", "timeZone": "America/Los_Angeles", "locale": "en-US" },
  "expect": {
    // ordered (hand-authored): candidate i must match spec i
    "first":      { "start": "2026-07-12T07:00:00Z", "end": "...", "grain": "week" },
    "candidates": [ ... ],
    // unordered (imported): every value must appear among resolved candidates
    "values":     [ { "startLocal": "2019-01-04T00:00:00", "endLocal": "...", "grain": "day" } ],
    "amount":          { "minutes": 90 },   // calendar amount
    "durationSeconds": 3600,                // duration equivalence (fixed-unit seconds)
    "noMatch":         true
  },
  "level": "core" | "aspirational",   // core gates CI; aspirational is tracked via baselines
  "source": { "name": "...", "license": "...", "commit": "...", "index": 0 },
  "tags": ["..."]
}
```

`start`/`end` are instants; `startLocal`/`endLocal`/`pointLocal` are civil datetimes compared in the case's `timeZone` (used by imported cases, whose upstream expectations are timezone-agnostic). `grain` omitted/null skips the grain check. Intervals are half-open `[start, end)`. Two comparison tolerances absorb upstream formatting conventions: an expected end of `…:59:59` also matches our half-open end one second later, and a time-range end that textually precedes its start (a cross-midnight range emitted without the date roll) also matches the next-day equivalent.

**Reverse** — `(value, ctx, opts) → expected text`:

```jsonc
{
  "id": "rev-0001",
  "value": { "instant": "2026-07-20T04:00:00Z" },          // or { "interval": {start, end, grain} }
  "ctx": { "now": "...", "timeZone": "...", "locale": "en-US" },
  "opts": { "style": "casual", "framing": "auto" },
  "primary": "9pm last night",   // expected nl2time output (normalized), graded exactly
  "accept": ["yesterday at 9pm"], // additional renderings acceptable when grading OTHER systems
  "framing": "calendar"
}
```

Text comparison normalizes case, NBSP/NNBSP, whitespace, and trailing periods (`normalizeText`). `primary` pins this implementation; `primary + accept` form the acceptance class for grading external systems or LLM output (`gradeReverseText`).

## Workflow

- `npm test` — gates: every `core` case + every baselined imported id must pass.
- `npm run eval` — full pass-rate report by corpus and tag; flags baseline regressions.
- `npm run baselines` — promote newly-passing imported cases after a parser improvement.
- `npm run import:recognizers` — regenerate the imported corpus from the vendored spec (deterministic; commit pinned).
- `node scripts/invert-corpus.mjs` — regenerate the inverted reverse set from the hand-authored forward set: each clean forward case (text, ctx) → interval becomes a reverse case whose `primary` pins current `describe()` output and whose `accept` carries the source phrase (the acceptance-class member that provably denotes the value).

Rendered `primary` strings are pinned to CLDR/ICU behavior of the CI Node version; a CLDR update that changes formatting is a legitimate corpus update, not a code bug (see Hyrum note in the design doc).
