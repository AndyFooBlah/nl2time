# Ports: sharing data, preventing divergence (JS ⇄ Python)

## Decision: one repo, two implementations

Both implementations live in this repository — JS at the root (npm `nl2time`), Python under [`python/`](../python/) (PyPI `nl2time`). We considered a separate shared-corpus repo and rejected it for now: a submodule/dependency adds version-skew of exactly the artifact that must never skew. In a monorepo, a change to the IR spec, the corpus, and both implementations is **one atomic commit**, and CI proves both sides against identical fixtures on every push. If a third implementation (or external consumer of the corpus alone) appears, the corpus can be split out then — the layout below is already the clean seam.

## The shared, language-neutral artifacts (normative)

| Artifact | Path | Role |
|---|---|---|
| IR JSON Schema | `schema/timeexpr.schema.json` | the wire format |
| IR semantics | `docs/ir-spec.md` | prose semantics incl. candidate ordering |
| Conformance corpora | `corpus/forward/`, `corpus/reverse/` | behavior spec: (text, ctx) → values; (value, ctx) → text |
| **Engine-parity fixtures** | `corpus/ir/resolved-*.json` | machine-generated (expr, ctx) → candidates from the JS reference — **2,760 fixtures** |
| Locale data | `src/data/` (JSON-able slices) | CLDR week data, day-period rules |
| Domain-pack format | `docs/extending.md` + pack JSON | packs are data; they work unchanged on any port |

## How we avoid divergence (three gates)

1. **Engine parity, exactly.** `scripts/generate-ir-fixtures.mjs` records, for every parseable corpus case, the resolved candidates from the JS reference. The Python engine must reproduce them **bit-for-bit** (instants, grains, candidate order) — its test suite fails otherwise. This decouples engine correctness from parser progress: Python's engine can be 100% conformant while its parsers are still growing.
2. **Shared corpora as the parser spec.** When Python grows parsers, they climb the *same* per-language corpus files with their own baseline files (`corpus/baselines/py-*.json`), using a ported corpus runner with identical comparison semantics (including the documented tolerances). A case passing in one implementation and not the other is visible as a baseline diff, not a mystery.
3. **CI runs both.** The workflow runs the JS suite and the Python suite on every push; the IR fixtures regenerate only via the script, so an engine-semantics change is a reviewed diff of `corpus/ir/`, and Python CI immediately reports whether the port followed.

What is deliberately **not** kept in sync mechanically: rule/parser *implementations*. Grammar code is idiomatic per language runtime; behavior is what's pinned. (The Latin lexicons are near-pure data and may migrate to shared JSON later, which would shrink the Python parser work to the extras.)

## Python implementation plan

- **Time model**: [`whenever`](https://github.com/ariebovenberg/whenever) — Temporal/jiff-inspired, same semantics we rely on (DST-aware calendar arithmetic, `Instant`/`ZonedDateTime`/`Date` mapping per the table below).
- **Order of work**: ① IR types + validator, `TimeContext`, engine `resolve` — **done, 100% parity (2,760/2,760 fixtures, `uv run --project python --extra dev pytest python/tests`)**; ② corpus runner; ③ English parser (climb `imported-recognizers-en.json`); ④ describe (needs Babel for CLDR rendering); ⑤ other languages.
- **Packaging**: `python/pyproject.toml`, PyPI name `nl2time` (verified free). The sdist ships the library only; corpora stay repo-level (dev/test concern).

| JS (Temporal) | Python (whenever) |
|---|---|
| `Temporal.Instant` | `whenever.Instant` |
| `Temporal.ZonedDateTime` | `whenever.ZonedDateTime` |
| `Temporal.PlainDate` | `whenever.Date` |
| calendar `add` w/ DST wall-clock preservation | same semantics |

## Rules the JS implementation follows to stay portable

- **Clock seam**: all Temporal usage lives in `src/clock/`; no other module imports it directly.
- **No `Intl` and no regex in the engine** (`src/engine/`); rendering isolates `Intl` behind describe's render stage (Babel on the Python side).
- Tokenizer regexes are dialect-minimal (character classes/anchors) and port to Python `re` unchanged.
- All policy flows through `TimeContext`; no environment reads outside its defaults.
- Candidate-ordering rules are specified in ir-spec.md prose and pinned by both the corpora and the IR fixtures.
