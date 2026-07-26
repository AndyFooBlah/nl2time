# Releasing (trusted publishing — no stored secrets)

Both registries publish automatically from GitHub Actions via OIDC trusted
publishing when a GitHub **release** is published. No tokens are stored
anywhere; each run exchanges a short-lived workflow identity for upload
authorization, and npm provenance attestations are generated automatically.

## How to release

**JS (npm):**
1. Bump `version` in `package.json` (root) + add a CHANGELOG entry; commit.
2. `git tag vX.Y.Z && git push origin vX.Y.Z`
3. `gh release create vX.Y.Z --title ... --notes ...`
4. The `npm` job in `.github/workflows/release.yml` runs the full test suite,
   verifies the tag matches `package.json`, and publishes.

**Python (PyPI):**
1. Bump `version` in `python/pyproject.toml` + CHANGELOG entry; commit.
2. `git tag py-vX.Y.Z && git push origin py-vX.Y.Z`
3. `gh release create py-vX.Y.Z --title ... --notes ...`
4. The `pypi` job runs the parity suite, verifies the tag matches
   `pyproject.toml`, builds sdist+wheel with uv, and publishes via
   `pypa/gh-action-pypi-publish`.

A tag/version mismatch fails the guard step before any publish.

## One-time registration (already-configured values)

Both registries must be told, once, to trust this workflow. All fields are
case-sensitive and must match exactly.

**PyPI** — pypi.org → Your projects → `nl2time` → Manage → **Publishing** →
add a GitHub publisher:

| Field | Value |
|---|---|
| Owner | `AndyFooBlah` |
| Repository name | `nl2time` |
| Workflow name | `release.yml` |
| Environment name | `pypi` |

**npm** — npmjs.com → package `nl2time` → Settings → **Trusted Publisher** →
GitHub Actions:

| Field | Value |
|---|---|
| Organization or user | `AndyFooBlah` |
| Repository | `nl2time` |
| Workflow filename | `release.yml` |
| Environment name | `npm` |
| Allowed actions | `npm publish` |

The `npm` and `pypi` GitHub environments already exist on the repo; optional
hardening: add a required-reviewer protection rule to each (Settings →
Environments) so every publish needs a manual approval click.

After registering, delete any long-lived registry tokens — they're no longer
needed.
