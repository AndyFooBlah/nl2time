"""TimeExpr IR: plain dicts + structural validator (port of src/ir/validate.ts).

The normative spec is schema/timeexpr.schema.json + docs/ir-spec.md. A
TimeExpr is represented as a plain dict (the JSON wire form); validate_expr
checks untrusted input structurally and returns it typed-as-dict.
"""

from __future__ import annotations

from typing import Any

from .errors import IRValidationError

IR_VERSION = 1

GRAINS = [
    "instant",
    "second",
    "minute",
    "hour",
    "day",
    "week",
    "month",
    "quarter",
    "year",
]

UNITS = ["second", "minute", "hour", "day", "week", "month", "quarter", "year"]

WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]

DAY_PERIODS = ["morning", "afternoon", "evening", "night"]

HOLIDAY_NAMES = [
    "black-friday", "earth-day", "st-patricks", "workers-day",
    "new-year", "new-year-eve", "valentines", "easter", "halloween",
    "thanksgiving", "christmas", "christmas-eve", "independence-day",
    "labor-day", "memorial-day", "mothers-day", "fathers-day",
]

_MODS = ["approx", "start", "mid", "end"]
_DIRS = ["next", "prev", "nearest"]
_AMOUNT_FIELDS = ["years", "months", "weeks", "days", "hours", "minutes", "seconds"]

TimeExpr = dict[str, Any]


def _is_int(v: Any) -> bool:
    """Mirror JS `typeof v === 'number' && Number.isInteger(v)` (bools excluded)."""
    if isinstance(v, bool):
        return False
    if isinstance(v, int):
        return True
    return isinstance(v, float) and v.is_integer()


def _require_int(v: Any, path: str) -> None:
    if not _is_int(v):
        raise IRValidationError("expected an integer", path)


def _require_unit(v: Any, path: str) -> None:
    if v not in UNITS:
        raise IRValidationError(f"invalid unit {v!r}", path)


def _validate_target(v: Any, path: str) -> None:
    if not isinstance(v, dict):
        raise IRValidationError("expected a target object", path)
    kind = v.get("kind")
    if kind == "weekday":
        if v.get("weekday") not in WEEKDAYS:
            raise IRValidationError("invalid weekday", f"{path}.weekday")
        return
    if kind == "month":
        _require_int(v.get("month"), f"{path}.month")
        if not 1 <= v["month"] <= 12:
            raise IRValidationError("month out of range", f"{path}.month")
        return
    if kind == "dayPeriod":
        if v.get("period") not in DAY_PERIODS:
            raise IRValidationError("invalid dayPeriod", f"{path}.period")
        return
    if kind == "unit":
        _require_unit(v.get("unit"), f"{path}.unit")
        return
    raise IRValidationError("target kind must be weekday|month|dayPeriod|unit", path)


def _validate_amount(v: Any, path: str) -> None:
    if not isinstance(v, dict):
        raise IRValidationError("expected a calendar amount object", path)
    if not v:
        raise IRValidationError("amount must have at least one field", path)
    for k, val in v.items():
        if k not in _AMOUNT_FIELDS:
            raise IRValidationError(f'unknown field "{k}"', path)
        _require_int(val, f"{path}.{k}")


def _validate_partial_date(v: Any, path: str) -> None:
    if not isinstance(v, dict):
        raise IRValidationError("expected object", path)
    for k in v:
        if k not in ("year", "month", "day"):
            raise IRValidationError(f'unknown field "{k}"', path)
        _require_int(v[k], f"{path}.{k}")
    month = v.get("month")
    if _is_int(month) and not 1 <= month <= 12:
        raise IRValidationError("month out of range", f"{path}.month")
    day = v.get("day")
    if _is_int(day) and not 1 <= day <= 31:
        raise IRValidationError("day out of range", f"{path}.day")


def _validate_partial_time(v: Any, path: str) -> None:
    if not isinstance(v, dict):
        raise IRValidationError("expected object", path)
    for k in v:
        if k not in ("hour", "minute", "second", "meridiem"):
            raise IRValidationError(f'unknown field "{k}"', path)
    for k in ("hour", "minute", "second"):
        if v.get(k) is not None:
            _require_int(v[k], f"{path}.{k}")
    meridiem = v.get("meridiem")
    if meridiem is not None and meridiem not in ("am", "pm", "unknown"):
        raise IRValidationError("meridiem must be am|pm|unknown", f"{path}.meridiem")


def validate_expr(input: Any, path: str = "$") -> TimeExpr:
    """Structural validation of untrusted input into a TimeExpr dict."""
    if not isinstance(input, dict):
        raise IRValidationError("expected an object", path)
    obj = input
    if obj.get("mod") is not None and obj["mod"] not in _MODS:
        raise IRValidationError(f"invalid mod {obj['mod']!r}", path)
    op = obj.get("op")
    if op == "now":
        return obj
    if op == "literal":
        if obj.get("date") is not None:
            _validate_partial_date(obj["date"], f"{path}.date")
        if obj.get("time") is not None:
            _validate_partial_time(obj["time"], f"{path}.time")
        if obj.get("dayPeriod") is not None and obj["dayPeriod"] not in DAY_PERIODS:
            raise IRValidationError("invalid dayPeriod", f"{path}.dayPeriod")
        if obj.get("date") is None and obj.get("time") is None and obj.get("dayPeriod") is None:
            raise IRValidationError("literal requires date, time, or dayPeriod", path)
        return obj
    if op == "offset":
        validate_expr(obj.get("base"), f"{path}.base")
        _require_int(obj.get("amount"), f"{path}.amount")
        _require_unit(obj.get("unit"), f"{path}.unit")
        return obj
    if op == "snap":
        validate_expr(obj.get("base"), f"{path}.base")
        _require_unit(obj.get("unit"), f"{path}.unit")
        if obj.get("edge") is not None and obj["edge"] not in ("start", "end"):
            raise IRValidationError('edge must be "start" or "end"', f"{path}.edge")
        return obj
    if op == "span":
        validate_expr(obj.get("anchor"), f"{path}.anchor")
        _validate_amount(obj.get("amount"), f"{path}.amount")
        if obj.get("business") is not None and not isinstance(obj["business"], bool):
            raise IRValidationError("business must be boolean", f"{path}.business")
        return obj
    if op == "between":
        validate_expr(obj.get("start"), f"{path}.start")
        validate_expr(obj.get("end"), f"{path}.end")
        return obj
    if op == "seek":
        validate_expr(obj.get("base"), f"{path}.base")
        if obj.get("dir") not in _DIRS:
            raise IRValidationError("dir must be next|prev|nearest", f"{path}.dir")
        _validate_target(obj.get("target"), f"{path}.target")
        if obj.get("n") is not None:
            _require_int(obj["n"], f"{path}.n")
        return obj
    if op == "intersect":
        parts = obj.get("parts")
        if not isinstance(parts, list) or len(parts) < 2:
            raise IRValidationError("intersect requires >= 2 parts", f"{path}.parts")
        for i, p in enumerate(parts):
            validate_expr(p, f"{path}.parts[{i}]")
        return obj
    if op == "duration":
        iso = obj.get("iso")
        if not isinstance(iso, str) or not (
            iso.startswith("P") or iso.startswith("-P")
        ):
            raise IRValidationError("duration requires an ISO-8601 string", f"{path}.iso")
        return obj
    if op == "amount":
        _validate_amount(obj.get("amount"), f"{path}.amount")
        return obj
    if op == "holiday":
        if obj.get("name") not in HOLIDAY_NAMES:
            raise IRValidationError(f"unknown holiday {obj.get('name')!r}", f"{path}.name")
        if obj.get("year") is not None:
            _require_int(obj["year"], f"{path}.year")
        if obj.get("dir") is not None and obj["dir"] not in ("prev", "next"):
            raise IRValidationError("dir must be prev|next", f"{path}.dir")
        return obj
    if op == "recur":
        _require_unit(obj.get("every"), f"{path}.every")
        if obj.get("filter") is not None:
            validate_expr(obj["filter"], f"{path}.filter")
        return obj
    raise IRValidationError(f"unknown op {op!r}", path)
