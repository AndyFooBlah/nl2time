"""TimeContext: all resolution policy flows through here (port of src/context.ts).

Options use the same camelCase names as the JS reference and the corpus wire
format (`timeZone`, `weekStart`, ...); attributes are snake_case.
"""

from __future__ import annotations

from typing import Any

from whenever import Instant, ZonedDateTime

from .clock import parse_instant, system_now, system_time_zone, to_zoned
from .data import DayPeriodRule, first_day_for_region
from .errors import ConfigError

_MDY_REGIONS = frozenset(["US", "PH", "UM", "VI", "GU", "AS", "PR"])
_YMD_REGIONS = frozenset(["CN", "JP", "KR", "TW", "HU", "MN", "LT"])

_WEEKDAYS = frozenset(["mon", "tue", "wed", "thu", "fri", "sat", "sun"])


def _parse_locale(locale: str) -> tuple[str, str | None]:
    """Split a BCP-47 tag without Intl: language = first subtag; region = the
    first 2-letter-alpha or 3-digit subtag after it (script subtags skipped)."""
    parts = locale.replace("_", "-").split("-")
    language = parts[0].lower()
    if not language or not language.isascii() or not language.isalpha():
        raise ConfigError(f"invalid locale: {locale}")
    region: str | None = None
    for sub in parts[1:]:
        if (len(sub) == 2 and sub.isascii() and sub.isalpha()) or (
            len(sub) == 3 and sub.isdigit()
        ):
            region = sub.upper()
            break
    return language, region


def _normalize_day_periods(rules: list[dict[str, Any]]) -> list[DayPeriodRule]:
    """Accept wire-format rules ({period, from, before}) or internal from_."""
    out: list[DayPeriodRule] = []
    for r in rules:
        out.append(
            {
                "period": r["period"],
                "from_": r["from_"] if "from_" in r else r["from"],
                "before": r["before"],
            }
        )
    return out


class TimeContext:
    def __init__(
        self,
        *,
        now: Instant | str | None = None,
        timeZone: str | None = None,
        locale: str | None = None,
        weekStart: str | None = None,
        dateOrder: str | None = None,
        bias: str | None = None,
        nextWeekday: str | None = None,
        partialPeriod: str | None = None,
        dayPeriods: list[dict[str, Any]] | None = None,
    ) -> None:
        raw_now = now if now is not None else system_now()
        try:
            self.now: Instant = (
                parse_instant(raw_now) if isinstance(raw_now, str) else raw_now
            )
        except Exception as e:  # noqa: BLE001 - mirror JS ConfigError wrapping
            raise ConfigError(f"invalid now: {e}") from e
        self.time_zone: str = timeZone if timeZone is not None else system_time_zone()
        self.locale: str = locale if locale is not None else "en-US"

        self.language, self.region = _parse_locale(self.locale)

        if weekStart is not None and weekStart not in _WEEKDAYS:
            raise ConfigError(f"invalid weekStart: {weekStart}")
        self.week_start: str = (
            weekStart if weekStart is not None else first_day_for_region(self.region)
        )
        if dateOrder is not None:
            self.date_order = dateOrder
        elif self.region in _MDY_REGIONS:
            self.date_order = "MDY"
        elif self.region in _YMD_REGIONS:
            self.date_order = "YMD"
        else:
            self.date_order = "DMY"
        self.bias: str = bias if bias is not None else "none"
        self.next_weekday: str = nextWeekday if nextWeekday is not None else "nearest"
        self.partial_period: str = (
            partialPeriod if partialPeriod is not None else "include"
        )
        self.day_periods: list[DayPeriodRule] | None = (
            _normalize_day_periods(dayPeriods) if dayPeriods is not None else None
        )

        # Validate the timezone eagerly so failures surface at construction.
        try:
            to_zoned(self.now, self.time_zone)
        except Exception as e:  # noqa: BLE001
            raise ConfigError(f"invalid timeZone: {self.time_zone}") from e

    @classmethod
    def make(cls, opts: dict[str, Any] | None = None, /, **kwargs: Any) -> "TimeContext":
        merged = {**(opts or {}), **kwargs}
        return cls(**merged)

    @property
    def zoned_now(self) -> ZonedDateTime:
        """The reference instant projected into the context timezone."""
        return to_zoned(self.now, self.time_zone)
