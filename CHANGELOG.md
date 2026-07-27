# Changelog

## 0.3.1 — 2026-07-26

**Benchmark fixes.** Seven conversational-phrase bugs found by the agent-time-bench benchmark ([#17](https://github.com/AndyFooBlah/nl2time/issues/17)–[#22](https://github.com/AndyFooBlah/nl2time/issues/22), [#24](https://github.com/AndyFooBlah/nl2time/issues/24)); no baseline drops in any language.

Engine (semantics — mirrored in Python 0.1.1, parity fixtures regenerated):

- `between` with a day-grain-or-coarser end operand resolves the conversational inclusive reading first ("between July 4th and July 10th" covers the 10th), keeping the strict exclusive-at-start reading as an alternative candidate (#17)
- mod `start` ends at the start of the reference day when the reference falls inside the interval ("earlier this week" on a Thursday reaches through Wednesday), with the plain first half as an alternative (#20)

Parser (English):

- Open-range connectors: "since X" → [start(X), now]; "until / till / through / up to / by X" → [now, end(X)] (#18)
- Cross-midnight clock ranges survive day-shifting anchors: "last night between 11pm and 1am" is Wed 11pm–Thu 1am, no longer clipped at midnight (#19)
- "\<weekday\> before last" seeks two occurrences back; "the week before last" now parses (#21)
- "the weekend of \<date\>" resolves to the actual Sat–Sun weekend (containing, or immediately following for a midweek date); "and \<ordinal\>" conjuncts absorbed (#22)
- "the first/second half of \<period\>" → [start, mid) / [mid, end), a fixed non-reference-clamped split (#24)

New hand-authored corpus cases fw-0051–fw-0065 pin every fixed phrase.

## Python 0.1.1 (PyPI) — 2026-07-26

Engine parity release for 0.3.1: ports the `between` inclusive-first end reading (#17) and the mod `start` reference-day bound (#20). 100% bit-exact parity with the regenerated JS fixtures (2,775 fixtures).

## Python 0.1.0 (PyPI) — 2026-07-26

First Python release: the language-neutral engine — IR validation, `TimeContext`, deterministic `resolve()` — at 100% bit-exact parity with the JS reference (2,760 fixtures). `pip install nl2time`. Parsers/describe not yet ported.

## 0.3.0 — 2026-07-26

**Multilingual parsing.** Six languages, corpus-first, each with a CI-gated conformance baseline against imported [Microsoft Recognizers-Text](https://github.com/microsoft/Recognizers-Text) specs:

| | cases | passing |
|---|---|---|
| English (en-US/en-GB) | 1,031 | 84.3% |
| Spanish | 579 | 96.0% |
| French | 406 | 89.9% |
| German | 157 | 97.5% |
| Japanese | 393 | 95.7% |
| Chinese (Simplified) | 175 | 95.4% |

- Language registry dispatched by the context locale (`SUPPORTED_LANGUAGES`, English fallback)
- `makeLatinRules` lexicon-parameterized factory (exported) for Latin-script languages
- CJK support: per-character tokenization, fullwidth normalization, kanji/hanzi numerals, era years
- French corpus: 231 upstream reference-mismatch artifacts excluded at import (documented in [corpus/ATTRIBUTIONS.md](corpus/ATTRIBUTIONS.md))
- Known engine gaps tracked in [#14](https://github.com/AndyFooBlah/nl2time/issues/14), [#15](https://github.com/AndyFooBlah/nl2time/issues/15)
- `describe()` rendering remains English — localized rendering is the next milestone

## 0.2.0 — 2026-07-26

**Domain packs & corpus tooling.**

- Declarative JSON vocabulary packs: phrase→IR templates with `{n}`/`{yr}` captures, shadowing/`disable` over named built-in rules, `createParser`, per-case packs in the corpus runner ([docs/extending.md](docs/extending.md), worked [fiscal-calendar example](examples/fiscal-july/))
- Corpus inversion: reverse (time→NL) cases mechanically derived from forward cases (reverse corpus 65 → 106)
- English corpus grown to 1,031 imported cases (en-GB + complex-calendar specs)

## 0.1.2 — 2026-07-25

- Fix [#10](https://github.com/AndyFooBlah/nl2time/issues/10): bare hours bind to day-shifting period phrases — "10 last night" → 22:00 on the previous day (was silently dropping the hour)

## 0.1.1 — 2026-07-23

- Fix [#9](https://github.com/AndyFooBlah/nl2time/issues/9): bare hour binds to "this &lt;period&gt;" with a noun-guard ("8 this morning" → 8am; "building 4 this afternoon" keeps the range)

## 0.1.0 — 2026-07-21

Initial release: TimeExpr IR + JSON Schema, deterministic engine on Temporal (ordered ambiguity candidates, DST-correct arithmetic), English parser, `describe()` with calendar/elapsed/absolute framings, LLM adapter (`nl2time/llm`), bidirectional conformance corpus with runner (`nl2time/corpus`).
