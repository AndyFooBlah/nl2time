"""The deterministic engine: resolve(expr, ctx) -> ordered candidates.

Line-for-line port of src/engine/resolve.ts (the JS reference is normative,
including its quirks). See docs/ir-spec.md for prose semantics.
"""

from __future__ import annotations

from typing import Any, Callable

from whenever import ZonedDateTime

from .clock import (
    ZInterval,
    add_calendar,
    add_milliseconds,
    add_units,
    calendar_days_between,
    compare,
    containing_unit,
    epoch_millis,
    floor_to,
    format_instant,
    point_interval,
    weekday_number,
    with_fields,
)
from .context import TimeContext
from .data import day_period_rules
from .errors import AmbiguityError, NotResolvableError

GRAIN_ORDER = [
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

_GI = {g: i for i, g in enumerate(GRAIN_ORDER)}
_DAY_I = _GI["day"]

MAX_CANDIDATES = 8

# A candidate is a dict:
#   {"type": "interval", "zi": ZInterval}
#   {"type": "duration", "iso": str}
#   {"type": "amount", "amount": dict}
Cand = dict[str, Any]

# A resolved value (TimeValue) is a dict:
#   {"kind": "interval", "start": Instant, "end": Instant, "grain": str}
#   {"kind": "duration", "iso": str}
#   {"kind": "amount", "amount": dict}
TimeValue = dict[str, Any]


def _finer_grain(a: str, b: str) -> str:
    return a if _GI[a] <= _GI[b] else b


def resolve(expr: dict[str, Any], ctx: TimeContext) -> dict[str, Any]:
    """Resolve to `{"candidates": [TimeValue, ...]}`, ordered best-first."""
    cands = _eval_expr(expr, ctx, None)[:MAX_CANDIDATES]
    return {"candidates": [_to_value(c) for c in cands]}


def resolve_one(expr: dict[str, Any], ctx: TimeContext) -> TimeValue:
    """First candidate under policy, or raise AmbiguityError."""
    candidates = resolve(expr, ctx)["candidates"]
    if not candidates:
        raise AmbiguityError("expression produced no candidates")
    return candidates[0]


def value_to_json(v: TimeValue) -> dict[str, Any]:
    """Serialize a TimeValue the way the fixture generator does."""
    if v["kind"] == "interval":
        return {
            "kind": "interval",
            "start": format_instant(v["start"]),
            "end": format_instant(v["end"]),
            "grain": v["grain"],
        }
    return v


def _to_value(c: Cand) -> TimeValue:
    if c["type"] == "interval":
        zi: ZInterval = c["zi"]
        return {
            "kind": "interval",
            "start": zi.start.to_instant(),
            "end": zi.end.to_instant(),
            "grain": zi.grain,
        }
    if c["type"] == "duration":
        return {"kind": "duration", "iso": c["iso"]}
    return {"kind": "amount", "amount": c["amount"]}


def _interval_map(cands: list[Cand], f: Callable[[ZInterval], ZInterval]) -> list[Cand]:
    return [
        {"type": "interval", "zi": f(c["zi"])} if c["type"] == "interval" else c
        for c in cands
    ]


def _intersect_intervals(a: ZInterval, b: ZInterval) -> ZInterval | None:
    # Point intervals (grain 'instant') act as points-in-time; containment check.
    start = a.start if compare(a.start, b.start) >= 0 else b.start
    end = a.end if compare(a.end, b.end) <= 0 else b.end
    if compare(start, end) > 0:
        return None
    if compare(start, end) == 0 and a.grain != "instant" and b.grain != "instant":
        return None
    return ZInterval(start, end, _finer_grain(a.grain, b.grain))


def _eval_expr(
    expr: dict[str, Any], ctx: TimeContext, anchor: ZInterval | None
) -> list[Cand]:
    cands = _eval_expr_inner(expr, ctx, anchor)
    mod = expr.get("mod")
    # mod 'start'/'end' narrow an interval to its first/second half ("early
    # July", "later this week"). Mid-points floor to the day for week+ grains
    # (year to the month), and when the reference day falls inside the
    # interval it tightens the bound ("earlier this year" ends today).
    if mod in ("start", "end"):

        def narrow(zi: ZInterval) -> ZInterval:
            if zi.grain == "instant":
                return zi
            total_ms = epoch_millis(zi.end) - epoch_millis(zi.start)
            mid = add_milliseconds(zi.start, total_ms // 2)
            gi = _GI[zi.grain]
            if zi.grain == "year":
                mid = floor_to(mid, "month", ctx.week_start)
            elif gi > _DAY_I:
                mid = floor_to(mid, "day", ctx.week_start)

            bound = mid
            if gi > _DAY_I:
                ref_day = floor_to(ctx.zoned_now, "day", ctx.week_start)
                in_range = compare(ref_day, zi.start) > 0 and compare(ref_day, zi.end) < 0
                if in_range:
                    if mod == "start":
                        bound = ref_day if compare(ref_day, mid) < 0 else mid
                    else:
                        bound = ref_day if compare(ref_day, mid) > 0 else mid
            if mod == "start":
                narrowed = ZInterval(zi.start, bound, zi.grain)
            else:
                narrowed = ZInterval(bound, zi.end, zi.grain)
            # A degenerate clamp (bound at an edge) falls back to the plain half.
            if compare(narrowed.start, narrowed.end) >= 0:
                if mod == "start":
                    return ZInterval(zi.start, mid, zi.grain)
                return ZInterval(mid, zi.end, zi.grain)
            return narrowed

        return _interval_map(cands, narrow)
    # mod 'mid': the middle stretch. mid-month = the 10th through the 20th;
    # mid-day = 10:00-14:00; otherwise the middle half of the interval.
    if mod == "mid":

        def middle(zi: ZInterval) -> ZInterval:
            if zi.grain == "month":
                return ZInterval(
                    add_calendar(zi.start, days=9),
                    add_calendar(zi.start, days=20),
                    "day",
                )
            if zi.grain == "day":
                return ZInterval(
                    zi.start.add(hours=10), zi.start.add(hours=14), "hour"
                )
            total_ms = epoch_millis(zi.end) - epoch_millis(zi.start)
            return ZInterval(
                add_milliseconds(zi.start, total_ms // 4),
                add_milliseconds(zi.start, (3 * total_ms) // 4),
                zi.grain,
            )

        return _interval_map(cands, middle)
    return cands


def _eval_expr_inner(
    expr: dict[str, Any], ctx: TimeContext, anchor: ZInterval | None
) -> list[Cand]:
    op = expr["op"]

    if op == "now":
        return [{"type": "interval", "zi": point_interval(ctx.zoned_now)}]

    if op == "literal":
        return _eval_literal(expr, ctx, anchor)

    if op == "offset":
        return _interval_map(
            _eval_expr(expr["base"], ctx, anchor),
            lambda zi: ZInterval(
                add_units(zi.start, expr["unit"], expr["amount"]),
                add_units(zi.end, expr["unit"], expr["amount"]),
                zi.grain,
            ),
        )

    if op == "snap":

        def snap(zi: ZInterval) -> ZInterval:
            unit = containing_unit(zi.start, expr["unit"], ctx.week_start)
            if expr.get("edge") == "start":
                return point_interval(unit.start)
            if expr.get("edge") == "end":
                return point_interval(unit.end)
            return unit

        return _interval_map(_eval_expr(expr["base"], ctx, anchor), snap)

    if op == "span":
        return _interval_map(
            _eval_expr(expr["anchor"], ctx, anchor),
            lambda zi: _eval_business_span(zi, expr["amount"], ctx)
            if expr.get("business")
            else _eval_span(zi, expr["amount"], ctx),
        )

    if op == "between":
        starts = _eval_expr(expr["start"], ctx, anchor)
        out: list[Cand] = []
        for s in starts:
            if s["type"] != "interval":
                continue
            s_zi: ZInterval = s["zi"]
            # The end operand resolves anchored to the start (shared context:
            # "between 3 and 12 of Sept" — the 3 anchors to September).
            for e in _eval_expr(expr["end"], ctx, s_zi):
                if e["type"] != "interval":
                    continue
                e_zi: ZInterval = e["zi"]
                is_point = compare(e_zi.start, e_zi.end) == 0
                time_grained = _GI[e_zi.grain] < _DAY_I
                # Day-grain-or-coarser ends are conversationally inclusive:
                # "between July 4th and July 10th" covers the 10th. Emit the
                # inclusive reading (end operand contributes its END) first,
                # with the strict exclusive-at-start reading as an
                # alternative — the Recognizers-derived corpus pins the
                # exclusive value, so both must remain candidates (#17).
                if not is_point and not time_grained:
                    grain = _finer_grain(s_zi.grain, e_zi.grain)
                    if compare(s_zi.start, e_zi.end) < 0:
                        out.append(
                            {
                                "type": "interval",
                                "zi": ZInterval(s_zi.start, e_zi.end, grain),
                            }
                        )
                    if compare(s_zi.start, e_zi.start) < 0:
                        out.append(
                            {
                                "type": "interval",
                                "zi": ZInterval(s_zi.start, e_zi.start, grain),
                            }
                        )
                    continue
                # Non-point time ends are exclusive at their *start* ("9 to
                # 5pm" ends at 17:00); point ends are used directly.
                end_point = e_zi.end if is_point else e_zi.start
                if compare(s_zi.start, end_point) >= 0:
                    # A clock-time range wrapping midnight ("9:30pm to
                    # 7:30am") rolls the end into the next day; date ranges
                    # just drop.
                    if not time_grained:
                        continue
                    end_point = add_calendar(end_point, days=1)
                    if compare(s_zi.start, end_point) >= 0:
                        continue
                out.append(
                    {
                        "type": "interval",
                        "zi": ZInterval(
                            s_zi.start,
                            end_point,
                            _finer_grain(s_zi.grain, e_zi.grain),
                        ),
                    }
                )
        return out

    if op == "seek":
        return _eval_seek(expr, ctx, anchor)

    if op == "intersect":
        # Left-to-right: each part is evaluated with the accumulated interval
        # as its anchor. Time-of-day parts COMPOSE onto the anchor day; parts
        # that carry their own date CONSTRAIN by interval intersection.
        parts = expr["parts"]
        acc = _eval_expr(parts[0], ctx, anchor)
        for part in parts[1:]:
            part_is_time_of_day = _is_time_of_day_part(part)
            nxt: list[Cand] = []
            for a in acc:
                if a["type"] != "interval":
                    continue
                a_zi: ZInterval = a["zi"]
                # Clock times always compose onto the anchor's day ("tonight
                # at 1am" escapes the night window). Day-period parts compose
                # only onto day-or-coarser anchors; onto an already
                # time-refined interval they constrain.
                composes = part_is_time_of_day and (
                    _is_clock_part(part) or _GI[a_zi.grain] >= _DAY_I
                )
                for b in _eval_expr(part, ctx, a_zi):
                    if b["type"] != "interval":
                        continue
                    if composes:
                        nxt.append(b)
                        continue
                    zi = _intersect_intervals(a_zi, b["zi"])
                    if zi is not None:
                        nxt.append({"type": "interval", "zi": zi})
            acc = nxt
        return acc

    if op == "duration":
        return [{"type": "duration", "iso": expr["iso"]}]

    if op == "amount":
        return [{"type": "amount", "amount": expr["amount"]}]

    if op == "holiday":
        return _eval_holiday(expr, ctx)

    if op == "recur":
        raise NotResolvableError(
            "recurrence expressions are representable in v1 but not yet "
            "resolvable (planned for v2)"
        )

    raise NotResolvableError(f"unknown op {op!r}")


def _is_clock_part(expr: dict[str, Any]) -> bool:
    """A literal clock reading (no date of its own)."""
    return (
        expr["op"] == "literal"
        and expr.get("date") is None
        and expr.get("time") is not None
    )


def _is_time_of_day_part(expr: dict[str, Any]) -> bool:
    """A part naming a time within a day rather than a day: composes onto anchor."""
    if expr["op"] == "literal":
        return expr.get("date") is None and (
            expr.get("time") is not None or expr.get("dayPeriod") is not None
        )
    if expr["op"] == "seek":
        return expr["target"]["kind"] == "dayPeriod"
    return False


# ---------------------------------------------------------------------------
# span
# ---------------------------------------------------------------------------


def _smallest_unit_of(amount: dict[str, Any]) -> str:
    if amount.get("seconds"):
        return "second"
    if amount.get("minutes"):
        return "minute"
    if amount.get("hours"):
        return "hour"
    if amount.get("days"):
        return "day"
    if amount.get("weeks"):
        return "week"
    if amount.get("months"):
        return "month"
    return "year"


def _add_amount(z: ZonedDateTime, amount: dict[str, Any], factor: int) -> ZonedDateTime:
    scaled = {
        k: v * factor
        for k, v in amount.items()
        if isinstance(v, (int, float)) and not isinstance(v, bool) and v != 0
    }
    if not scaled:
        return z
    # Non-integer amounts raise (Temporal throws on fractional durations too).
    return add_calendar(z, **scaled)


def _eval_span(anchor_zi: ZInterval, amount: dict[str, Any], ctx: TimeContext) -> ZInterval:
    negative = any(
        isinstance(v, (int, float)) and not isinstance(v, bool) and v < 0
        for v in amount.values()
    )
    unit = _smallest_unit_of(amount)
    coarse = _GI[unit] >= _DAY_I

    anchor_point = anchor_zi.end if negative else anchor_zi.start
    # Complete-periods policy: "the last 3 days" ends at today's start; "the
    # next 3 days" begins at tomorrow's start. Applies only to spans anchored
    # at the reference instant itself.
    if (
        ctx.partial_period == "exclude"
        and anchor_zi.grain == "instant"
        and compare(anchor_point, ctx.zoned_now) == 0
        and coarse
    ):
        anchor_point = floor_to(anchor_point, "day", ctx.week_start)
        if not negative:
            anchor_point = add_calendar(anchor_point, days=1)

    other = _add_amount(anchor_point, amount, 1)
    if compare(anchor_point, other) <= 0:
        start, end = anchor_point, other
    else:
        start, end = other, anchor_point
    return ZInterval(start, end, unit)


def _eval_business_span(
    anchor_zi: ZInterval, amount: dict[str, Any], ctx: TimeContext
) -> ZInterval:
    """Business-day span: counts weekdays only, from the day after/before the anchor."""
    n = amount.get("days") or 0
    negative = n < 0
    day = floor_to(anchor_zi.end if negative else anchor_zi.start, "day", ctx.week_start)
    step = -1 if negative else 1
    first: ZonedDateTime | None = None
    last: ZonedDateTime | None = None
    remaining = abs(n)
    while remaining > 0:
        day = add_calendar(day, days=step)
        if day.date().day_of_week().value >= 6:
            continue
        if first is None:
            first = day
        last = day
        remaining -= 1
    assert first is not None and last is not None
    if negative:
        start, end = last, add_calendar(first, days=1)
    else:
        start, end = first, add_calendar(last, days=1)
    return ZInterval(start, end, "day")


# ---------------------------------------------------------------------------
# seek
# ---------------------------------------------------------------------------


def _eval_seek(
    expr: dict[str, Any], ctx: TimeContext, anchor: ZInterval | None
) -> list[Cand]:
    bases = _eval_expr(expr["base"], ctx, anchor)
    out: list[Cand] = []
    for b in bases:
        if b["type"] != "interval":
            continue
        b_zi: ZInterval = b["zi"]
        # A bare weekday ("Friday", dir nearest, from a point) is genuinely
        # ambiguous: produce both directions, bias-ordered.
        if (
            expr["dir"] == "nearest"
            and expr["target"]["kind"] == "weekday"
            and b_zi.grain in ("instant", "day")
        ):
            # Strict adjacent occurrences (n: 1) — the dialect policy is for
            # explicit "next X"/"last X", not for a bare weekday.
            fwd = _seek_from(b_zi, {**expr, "dir": "next", "n": 1}, ctx)
            back = _seek_from(b_zi, {**expr, "dir": "prev", "n": 1}, ctx)
            ordered = [back, fwd] if ctx.bias == "past" else [fwd, back]
            for zi in ordered:
                if zi is not None:
                    out.append({"type": "interval", "zi": zi})
            continue
        zi = _seek_from(b_zi, expr, ctx)
        if zi is not None:
            out.append({"type": "interval", "zi": zi})
    return out


def _seek_from(
    base: ZInterval, expr: dict[str, Any], ctx: TimeContext
) -> ZInterval | None:
    t = expr["target"]
    kind = t["kind"]
    if kind == "weekday":
        target = weekday_number(t["weekday"])
        n = expr.get("n") if expr.get("n") is not None else 1
        if base.grain != "instant" and _GI[base.grain] > _DAY_I:
            # "the 2nd Monday of March": nth occurrence inside the base interval.
            day = floor_to(base.start, "day", ctx.week_start)
            delta = (target - day.date().day_of_week().value + 7) % 7
            day = add_calendar(day, days=delta + 7 * (n - 1))
            if compare(day, base.end) >= 0:
                return None
            return ZInterval(day, add_calendar(day, days=1), "day")
        # Deictic navigation from a point/day ("next Tuesday").
        today = floor_to(base.start, "day", ctx.week_start)
        dow = today.date().day_of_week().value
        # The nextWeekday dialect policy applies only to bare "next/last
        # <weekday>"; an explicit n means strict occurrence counting.
        use_policy = ctx.next_weekday == "week-after" and expr.get("n") is None
        if expr["dir"] == "next":
            if use_policy:
                week_start_day = floor_to(
                    add_calendar(today, days=7), "week", ctx.week_start
                )
                delta = (target - week_start_day.date().day_of_week().value + 7) % 7
                day = add_calendar(week_start_day, days=delta)
            else:
                delta = ((target - dow + 6) % 7) + 1  # strictly after today
                day = add_calendar(today, days=delta + 7 * (n - 1))
        elif expr["dir"] == "prev":
            if use_policy:
                # Symmetric dialect: "last Tuesday" = Tuesday of previous week.
                week_start_day = floor_to(
                    add_calendar(today, days=-7), "week", ctx.week_start
                )
                delta = (target - week_start_day.date().day_of_week().value + 7) % 7
                day = add_calendar(week_start_day, days=delta)
            else:
                delta = ((dow - target + 6) % 7) + 1  # strictly before today
                day = add_calendar(today, days=-(delta + 7 * (n - 1)))
        else:
            # 'nearest': bias decides; 'none' behaves like future.
            forward_delta = ((target - dow + 6) % 7) + 1
            back_delta = ((dow - target + 6) % 7) + 1
            if ctx.bias == "past":
                day = add_calendar(today, days=-back_delta)
            else:
                day = add_calendar(today, days=forward_delta)
        return ZInterval(day, add_calendar(day, days=1), "day")
    if kind == "month":
        ref_year_start = floor_to(base.start, "year", ctx.week_start)
        m = with_fields(ref_year_start, month=t["month"])
        cmp = compare(m, base.start)
        if expr["dir"] == "next" and cmp <= 0:
            m = add_calendar(m, years=1)
        if expr["dir"] == "prev" and cmp >= 0:
            m = add_calendar(m, years=-1)
        start = floor_to(m, "month", ctx.week_start)
        return ZInterval(start, add_units(start, "month", 1), "month")
    if kind == "dayPeriod":
        return day_period_interval(base, t["period"], ctx)
    if kind == "unit":
        cur = containing_unit(base.start, t["unit"], ctx.week_start)
        n = expr.get("n") if expr.get("n") is not None else 1
        shift = n if expr["dir"] == "next" else (-n if expr["dir"] == "prev" else 0)
        return ZInterval(
            add_units(cur.start, t["unit"], shift),
            add_units(cur.end, t["unit"], shift),
            t["unit"],
        )
    return None


def day_period_interval(
    base: ZInterval, period: str, ctx: TimeContext
) -> ZInterval | None:
    """The day-period interval within (anchored to) the day of `base`."""
    rules = ctx.day_periods if ctx.day_periods is not None else day_period_rules(ctx.language)
    rule = next((r for r in rules if r["period"] == period), None)
    if rule is None:
        return None
    day = floor_to(base.start, "day", ctx.week_start)
    start = day.add(hours=rule["from_"])
    if rule["before"] > rule["from_"]:
        end = day.add(hours=rule["before"])
    else:
        end = add_calendar(day, days=1).add(hours=rule["before"])
    return ZInterval(start, end, "hour")


# ---------------------------------------------------------------------------
# holidays
# ---------------------------------------------------------------------------

_HOLIDAYS: dict[str, dict[str, Any]] = {
    "earth-day": {"kind": "fixed", "month": 4, "day": 22},
    "st-patricks": {"kind": "fixed", "month": 3, "day": 17},
    "workers-day": {"kind": "fixed", "month": 5, "day": 1},
    "new-year": {"kind": "fixed", "month": 1, "day": 1},
    "new-year-eve": {"kind": "fixed", "month": 12, "day": 31},
    "valentines": {"kind": "fixed", "month": 2, "day": 14},
    "halloween": {"kind": "fixed", "month": 10, "day": 31},
    "christmas": {"kind": "fixed", "month": 12, "day": 25},
    "christmas-eve": {"kind": "fixed", "month": 12, "day": 24},
    "independence-day": {"kind": "fixed", "month": 7, "day": 4},
    "thanksgiving": {"kind": "nth-weekday", "month": 11, "weekday": 4, "n": 4},
    "labor-day": {"kind": "nth-weekday", "month": 9, "weekday": 1, "n": 1},
    "mothers-day": {"kind": "nth-weekday", "month": 5, "weekday": 7, "n": 2},
    "fathers-day": {"kind": "nth-weekday", "month": 6, "weekday": 7, "n": 3},
    "memorial-day": {"kind": "last-weekday", "month": 5, "weekday": 1},
    "easter": {"kind": "easter"},
}


def _easter_date(year: int) -> tuple[int, int]:
    """Anonymous Gregorian computus. Returns (month, day)."""
    a = year % 19
    b = year // 100
    c = year % 100
    d = b // 4
    e = b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i = c // 4
    k = c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    month = (h + l - 7 * m + 114) // 31
    day = ((h + l - 7 * m + 114) % 31) + 1
    return month, day


def _holiday_day(name: str, year: int, ctx: TimeContext) -> ZonedDateTime:
    if name == "black-friday":
        return add_calendar(_holiday_day("thanksgiving", year, ctx), days=1)
    d = _HOLIDAYS[name]
    base = with_fields(ctx.zoned_now, year=year, month=1, day=1).start_of("day")
    if d["kind"] == "fixed":
        return with_fields(base, month=d["month"], day=d["day"])
    if d["kind"] == "easter":
        month, day = _easter_date(year)
        return with_fields(base, month=month, day=day)
    month_start = with_fields(base, month=d["month"], day=1)
    if d["kind"] == "nth-weekday":
        delta = (d["weekday"] - month_start.date().day_of_week().value + 7) % 7
        return add_calendar(month_start, days=delta + 7 * (d["n"] - 1))
    # last-weekday
    month_end = add_calendar(add_calendar(month_start, months=1), days=-1)
    back = (month_end.date().day_of_week().value - d["weekday"] + 7) % 7
    return add_calendar(month_end, days=-back)


def _eval_holiday(expr: dict[str, Any], ctx: TimeContext) -> list[Cand]:
    def mk(year: int) -> ZInterval:
        day = _holiday_day(expr["name"], year, ctx)
        return ZInterval(day, add_calendar(day, days=1), "day")

    if expr.get("year") is not None:
        return [{"type": "interval", "zi": mk(expr["year"])}]
    ref_year = ctx.zoned_now.year
    now = ctx.zoned_now
    if expr.get("dir") == "prev":
        cur = mk(ref_year)
        zi = cur if compare(cur.end, now) <= 0 else mk(ref_year - 1)
        return [{"type": "interval", "zi": zi}]
    if expr.get("dir") == "next":
        cur = mk(ref_year)
        zi = cur if compare(cur.start, now) > 0 else mk(ref_year + 1)
        return [{"type": "interval", "zi": zi}]
    ordered = _order_by_bias(mk(ref_year), lambda d: mk(ref_year + d), ctx)
    return [{"type": "interval", "zi": zi} for zi in ordered]


# ---------------------------------------------------------------------------
# literal
# ---------------------------------------------------------------------------


def _eval_literal(
    expr: dict[str, Any], ctx: TimeContext, anchor: ZInterval | None
) -> list[Cand]:
    ref_day = floor_to(
        anchor.start if anchor is not None else ctx.zoned_now, "day", ctx.week_start
    )
    if expr.get("date") is not None:
        date_cands = _resolve_date(expr["date"], ctx, anchor)
    elif anchor is not None:
        date_cands = [anchor]
    else:
        date_cands = [ZInterval(ref_day, add_calendar(ref_day, days=1), "day")]

    if expr.get("time") is None and expr.get("dayPeriod") is None:
        return [{"type": "interval", "zi": zi} for zi in date_cands]

    out: list[Cand] = []
    for d in date_cands:
        if expr.get("dayPeriod") is not None:
            zi = day_period_interval(d, expr["dayPeriod"], ctx)
            if zi is not None:
                out.append({"type": "interval", "zi": zi})
            continue
        for time_cand in _resolve_time(expr["time"], d):
            out.append({"type": "interval", "zi": time_cand})
    return out


def _resolve_date(
    date: dict[str, Any], ctx: TimeContext, anchor: ZInterval | None
) -> list[ZInterval]:
    ref = anchor.start if anchor is not None else ctx.zoned_now
    year = date.get("year")
    month = date.get("month")
    day_n = date.get("day")

    if year is not None and month is not None and day_n is not None:
        day = with_fields(ref, year=year, month=month, day=day_n).start_of("day")
        return [ZInterval(day, add_calendar(day, days=1), "day")]

    if year is not None and month is not None:
        start = with_fields(ref, year=year, month=month, day=1).start_of("day")
        return [ZInterval(start, add_calendar(start, months=1), "month")]

    if year is not None:
        start = with_fields(ref, year=year, month=1, day=1).start_of("day")
        return [ZInterval(start, add_calendar(start, years=1), "year")]

    if month is not None and day_n is not None:
        # "May 29" with no year -> most recent occurrence on-or-before today,
        # then the following one ("past + future" pairing).
        def mk_md(year_delta: int) -> ZInterval:
            d = with_fields(
                add_calendar(ref, years=year_delta), month=month, day=day_n
            ).start_of("day")
            return ZInterval(d, add_calendar(d, days=1), "day")

        if ctx.bias == "none":
            today = floor_to(ctx.zoned_now, "day", ctx.week_start)
            base = 0 if compare(mk_md(0).start, today) <= 0 else -1
            return [mk_md(base), mk_md(base + 1)]
        return _order_by_bias(mk_md(0), mk_md, ctx)

    if month is not None:

        def mk_m(year_delta: int) -> ZInterval:
            start = with_fields(
                add_calendar(ref, years=year_delta), month=month, day=1
            ).start_of("day")
            return ZInterval(start, add_calendar(start, months=1), "month")

        return _order_by_bias(mk_m(0), mk_m, ctx)

    if day_n is not None:
        # "the 3rd" -> most recent occurrence on-or-before today, then next.
        def mk_d(month_delta: int) -> ZInterval:
            d = with_fields(add_calendar(ref, months=month_delta), day=day_n).start_of(
                "day"
            )
            return ZInterval(d, add_calendar(d, days=1), "day")

        if ctx.bias == "none":
            today = floor_to(ctx.zoned_now, "day", ctx.week_start)
            base = 0 if compare(mk_d(0).start, today) <= 0 else -1
            return [mk_d(base), mk_d(base + 1)]
        return _order_by_bias(mk_d(0), mk_d, ctx)

    day = floor_to(ref, "day", ctx.week_start)
    return [ZInterval(day, add_calendar(day, days=1), "day")]


def _order_by_bias(
    current: ZInterval,
    mk: Callable[[int], ZInterval],
    ctx: TimeContext,
) -> list[ZInterval]:
    """Order the this-period occurrence and its neighbor under the context bias."""
    now = ctx.zoned_now
    is_past = compare(current.end, now) <= 0
    is_future = compare(current.start, now) > 0

    if ctx.bias == "future":
        return [mk(1), current] if is_past else [current, mk(1)]
    if ctx.bias == "past":
        return [mk(-1), current] if is_future else [current, mk(-1)]
    # none -> nearest first
    if is_past:
        nxt = mk(1)
        d_past = abs(calendar_days_between(current.start, now))
        d_next = abs(calendar_days_between(now, nxt.start))
        return [current, nxt] if d_past <= d_next else [nxt, current]
    if is_future:
        prev = mk(-1)
        d_fut = abs(calendar_days_between(now, current.start))
        d_prev = abs(calendar_days_between(prev.start, now))
        return [current, prev] if d_fut <= d_prev else [prev, current]
    # now falls inside the current occurrence: pair it with the previous one.
    return [current, mk(-1)]


def _resolve_time(time: dict[str, Any], day: ZInterval) -> list[ZInterval]:
    if time.get("second") is not None:
        grain = "second"
    elif time.get("minute") is not None:
        grain = "minute"
    else:
        grain = "hour"
    day_start = day.start.start_of("day")

    def mk(hour24: int) -> ZInterval:
        start = day_start.add(
            hours=hour24,
            minutes=time.get("minute") or 0,
            seconds=time.get("second") or 0,
        )
        if grain == "second":
            end = start.add(seconds=1)
        elif grain == "minute":
            end = start.add(minutes=1)
        else:
            end = start.add(hours=1)
        return ZInterval(start, end, grain)

    h = time.get("hour") if time.get("hour") is not None else 0
    meridiem = time.get("meridiem")
    if meridiem == "am":
        return [mk(0 if h == 12 else h)]
    if meridiem == "pm":
        return [mk(12 if h == 12 else h + 12)]
    if meridiem == "unknown" and 1 <= h <= 12:
        # Ambiguous clock reading: both readings, plausibility-ordered.
        am = mk(0 if h == 12 else h)
        pm = mk(12 if h == 12 else h + 12)
        return [am, pm] if 7 <= h <= 11 else [pm, am]
    return [mk(h)]
