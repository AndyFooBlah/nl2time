# nl2time — design

*(Condensed from the design review of 2026-07-21; survey of prior art summarized at the end.)*

## Goals

Bidirectional NL ⇄ date/time with a deterministic core: parse "last week" to a concrete, locale-correct interval; describe `2026-07-20T04:00Z` to a Pacific user on Jul 20 as "9pm last night". LLM optional, only as a translator into the symbolic IR. JS v1, designed for a faithful Python port ([porting.md](porting.md)).

## Architecture

Five layers around a language-neutral core:

```
        text                                   instant/interval
         │                                            │
   ┌─────▼──────┐                              ┌──────▼──────┐
   │  PARSE      │  rules first, LLM fallback  │  SELECT      │  framing/unit/grain policy
   └─────┬──────┘                              └──────┬──────┘
         │            ┌────────────────┐              │
         └───────────►│   IR: TimeExpr │◄─────────────┘
                      └───┬────────┬───┘
                ┌─────────▼──┐  ┌──▼──────────┐
                │  RESOLVE    │  │  RENDER      │  (Intl / CLDR data)
                └─────┬──────┘  └─────────────┘
                      ▼
             TimeValue (interval + grain)
```

Both directions meet in the IR ([ir-spec.md](ir-spec.md)): parsing produces it; describing *selects* it before rendering. `resolve` and `render` are deterministic functions of `(IR, TimeContext)`.

## Key decisions (and their rationale)

1. **Core time model = TC39 Temporal** (via `temporal-polyfill` until Node 26 is the floor). We adopt its absolute/civil split, DST disambiguation, and clamping arithmetic wholesale; Python maps to `whenever`. We never write date math.
2. **Everything language denotes is an interval with a grain** — "July" is a month, "9pm" is an hour. Half-open `[start, end)`.
3. **Two duration kinds**: exact (`duration`, ISO string) vs calendar (`amount`, unit-preserving) — the Period/Duration split every mature system converged on.
4. **Candidates by default.** `resolve` returns an ordered list; ambiguity ("at 4", "May 29") is data. `resolveOne` = first candidate. Policy knobs (`bias`, `nextWeekday`, `partialPeriod`, `weekStart`) order candidates; they never silently discard readings.
5. **`now` defaults to the system clock but is injectable** — reproducibility for tests/goldens, convenience for apps.
6. **Locale = language + region**, because CLDR week data is territory-keyed: en-US "last week" (Sun–Sat) ≠ en-GB (Mon–Sun). Policy CLDR doesn't cover (fiscal weeks, "next Tuesday" dialect, partial periods) is explicit context config.
7. **LLM boundary**: the library makes no network calls; applications plug a fallback that must emit schema-valid IR (`nl2time/llm`). Rationale: benchmark evidence that LLMs fail at date arithmetic but succeed at symbol mapping.
8. **Recurrence deferred**: `recur` is representable/serializable in v1 (storable saved queries), resolvable in v2.
9. **Stability contract**: the IR and `TimeValue` are the API; rendered strings are explicitly *not* stable across CLDR/ICU updates (Hyrum hedge, documented).
10. **Round-trip invariant**: `resolve(describe(v).expr, ctx)` must contain `v` at the stated grain (property-tested; elapsed framing carries one-grain truncation slack).

## Prior-art survey (abridged)

- **Time models**: Abseil's absolute/civil/zone-as-function model; java.time's Period/Duration and Joda regrets; Temporal's disambiguation options; Postgres's 3-field interval; jiff's Span. Theme: make the civil→absolute crossing explicit and policy-bearing.
- **Parsers**: Microsoft Recognizers-Text's recognize-symbolic-then-resolve pipeline (closest ancestor of this design); chrono-node's known-vs-implied components (→ our `literal` partials); Duckling's grain (→ our grain); TIMEX3/SCATE (→ our operator algebra). Recurring gap: recurrence, locale week policy.
- **Formatters**: Intl/ICU take `(value, unit)` — nobody owns the framing/unit decision (→ our `describe` select stage). Luxon's `toRelative` vs `toRelativeCalendar` names the elapsed/calendar fork.
- **BI DSLs**: Splunk `-7d@d` snap, Elasticsearch direction-aware rounding, Looker `3 days ago for 3 days` (→ our `offset`/`snap`/`span` primitives).
