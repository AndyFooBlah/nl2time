# Contributing

Thanks for helping out. Bug reports and pull requests are welcome; the notes below are the things that are easy to miss.

## Running the suites

```sh
npm ci && npm run typecheck && npm test && npm run build     # JS: TypeScript reference (~209 tests + corpus baselines)
uv run --project python --extra dev pytest python/tests -q   # Python: engine port (2,782 engine-parity fixtures)
```

CI runs both, plus the fixture-drift gate described below, on every push and pull request. First-time contributors' workflow runs need a maintainer's approval click before they start.

## The engine-parity fixtures (`corpus/ir/`)

`corpus/ir/resolved-*.json` are **machine-generated** from the JS engine and are the Python engine's test suite (`python/tests/test_parity.py` must reproduce them bit-for-bit — instants, grains, candidate order). Never hand-edit them.

- If you change engine semantics (`src/engine/`, `src/ir/`, `src/clock/`, `src/data/`), or a parser change alters what IR a corpus case produces, regenerate:

  ```sh
  npm run fixtures        # builds dist/ and rewrites corpus/ir/
  git diff --stat corpus/ir
  ```

  and commit the fixture changes with your change. CI regenerates the fixtures and fails if `corpus/ir` differs from what the JS engine at your commit produces.
- Every engine-semantics change must be mirrored in `python/nl2time/engine.py` in the same PR, and the Python suite must pass against the regenerated fixtures. The spec both implementations are written against is [docs/ir-spec.md](docs/ir-spec.md) — update it when the contract changes. Full strategy and the three divergence gates: [docs/porting.md](docs/porting.md).
- New behavior should come with a hand-authored corpus case in `corpus/forward/handauthored-en.json` (next `fw-NNNN` id) pinning the phrase; regenerating the fixtures then picks it up automatically.

## Corpus baselines (`corpus/baselines/`)

The imported Recognizers-Text corpora are graded against per-language baseline files. A parser improvement that makes more cases pass should update the baseline (`npm run baselines`); a regression fails the JS suite. Provenance and licenses for imported data are in [corpus/ATTRIBUTIONS.md](corpus/ATTRIBUTIONS.md).

## Pull requests

- Keep engine, parser, and data changes in separate commits where practical; the fixture diff is easiest to review that way.
- Don't bump versions or edit CHANGELOG.md — the maintainer does that at release time and will credit you there.
- AI-assisted contributions are fine; please say so in the PR and make sure a human has reviewed the diff.
