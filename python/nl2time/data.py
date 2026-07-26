"""Locale data tables: CLDR weekData slice and day-period boundary rules.

Direct port of src/data/weekData.ts and src/data/dayPeriods.ts from the JS
reference. Keep in sync; these are near-pure data.
"""

from __future__ import annotations

from typing import TypedDict

DEFAULT_FIRST_DAY = "mon"

_SUN = frozenset([
    "AG", "AS", "BD", "BR", "BS", "BT", "BW", "BZ", "CA", "CO", "DM", "DO", "ET",
    "GT", "GU", "HK", "HN", "ID", "IL", "IN", "JM", "JP", "KE", "KH", "KR", "LA",
    "MH", "MM", "MO", "MT", "MX", "MZ", "NI", "NP", "PA", "PE", "PH", "PK", "PR",
    "PT", "PY", "SA", "SG", "SV", "TH", "TT", "TW", "UM", "US", "VE", "VI", "WS",
    "YE", "ZA", "ZW",
])

_SAT = frozenset([
    "AE", "AF", "BH", "DJ", "DZ", "EG", "IQ", "IR", "JO", "KW", "LY", "OM", "QA",
    "SD", "SY",
])

_FRI = frozenset(["MV"])


def first_day_for_region(region: str | None) -> str:
    if not region:
        return DEFAULT_FIRST_DAY
    r = region.upper()
    if r in _SUN:
        return "sun"
    if r in _SAT:
        return "sat"
    if r in _FRI:
        return "fri"
    return DEFAULT_FIRST_DAY


class DayPeriodRule(TypedDict):
    """Boundaries are [from, before) in local hours; may wrap midnight."""

    period: str
    from_: int  # start hour (inclusive); key name avoids the Python keyword
    before: int  # end hour (exclusive); may be < from_ (wraps midnight)


# CLDR flexible day-period rules, English set (v1 ships en only; other
# languages fall back to these boundaries, mirroring the JS reference).
EN_RULES: list[DayPeriodRule] = [
    {"period": "morning", "from_": 6, "before": 12},
    {"period": "afternoon", "from_": 12, "before": 18},
    {"period": "evening", "from_": 18, "before": 21},
    {"period": "night", "from_": 21, "before": 6},
]


def day_period_rules(language: str) -> list[DayPeriodRule]:
    # Only 'en' data is bundled so far; other languages fall back (see JS ref).
    del language
    return EN_RULES


def period_for_hour(language: str, hour: int) -> str:
    for rule in day_period_rules(language):
        if rule["from_"] < rule["before"]:
            if rule["from_"] <= hour < rule["before"]:
                return rule["period"]
        elif hour >= rule["from_"] or hour < rule["before"]:
            return rule["period"]
    return "night"
