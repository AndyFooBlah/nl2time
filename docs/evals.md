# Evaluation & conformance corpus plan

> **Status (2026-07-26):** the Recognizers-Text import spans six languages (2,741 gradeable cases; en 84.3%, es 96.0%, fr 89.9%, de 97.5%, ja 95.7%, zh 95.4% — all CI-gated per-language baselines); hand-authored forward + reverse sets pass 100%, plus the machine-inverted reverse set (issue #12) and 2,760 engine-parity IR fixtures (`corpus/ir/`) gating the Python port. Remaining items — Duckling/dateparser/chrono importers, reverse-set expansion, mining pipeline — tracked in [#2](https://github.com/AndyFooBlah/nl2time/issues/2) and [#13](https://github.com/AndyFooBlah/nl2time/issues/13).

Goal: a large, license-clean, language-neutral test corpus covering **both directions**, shared verbatim by every port (JS now, Python later). Every case is JSON:

```
forward:  (text, context) → expected IR and/or expected candidates [{start, end, grain}]
reverse:  (value, context, opts) → expected text (with acceptable-paraphrase classes)
```

## Survey of existing sources (researched 2026-07-21)

### Reusable — vendor into the corpus (all license-compatible with MIT)

| Source | License | ~Cases | Notes |
|---|---|---|---|
| [Microsoft Recognizers-Text](https://github.com/microsoft/Recognizers-Text) `Specs/DateTime/English` | MIT | **4,120** (30 JSON files; 15 language dirs exist) | The single best source. Format is already `(Input, ReferenceDateTime) → TIMEX + resolutions` incl. multi-candidate values. Needs a TIMEX→interval mapping script. |
| [Duckling](https://github.com/facebook/duckling) `Time/EN/Corpus.hs` (+ regional locales, negatives) | BSD | **~1,030** EN + AU/GB/CA/… variants | Values carry explicit `Grain` — the only corpus that tests granularity. Small Haskell-DSL extraction script needed; also has a *negative* corpus (must-not-match). |
| [dateparser](https://github.com/scrapinghub/dateparser) freshness + parser tests | BSD-3 | **~1,570** | Richest pool of *relative* expressions ("2 hours ago", multilingual) with frozen now-times. Python AST extraction. |
| [chrono-node](https://github.com/wanasit/chrono) EN tests | MIT | **~545** | Also valuable as a runtime *diff oracle* (behavioral comparison vs the incumbent). |

### Eval-only — run against, never vendor

- **TempEval-3 Platinum** (138 expert-adjudicated TIMEX3, freely available) — the standard held-out realism check from the academic line of work.
- **WikiWars** (2,681 TIMEX2, research-use terms), **TBAQ/TimeBank** (LDC/gray), **SynTime tweets** (GPL-3).
- **SCATE / SemEval-2018 Task 6**: closest annotation *scheme* to our compositional IR, but standoff annotations without redistributable text — mine the schema ideas, skip the data.
- LLM benchmarks (**Test of Time** CC-BY-4.0, **PRIMETIME** generator, **DateLogicQA**, **TRAM**): QA-shaped, not resolution-anchored; reuse ToT-arithmetic for LLM-fallback regression checks and steal PRIMETIME's *generator* pattern for synthetic edge cases.

### The reverse direction: nothing exists

Confirmed by search: there is **no published eval set for humanized/relative time generation**. Nearest raw material: Humanizer (.NET, MIT) DateTime-humanize tests, moment/Luxon `fromNow`/`toRelative` tests, CLDR relative-pattern data (45+ locales). We author this corpus — it's a genuine contribution.

## What we build (tracked as issues)

1. **Importers** (`scripts/import-*.ts`): Recognizers-Text specs → fixture JSON; Duckling corpus extractor; dateparser AST extractor; chrono diff-oracle harness. Each importer records source+license per case.
2. **Hand-authored policy suites** (~300–600 cases, the part no source covers):
   - week-start variation: same utterance under en-US / en-GB / ar-EG contexts;
   - `nextWeekday`, `partialPeriod`, `bias` knob matrices;
   - DST edges (both hemispheres, gap/overlap times, Kathmandu/Chatham offsets), leap days, ISO-week year boundaries;
   - **ambiguity candidates**: expected ordered candidate *lists* (no existing corpus annotates alternatives; Recognizers' multi-values arrays are the only precedent).
3. **Reverse-direction golden set**: (instant, context, style/framing) → expected text with paraphrase classes (e.g. accept "9pm last night" / "yesterday at 9pm" as one class), seeded from CLDR patterns + Humanizer/moment tests, extended per locale.
4. **Property harness** (exists in `test/roundtrip.test.ts`, to extend): round-trip invariant, snap idempotence, offset composition, DST-stretched interval widths.
5. **LLM-fallback eval**: run the corpus's long tail through `parseWithFallback` with recorded LLM outputs (cassettes) → measures schema-validity rate and IR-accuracy vs golden, without network in CI.

## Metrics

- forward: match rate, first-candidate accuracy, candidate-set recall, grain accuracy; per-locale breakdown.
- reverse: exact/class match rate per (style, framing); round-trip pass rate.
- regression gate in CI: no metric may drop vs `main`.
