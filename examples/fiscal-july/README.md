# Example: July-start fiscal calendar

A domain pack for financial reporting where the fiscal year runs July 1 → June 30,
labeled by the calendar year in which it ends (FY26 = Jul 2025 – Jun 2026).

- `pack.json` — the vocabulary: FY{yr}, Q{n} FY{yr}, FYTD, this/last/next fiscal
  year, and a deliberate conflict demo (`eod`/`cob` → 5pm, shadowing the built-in
  end-of-day reading).
- `cases.json` — the pack's golden cases in the standard corpus format, including
  a counter-case proving calendar vocabulary is untouched.

Run: see `test/packs.test.ts`, or grade yourself via `runForwardCase` from
`nl2time/corpus` with `packs: [pack]` on each case. Walkthrough: docs/extending.md.
