# Extending nl2time: domain packs and custom rules

Some domains disagree with everyday usage ("EOD" means 5pm on a trading desk, not midnight) or use vocabulary nl2time has never heard of ("FY26", "sprint 14", "swing shift"). You don't need to fork for either. There are three tiers of customization, cheapest first — reach for the lowest tier that solves your problem.

## Tier 1: context knobs (no code, no pack)

Many "domain conflicts" are policy, not vocabulary, and `TimeContext` already owns them:

| Knob | Question it settles |
|---|---|
| `weekStart` | Does "last week" run Sun–Sat or Mon–Sun? |
| `nextWeekday` | Is "next Tuesday" the upcoming one or next week's? |
| `partialPeriod` | Does "the last 3 days" include today? |
| `bias` | Is a bare "Friday" past or future? |
| `dayPeriods` | When does "morning" end? (Override the CLDR boundaries.) |

Example: weatherbot pins `weekStart: 'mon'` so "last week" agrees with the `date_trunc('week', …)` SQL its analytics layer generates.

## Tier 2: domain packs (declarative JSON — the recommended surface)

A **pack** maps phrases to IR templates. It's plain JSON: loadable from config, schema-validated, portable to future language ports, and testable with the standard corpus tooling.

```ts
import { parse, createParser, validatePack, TimeContext } from 'nl2time';

const pack = validatePack(JSON.parse(fs.readFileSync('fiscal.json', 'utf8')));
const parser = createParser({ packs: [pack] });   // compile once, reuse
parser('Q3 FY26', ctx);
// or one-off: parse('Q3 FY26', ctx, { packs: [pack] })
```

### Anatomy of an entry

```jsonc
{
  "phrases": ["q{n} fy{yr}", "fy{yr} q{n}"],   // alternative phrasings
  "expr": {                                     // TimeExpr template (docs/ir-spec.md)
    "op": "span",
    "anchor": {
      "op": "offset",
      "base": { "op": "literal", "date": { "year": { "$": "yr", "offset": -1 }, "month": 7 } },
      "amount": { "$": "n", "scale": 3, "offset": -3 },
      "unit": "month"
    },
    "amount": { "months": 3 }
  }
}
```

- **Phrases** are whitespace-separated segments matched over tokens, case-insensitively. `{n}` captures any integer; `{yr}` captures a year (two-digit values normalize to 2000+). Captures work standalone (`sprint {n}`) or embedded in a word (`fy{yr}` matches "FY26" and "fy2026").
- **Templates** are ordinary TimeExpr JSON where any integer position may instead be a capture reference `{"$": "n", "scale": k, "offset": m}` → `n·k + m`. Above: Q`n` starts `(n−1)×3` months after the fiscal-year start, and FY`yr` starts in July of `yr−1`.
- **`period`** is a shorthand for named times of day, in local 24h hours: `{ "phrases": ["swing shift"], "period": { "from": 16, "before": 24 } }`. Period entries get `role: "time"` and merge with adjacent dates exactly like "morning" does — "yesterday swing shift" just works.
- **`role`** controls how a match combines with neighbors (`date` default; `time` merges onto dates; `duration` participates in "X for Y" spans).

### Precedence: extending vs overriding

Pack rules run **before** built-ins, and every candidate at a position competes on (match length, then confidence, then order). Pack entries default to confidence 0.98 — above every built-in — so:

- **New vocabulary** ("FY26") simply matches where nothing else did.
- **Conflicting vocabulary** shadows the standard reading at equal length: the fiscal example maps `eod`/`cob` to 5pm, beating the built-in end-of-day-midnight rule.
- **Removing standard behavior** uses `disable`, by stable rule name: `{ "disable": ["holiday"] }` in the pack, or `parse(text, ctx, { disable: ['holiday'] })`. The names are the `EN_RULE_ENTRIES` export (range, week-of, holiday, deictic-day, clock-time, …).

### Idioms worth stealing (from the fiscal example)

The [fiscal-july example](../examples/fiscal-july/) models a July-start fiscal year labeled by ending year (FY26 = Jul 2025–Jun 2026). Two constructions generalize:

- **"Current fiscal period" without conditionals**: the IR has no if/else, but `seek(now, 'prev', month: 7)` means "the most recent July" — which *is* the current fiscal-year start, whatever today is. FYTD is then just `between(that July's start, today's start)`.
- **Anchored numbered periods**: "sprint {n}" style vocabularies are `offset` from a fixed epoch literal with `scale` — no code needed even though the phrase implies arithmetic.

### Ship a corpus with your pack

The standard case format works for pack cases — add `"packs": [...]` per case or inject the pack in your test harness, then grade with the exported runner:

```ts
import { runForwardCase } from 'nl2time/corpus';
const outcome = runForwardCase({ ...caseJson, packs: [pack] });
```

The [example's cases.json](../examples/fiscal-july/cases.json) shows the shape, including a counter-case asserting that calendar vocabulary ("this year") is untouched. Treat the pack + its cases as one artifact: the cases are the pack's contract, and they'll keep it honest across nl2time upgrades.

## Tier 3: code-level rules (escape hatch)

For genuinely procedural grammars a JSON template can't express (checksummed codes, week-numbering schemes with custom epochs), register a `Rule` function:

```ts
import { parse, type Rule } from 'nl2time';

const isoWeekCode: Rule = (tokens, i) => {
  const t = tokens[i];
  const m = t?.type === 'word' ? t.value.match(/^(\d{4})-?w(\d{2})$/) : null;  // "2026-W29"
  if (!m) return undefined;
  return {
    expr: {
      op: 'offset',
      base: { op: 'snap', base: { op: 'literal', date: { year: Number(m[1]), month: 1, day: 4 } }, unit: 'week' },
      amount: Number(m[2]) - 1,
      unit: 'week',
    },
    consumed: 1,
    confidence: 0.98,
    role: 'date',
  };
};

parse('2026-W29', ctx, { rules: [isoWeekCode] });
```

A `Rule` is a pure function `(tokens, i, ctx) → { expr, consumed, confidence, role } | undefined`. Custom rules run after packs, before built-ins. Prefer packs when possible: code rules don't port across language implementations and can't be loaded from config.

## Notes

- Packs affect **parsing** only. Resolution semantics stay in the engine; anything a pack emits is validated IR, so downstream behavior (candidates, DST handling, round-tripping) is unchanged.
- `pack.context` is a *suggested* set of context options (e.g. a domain's week start). It is not applied automatically — merge it into `TimeContext.make({...pack.context, ...perUserOptions})` yourself, since per-user settings usually win.
- Reverse-direction (describe) customization — domain phrasing for rendered output — is planned; track issue #11 follow-ups.
