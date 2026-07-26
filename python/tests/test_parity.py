"""Engine-parity suite: reproduce corpus/ir/resolved-*.json bit-for-bit.

Each fixture is (expr, ctx) -> candidates recorded from the JS reference
implementation. The Python engine must match exactly: instants, grains, and
candidate order (docs/porting.md gate 1).
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from nl2time import TimeContext, resolve, value_to_json

FIXTURE_DIR = Path(__file__).resolve().parent.parent.parent / "corpus" / "ir"

FIXTURE_FILES = sorted(FIXTURE_DIR.glob("resolved-*.json"))


def _load_cases() -> list[pytest.param]:
    params: list[pytest.param] = []
    for f in FIXTURE_FILES:
        data = json.loads(f.read_text())
        for case in data["cases"]:
            params.append(pytest.param(case, id=f"{f.stem}:{case['id']}"))
    return params


CASES = _load_cases()


def test_fixtures_present() -> None:
    assert len(CASES) > 2000, "expected the full engine-parity corpus"


@pytest.mark.parametrize("case", CASES)
def test_engine_parity(case: dict) -> None:
    # Note: resolve the raw expr without validate_expr — the fixture pipeline
    # records parser output directly, which may contain values the structural
    # validator rejects (e.g. fractional calendar amounts), exactly as in JS.
    ctx = TimeContext.make(case["ctx"])
    got = [value_to_json(v) for v in resolve(case["expr"], ctx)["candidates"]]
    assert got == case["candidates"]
