# TimeExpr IR — semantics (v1)

Normative companion to [`schema/timeexpr.schema.json`](../schema/timeexpr.schema.json). Ports must implement these semantics and reproduce the conformance fixtures exactly, including candidate ordering.

## Model

- **Values are half-open intervals `[start, end)` with a `grain`** (`instant`…`year`). A point is an interval with `start == end` and grain `instant`. Durations (`{op:'duration'}`, exact) and calendar amounts (`{op:'amount'}`, unit-preserving) are separate value kinds.
- **Resolution** is a pure function `resolve(expr, context) → ordered candidates`. Same expr + same context ⇒ same candidates, always.
- **Context** supplies: `now` (reference instant), `timeZone` (IANA), `locale` (language + region), `weekStart`, `dateOrder`, `bias` (`past|future|none`), `nextWeekday` (`nearest|week-after`), `partialPeriod` (`include|exclude`), and optionally `dayPeriods` (override the locale's day-period boundary rules — used e.g. to encode another system's conventions when replaying its test corpus). All civil arithmetic happens in `timeZone`.
- Ambiguity produces **multiple candidates, ordered best-first** (cap: 4). Unresolvable ops throw (`recur` in v1); empty candidate lists are legal (e.g. "5th Monday of February").

## Operators

### `now`
The context reference instant as a point interval.

### `literal {date?, time?, dayPeriod?}`
Civil components **asserted by the source text only** — missing components are completed at resolution:

- `year+month+day` → that day. `year+month` → that month. `year` → that year.
- `month+day` (no year) → the occurrence in the reference year AND the adjacent year, ordered by policy (below). `month` alone → same at month granularity. `day` alone → occurrence in reference month AND adjacent month.
- `time`: applied to the anchor day (the intersect anchor, else the reference day). Grain = finest given component (hour if only hour, etc.). `meridiem:'unknown'` with hour 1–12 yields **both readings**: pm-first for hours 1–6 and 12, am-first for 7–11.
- `dayPeriod`: the locale day-period interval of the anchor day; periods may wrap midnight (en `night` = 21:00 → 06:00 next day), grain `hour`.
- Hour 12 special cases: `12am` → 00:00, `12pm` → 12:00.
- Nonexistent civil times (DST gap) resolve with Temporal-`'compatible'` disambiguation (shift forward by the gap); repeated times take the earlier offset.

**Ordering for underspecified dates** (`month+day`, `month`, `day`): let *current* be the reference-period occurrence and *alt* the adjacent one in the bias direction. `bias:'future'` → soonest non-past first; `'past'` → most recent non-future first; `'none'` → nearest by calendar distance first. If *current* contains `now`, it is the only mandatory candidate.

### `offset {base, amount, unit}`
Shift both endpoints by `amount` calendar units. Day-and-coarser units preserve wall-clock time across DST (a "day" may be 23/25h); `hour|minute|second` are exact. Month/year arithmetic clamps day-of-month (Jan 31 + 1 month = Feb 28/29). Grain unchanged.

### `snap {base, unit, edge?}`
The containing `unit` interval of `base.start`: floor to the unit boundary, extend one unit; grain = `unit`. `week` floors to `context.weekStart`; `quarter` to calendar quarters. `edge:'start'|'end'` collapses to the corresponding boundary point (grain `instant`).

### `span {anchor, amount, business?}`
Anchored extent. Signed `amount` fields: negative extends backward from `anchor.end`, positive forward from `anchor.start`. Grain = smallest unit present in `amount`. If the anchor is the reference point itself (grain `instant`, equal to `now`), the amount's smallest unit is day-or-coarser, and `partialPeriod:'exclude'`, the span covers complete days only ("the last 3 days" ends at today's start; "the next 3 days" begins at tomorrow's start). `business: true` counts weekdays only, walking day by day from the anchor and skipping Saturday/Sunday.

### `between {start, end}`
Cartesian over candidates, dropping pairs where start ≥ end; grain = finer of the two. The end operand's contribution depends on its shape:

- **Point ends** (grain `instant`, e.g. a `snap` edge or `now`) bound the range directly.
- **Time-grained ends** (finer than day) are exclusive at their start ("9 to 5pm" ends at 17:00); a clock range wrapping midnight rolls the end into the next day.
- **Day-grain-or-coarser ends** yield *two* candidates per pair: the conversational **inclusive** reading first — the end operand contributes its END, so "between July 4th and July 10th" covers the 10th — followed by the strict exclusive-at-start reading (`[start.start, end.start)`), which the Recognizers-Text corpora pin for date ranges.

### `seek {base, dir, target, n?}`
Directed navigation:

- `weekday` from a point/day base: `next` = strictly after the base day (`nextWeekday:'week-after'` instead targets the weekday within the following/previous week — the dialect policy applies only when `n` is absent; an explicit `n` means strict occurrence counting); `prev` = strictly before; `nearest` = both directions as candidates (strict, `n:1`), ordered future-first unless `bias:'past'`. Result: that day, grain `day`.
- `weekday` from a coarser base interval: the `n`-th occurrence **within** the interval (empty if it overflows).
- `month`: that calendar month, moving ±1 year if `dir` demands strict order relative to the base.
- `dayPeriod`: the period within the base's day.
- `unit`: the `dir`-adjacent containing unit interval (`next`/`prev` shift by `n`, `nearest` = containing).

### `intersect {parts}`
Left-to-right composition; each part evaluates with the accumulated interval as its **anchor**. Parts that name a time-of-day (a `literal` with time/dayPeriod but no date, or a `seek` with a dayPeriod target) **compose onto** the anchor day — they may extend past its end (wrap-around night). All other parts **constrain**: interval intersection, dropping empty results. Candidates: cartesian, order-preserving (first part outermost).

### `duration {iso}` / `amount {amount}`
Pass-through values: exact ISO-8601 duration; unit-preserving calendar amount.

### `holiday {name, year?, dir?}`
A named holiday resolved by the engine's table: fixed-date (christmas, halloween, valentines, independence-day, earth-day, st-patricks, workers-day, new-year, …), nth-weekday (thanksgiving = 4th Thursday of November, labor-day, mothers-day, fathers-day, memorial-day = last Monday of May), or computed (easter via the Anonymous Gregorian computus; black-friday = thanksgiving + 1 day). With `year`: that occurrence. Without: the most recent occurrence on-or-before the reference plus the following one, bias-ordered; `dir` forces the strictly previous/next single occurrence.

### `recur {every, filter?}`
Representable and serializable in v1; resolution throws `NotResolvableError` (v2 lands occurrence enumeration against a range).

### `mod` (any node)
`approx | start | mid | end`. `approx` is carried through resolution untouched (renderers may hedge). `start`/`end` narrow the resolved interval to its earlier/later half ("early July", "later this week"): the midpoint floors to the day for week-and-coarser grains (to the month for years). When the reference day falls strictly inside a week-or-coarser interval, `start` ends at the start of the reference day ("earlier this week" on a Thursday reaches through Wednesday; "earlier this year" ends today, not at midyear) — and when that reaches beyond the midpoint, the plain first half follows as an alternative candidate; `end` starts at the reference day only once the midpoint has passed. A degenerate result falls back to the plain half. `mid` selects the middle stretch: the 10th–20th for months, 10:00–14:00 for days, the middle half otherwise. Fixed splits that must *not* reference-clamp ("end of year" = July onward regardless of today) are expressed structurally with `between`/`span` instead of `mod`.

## Versioning

Schema id + `IR_VERSION = 1`. Additive evolution only (new ops, new optional fields); breaking changes bump the major version and the schema id.
