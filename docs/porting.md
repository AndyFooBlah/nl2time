# Porting nl2time (Python next)

Three artifacts are language-neutral and normative — ports implement against them, not against the JS source:

1. **The IR spec**: [`schema/timeexpr.schema.json`](../schema/timeexpr.schema.json) + [`docs/ir-spec.md`](ir-spec.md) (operator semantics).
2. **Locale data**: generated JSON slices of CLDR (week data, day-period rules) in `src/data/` — to be emitted by the CLDR generator script as shared JSON consumed by every port.
3. **The conformance corpus**: `test/fixtures/*.json`. A port is correct when it passes the corpus.

## Rules the JS implementation follows to stay portable

- **Clock seam**: all Temporal usage lives in `src/clock/`. Type mapping for Python is the [`whenever`](https://github.com/ariebovenberg/whenever) library (Temporal/jiff-inspired):

  | JS (Temporal) | Python (whenever) |
  |---|---|
  | `Temporal.Instant` | `whenever.Instant` |
  | `Temporal.ZonedDateTime` | `whenever.ZonedDateTime` |
  | `Temporal.PlainDate` | `whenever.Date` |
  | calendar `add` w/ DST wall-clock preservation | same semantics in whenever |

  Fallback without whenever: `datetime` + `zoneinfo` + `dateutil.relativedelta`, but DST disambiguation and calendar arithmetic must then be reimplemented carefully — prefer whenever.
- **No `Intl` and no regex in the engine or selector** (`src/engine/`, describe stage 1). Rendering (describe stage 2) uses `Intl`; Python uses Babel for the same CLDR data.
- **Tokenizer regexes are dialect-minimal** (character classes/anchors only) and port to Python `re` unchanged; rule matching above the tokenizer is table-driven.
- **All policy flows through `TimeContext`** — no environment reads outside `TimeContext.make` defaults (system now / system timezone).
- Candidate ordering rules (bias, meridiem plausibility, nearest-first) are specified in ir-spec.md prose and pinned by fixtures — ports must reproduce ordering exactly.
