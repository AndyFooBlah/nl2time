"""The clock seam: every `whenever` usage in nl2time flows through this module.

Python counterpart of src/clock/index.ts (which wraps Temporal):
Temporal.Instant -> whenever.Instant, Temporal.ZonedDateTime ->
whenever.ZonedDateTime. Semantics mirrored:

- calendar units (day and coarser) add/subtract preserving wall-clock time
  across DST, with Temporal-'compatible' disambiguation;
- hour/minute/second arithmetic is exact (absolute time);
- month/year arithmetic clamps day-of-month (Jan 31 + 1 month = Feb 28/29).

No other module may import `whenever` directly.
"""

from __future__ import annotations

from dataclasses import dataclass

from whenever import Date, Instant, ZonedDateTime

WEEKDAY_NUM: dict[str, int] = {
    "mon": 1,
    "tue": 2,
    "wed": 3,
    "thu": 4,
    "fri": 5,
    "sat": 6,
    "sun": 7,
}


def weekday_number(w: str) -> int:
    return WEEKDAY_NUM[w]


@dataclass(frozen=True)
class ZInterval:
    """Half-open zoned interval [start, end) carrying its granularity."""

    start: ZonedDateTime
    end: ZonedDateTime
    grain: str


def system_now() -> Instant:
    return Instant.now()


def system_time_zone() -> str:
    return ZonedDateTime.now_in_system_tz().tz


def parse_instant(s: str) -> Instant:
    return Instant.parse_iso(s)


def format_instant(i: Instant) -> str:
    """Temporal.Instant.toString()-compatible: `Z` suffix, trailing zeros trimmed."""
    return i.format_iso()


def to_zoned(instant: Instant, time_zone: str) -> ZonedDateTime:
    return instant.to_tz(time_zone)


def point_interval(z: ZonedDateTime) -> ZInterval:
    """Point interval at z (grain 'instant')."""
    return ZInterval(z, z, "instant")


def start_of_day(z: ZonedDateTime) -> ZonedDateTime:
    return z.start_of("day")


def with_fields(
    z: ZonedDateTime,
    *,
    year: int | None = None,
    month: int | None = None,
    day: int | None = None,
) -> ZonedDateTime:
    """Temporal `.with({year?, month?, day?})` with 'constrain' overflow.

    whenever's replace() raises on out-of-range days; Temporal clamps
    (e.g. `.with({month: 2, day: 31})` on Jan 15 -> Feb 28). Clamp manually.
    """
    y = year if year is not None else z.year
    m = month if month is not None else z.month
    d = day if day is not None else z.day
    d = min(d, Date(y, m, 1).days_in_month())
    return z.replace(year=y, month=m, day=d, disambiguate="compatible")


def add_calendar(z: ZonedDateTime, **units: int) -> ZonedDateTime:
    """Calendar-aware add with Temporal-'compatible' disambiguation."""
    return z.add(**units, disambiguate="compatible")


def floor_to(z: ZonedDateTime, unit: str, week_start: str) -> ZonedDateTime:
    if unit == "second":
        return z.round("second", mode="floor")
    if unit == "minute":
        return z.round("minute", mode="floor")
    if unit == "hour":
        return z.round("hour", mode="floor")
    if unit == "day":
        return z.start_of("day")
    if unit == "week":
        target = WEEKDAY_NUM[week_start]
        # day_of_week is ISO (mon=1..sun=7); step back to the week-start day.
        delta = (z.date().day_of_week().value - target + 7) % 7
        return z.start_of("day").subtract(days=delta, disambiguate="compatible")
    if unit == "month":
        return with_fields(z, day=1).start_of("day")
    if unit == "quarter":
        q_start_month = (z.month - 1) // 3 * 3 + 1
        return with_fields(z, month=q_start_month, day=1).start_of("day")
    if unit == "year":
        return with_fields(z, month=1, day=1).start_of("day")
    raise ValueError(f"unknown unit {unit!r}")


def add_units(z: ZonedDateTime, unit: str, n: int) -> ZonedDateTime:
    """Calendar-aware unit addition (day+ preserves wall clock; h/m/s exact)."""
    if unit == "second":
        return z.add(seconds=n)
    if unit == "minute":
        return z.add(minutes=n)
    if unit == "hour":
        return z.add(hours=n)
    if unit == "day":
        return add_calendar(z, days=n)
    if unit == "week":
        return add_calendar(z, weeks=n)
    if unit == "month":
        return add_calendar(z, months=n)
    if unit == "quarter":
        return add_calendar(z, months=3 * n)
    if unit == "year":
        return add_calendar(z, years=n)
    raise ValueError(f"unknown unit {unit!r}")


def containing_unit(z: ZonedDateTime, unit: str, week_start: str) -> ZInterval:
    """The containing unit interval of z: floor, extend one unit."""
    start = floor_to(z, unit, week_start)
    return ZInterval(start, add_units(start, unit, 1), unit)


def calendar_days_between(from_z: ZonedDateTime, to_z: ZonedDateTime) -> int:
    """Whole calendar days between two zoned datetimes (calendar difference)."""
    return int(from_z.start_of("day").date().until(to_z.start_of("day").date(), total="days"))


def compare(a: ZonedDateTime, b: ZonedDateTime) -> int:
    """Instant-order comparison (Temporal.ZonedDateTime.compare)."""
    x = a.timestamp_nanos()
    y = b.timestamp_nanos()
    return -1 if x < y else (1 if x > y else 0)


def epoch_millis(z: ZonedDateTime) -> int:
    return z.timestamp_millis()


def add_milliseconds(z: ZonedDateTime, ms: int) -> ZonedDateTime:
    return z.add(milliseconds=ms)
