# Corpus attributions & licensing

All corpus content is redistributable under licenses compatible with this repository's MIT license. Every imported case carries machine-readable provenance in its `source` field (upstream name, license, file path, commit, index).

## microsoft/Recognizers-Text — MIT

- **What**: `corpus/vendor/recognizers-text/DateTimeModel.json` is vendored verbatim from
  [microsoft/Recognizers-Text](https://github.com/microsoft/Recognizers-Text),
  `Specs/DateTime/English/DateTimeModel.json` at commit
  [`da7edcff`](https://github.com/microsoft/Recognizers-Text/tree/da7edcff59f669b2a460ab9d400e36298f0d658e).
  `corpus/forward/imported-recognizers-en.json` is mechanically derived from it by
  `scripts/import-recognizers.mjs`.
- **License**: MIT, Copyright (c) Microsoft Corporation. Full text vendored alongside the data at
  [`vendor/recognizers-text/LICENSE`](vendor/recognizers-text/LICENSE), satisfying the MIT
  notice-retention requirement.
- Planned additional imports from the same source (other English spec files, `EnglishOthers`
  en-GB variants) fall under the same terms.

## Hand-authored nl2time cases — MIT

`corpus/forward/handauthored-en.json` and `corpus/reverse/golden-en.json` are original works of
the nl2time contributors, licensed under this repository's [MIT license](../LICENSE). The reverse
(datetime→NL) golden set is, to our knowledge, the first published evaluation set for humanized
time *generation*; upstream survey notes in [docs/evals.md](../docs/evals.md).

## Planned imports (not yet vendored)

Tracked in [issue #2](https://github.com/AndyFooBlah/nl2time/issues/2); licenses verified in advance:

- **facebook/duckling** corpus tests — BSD-style license; will vendor its LICENSE beside extracted data.
- **scrapinghub/dateparser** test parameters — BSD-3-Clause; same treatment.
- **wanasit/chrono** test cases — MIT; used primarily as a runtime diff oracle.

## Deliberately excluded (license or redistribution constraints)

- LDC TimeBank / TBAQ (LDC agreement; redistribution restricted) — not used.
- TempEval-3 Platinum, WikiWars — freely downloadable for research; used only as **eval-only**
  external checks, never vendored into this repository.
- SynTime tweets corpus (GPL-3.0) — incompatible with MIT vendoring; not used.
- SCATE/THYME annotations (ODbL + data-use agreements) — schema ideas only, no data.
