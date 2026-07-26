# nl2time (Python)

Deterministic resolution of temporal-expression IR — the Python port of
[nl2time](https://github.com/AndyFooBlah/nl2time), a bidirectional natural
language ⇄ date/time library built around a JSON intermediate representation
(`TimeExpr`).

**Scope of this release: the language-neutral core.** IR validation,
`TimeContext` (reference instant, IANA timezone, locale-derived week/date
policy, ambiguity knobs), and the full deterministic engine `resolve()` —
every operator including calendar snapping, DST-correct offsets, holidays
(computed Easter), business-day spans, and ordered ambiguity candidates.
Natural-language *parsing* and *rendering* are not yet ported; today the
expected producers of IR are the JS parser, an LLM emitting schema-constrained
IR, or your own code. Time model: [whenever](https://pypi.org/project/whenever/)
(Temporal-inspired).

```python
from nl2time import TimeContext, resolve

ctx = TimeContext.make({
    "now": "2026-07-20T17:00:00Z",
    "timeZone": "America/Los_Angeles",
    "locale": "en-US",
})

# "last week" as IR (e.g. produced by the JS parser or an LLM):
expr = {
    "op": "snap",
    "base": {"op": "offset", "base": {"op": "now"}, "amount": -1, "unit": "week"},
    "unit": "week",
}
resolve(expr, ctx)["candidates"][0]
# {"kind": "interval", "start": Instant("2026-07-12 07:00:00Z"),
#  "end": Instant("2026-07-19 07:00:00Z"), "grain": "week"}
# (values are `whenever.Instant`; candidates are ordered, ambiguity is data)
```

## Parity guarantee

This engine reproduces the JS reference **bit-exactly** — instants, grains,
and candidate order — across all 2,760 machine-generated engine-parity
fixtures derived from the project's six-language conformance corpora, enforced
in CI on every commit. Spec: [ir-spec.md](https://github.com/AndyFooBlah/nl2time/blob/main/docs/ir-spec.md);
strategy: [porting.md](https://github.com/AndyFooBlah/nl2time/blob/main/docs/porting.md);
test-data provenance: [corpus/ATTRIBUTIONS.md](https://github.com/AndyFooBlah/nl2time/blob/main/corpus/ATTRIBUTIONS.md).

MIT.
