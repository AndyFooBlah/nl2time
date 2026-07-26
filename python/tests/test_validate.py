"""Structural validation: validate_expr accepts corpus exprs, rejects garbage."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from nl2time import validate_expr
from nl2time.errors import IRValidationError

FIXTURE_DIR = Path(__file__).resolve().parent.parent.parent / "corpus" / "ir"


def _has_fractional_number(v: Any) -> bool:
    if isinstance(v, float) and not v.is_integer():
        return True
    if isinstance(v, dict):
        return any(_has_fractional_number(x) for x in v.values())
    if isinstance(v, list):
        return any(_has_fractional_number(x) for x in v)
    return False


def test_accepts_every_fixture_expr() -> None:
    checked = 0
    for f in sorted(FIXTURE_DIR.glob("resolved-*.json")):
        for case in json.loads(f.read_text())["cases"]:
            expr = case["expr"]
            # The fixture pipeline records raw parser output, which may carry
            # fractional amounts ("3.5 years") that the structural validator
            # rejects — in JS exactly as here. Skip those, validate the rest.
            if _has_fractional_number(expr):
                continue
            assert validate_expr(expr) is expr
            checked += 1
    assert checked > 2700


@pytest.mark.parametrize(
    "garbage",
    [
        None,
        42,
        "now",
        [],
        {},
        {"op": "nope"},
        {"op": "literal"},  # requires date, time, or dayPeriod
        {"op": "literal", "date": {"month": 13}},
        {"op": "literal", "date": {"day": 0}},
        {"op": "literal", "time": {"meridiem": "noonish"}},
        {"op": "literal", "date": {"month": 5}, "mod": "sideways"},
        {"op": "offset", "base": {"op": "now"}, "amount": "3", "unit": "day"},
        {"op": "offset", "base": {"op": "now"}, "amount": 3, "unit": "fortnight"},
        {"op": "snap", "base": {"op": "now"}, "unit": "week", "edge": "middle"},
        {"op": "span", "anchor": {"op": "now"}, "amount": {}},
        {"op": "span", "anchor": {"op": "now"}, "amount": {"parsecs": 2}},
        {"op": "span", "anchor": {"op": "now"}, "amount": {"days": 3}, "business": "yes"},
        {"op": "between", "start": {"op": "now"}},
        {"op": "seek", "base": {"op": "now"}, "dir": "sideways", "target": {"kind": "unit", "unit": "day"}},
        {"op": "seek", "base": {"op": "now"}, "dir": "next", "target": {"kind": "weekday", "weekday": "funday"}},
        {"op": "seek", "base": {"op": "now"}, "dir": "next", "target": {"kind": "month", "month": 0}},
        {"op": "intersect", "parts": [{"op": "now"}]},
        {"op": "duration", "iso": "90 minutes"},
        {"op": "amount", "amount": {"days": True}},
        {"op": "holiday", "name": "festivus"},
        {"op": "holiday", "name": "easter", "dir": "nearest"},
        {"op": "recur", "every": "instant"},
    ],
)
def test_rejects_garbage(garbage: Any) -> None:
    with pytest.raises(IRValidationError):
        validate_expr(garbage)
