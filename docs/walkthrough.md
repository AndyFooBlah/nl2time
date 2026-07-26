# Worked examples: what nl2time actually does, step by step

Two complete traces — one in each direction — using the same reference context throughout:

```ts
const ctx = TimeContext.make({
  now: '2026-07-25T21:00:00-07:00',   // 9:00pm PDT, Saturday July 25
  timeZone: 'America/Los_Angeles',
  locale: 'en-US',
});
```

The context is the single source of policy: it carries the reference instant, the user's IANA timezone, and the locale — from which CLDR-derived defaults follow (en-US ⇒ weeks start Sunday, dates read M/D, 12-hour clock), plus explicit ambiguity knobs (`bias`, `nextWeekday`, `partialPeriod`).

---

## Direction 1: "3 o'clock yesterday afternoon" → an interval

### Step 1 — Tokenize

```
"3 o'clock yesterday afternoon"
 └─▶ [number 3] [word o'clock] [word yesterday] [word afternoon]
```

The tokenizer is deliberately dumb: lowercase words, numbers, clock patterns (`3:15pm`), numeric dates (`7/24`). No language knowledge lives here (for CJK locales it emits per-character tokens instead).

### Step 2 — Rule scan → IR fragments

Language-specific rules (selected by `ctx.locale`) each try to match at every position; the scanner keeps the longest match, then the most confident:

- `clock-time` matches **`3 o'clock`** → `{op:'literal', time:{hour:3, meridiem:'unknown'}}` — 3 could be am *or* pm, and the parser refuses to guess: `meridiem:'unknown'` is recorded, not resolved.
- `deictic-day` matches **`yesterday`** → `{op:'snap', base:{op:'offset', base:{op:'now'}, amount:-1, unit:'day'}, unit:'day'}` — read it inside-out: *take now, step back one day, expand to the whole containing calendar day*.
- `period-alone` matches **`afternoon`** → `{op:'literal', dayPeriod:'afternoon'}`.

### Step 3 — Refine: merge adjacent fragments

The refiner sees date-ish and time-ish neighbors and combines them into nested intersections — the day, the ambiguous clock reading, and the day-period all stay explicit:

```jsonc
{ "op": "intersect", "parts": [
    { "op": "intersect", "parts": [
        { "op": "snap", "base": { "op": "offset", "base": {"op":"now"}, "amount": -1, "unit": "day" }, "unit": "day" },
        { "op": "literal", "time": { "hour": 3, "meridiem": "unknown" } }    // still honest: could be am or pm
    ]},
    { "op": "literal", "dayPeriod": "afternoon" }
]}
```

This JSON tree is the **IR** (`TimeExpr`) — the parser's entire output. Note what it does *not* contain: no dates, no timezone math, no "now". It is a pure, storable, context-free description of what the words meant. (An LLM fallback, if you use one, is only ever allowed to emit this same IR.)

### Step 4 — Resolve deterministically against the context

`resolve(expr, ctx)` evaluates the tree:

1. `now` → the instant 2026-07-25T21:00 PDT.
2. `offset −1 day` → July 24, 21:00 (calendar arithmetic: across a DST change this preserves wall-clock time — a "day" is not 86,400 seconds).
3. `snap day` → the containing civil day **[Jul 24 00:00, Jul 25 00:00) PDT** — snapping happens in the user's timezone, and a week-snap here would consult the locale's week start.
4. Inner `intersect` with the ambiguous clock literal → **two candidates** on that day, 3pm-first (plausibility-ordered): [15:00, 16:00) and [03:00, 04:00).
5. Outer `intersect` with the *afternoon* period (12:00–18:00) constrains the candidates — only the 3pm reading survives: **[Jul 24 15:00, Jul 24 16:00) PDT**. The ambiguity was carried, then *eliminated by evidence*, never guessed away.

### Step 5 — The answer, with honesty attached

```jsonc
{ "kind": "interval",
  "start": "2026-07-24T22:00:00Z",   // 3pm PDT = 22:00 UTC
  "end":   "2026-07-24T23:00:00Z",
  "grain": "hour" }
```

Everything language denotes is a half-open **interval with a grain** — "3 o'clock" is an hour, not a millisecond. Had the phrase been just "at 3", you'd have received *two ordered candidates* (3pm first, 3am second) instead of a silent guess: ambiguity is data.

---

## Direction 2: `2026-07-25T05:30:00Z` → "10:30pm last night"

The reverse direction answers: *how should this instant be spoken to this user, right now?*

### Step 1 — Project into the user's civil time

05:30 UTC July 25 → **22:30 PDT on Friday, July 24** — a different calendar day than in UTC, which is the whole point of doing this deterministically.

### Step 2 — Select a framing

`describe()` owns a decision most libraries push to you: calendar framing ("yesterday"), elapsed framing ("22 hours ago"), or absolute ("July 24 at 10:30 PM")? The default ladder keys on *calendar distance*: same day → time-only; ±1 day → yesterday/tomorrow; within a week → weekday name; beyond → absolute date. Here the target is one calendar day back ⇒ **calendar framing**.

### Step 3 — Build the IR that says it

Selection produces an expression, not a string:

```jsonc
{ "op": "intersect", "parts": [
    { "op": "snap", "base": { "op": "offset", "base": {"op":"now"}, "amount": -1, "unit": "day" }, "unit": "day" },
    { "op": "literal", "time": { "hour": 10, "minute": 30, "meridiem": "pm" } }
]}
```

This is the same IR language as direction 1 — which is what makes the **round-trip invariant** testable: `resolve(describe(v).expr, ctx)` must produce an interval containing `v`. Every description we emit can be read back.

### Step 4 — Render

With `style: 'casual'`, 22:30 falls in the *night* day-period of the previous day, so the day-part renders as "last night" and the time compacts:

```
"10:30pm last night"        (casual)
"yesterday at 10:30 PM"     (neutral — clock text via Intl, locale-correct)
```

Same instant, different context, different truth: a user in London (`Europe/London`) gets **"6:30am yesterday morning"** — at this moment it's already early on July 26 in London, so 06:30 BST on the 25th is *their* yesterday. The library recomputed the calendar day, the framing, and the day-period from their context. That is why weatherbot routes every timestamp through this path instead of letting a model verbalize raw UTC.

---

## Where to go next

- [README](../README.md) — API surface and design rationale
- [docs/ir-spec.md](ir-spec.md) — every IR operator's exact semantics
- [docs/extending.md](extending.md) — domain packs (fiscal calendars, "EOD means 5pm")
- [corpus/](../corpus/) — the conformance corpora these behaviors are pinned by
