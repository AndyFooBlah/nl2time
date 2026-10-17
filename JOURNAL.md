# Project journal

An append-only record of how nl2time was built: **decisions** (and who made them), **friction**, what we
**learned**, what **surprised** us, and **incidents**.

**Format:** every entry starts with a UTC timestamp and a tag: `- 2026-10-16T17:52Z [decision] …`. Tags:
`[step]`, `[decision]`, `[friction]`, `[learning]`, `[surprise]`, `[incident]`, `[idea]`, `[milestone]`.
Entries before 2026-10-16T18:00Z were backfilled from commit times, issues and session records, so their
timestamps are approximate (`~`). "Owner" is the project owner; "session" is a Claude Code session.

**Append-only.** Never edit or delete a past entry. To correct one, append a new entry naming the earlier
one's timestamp. Synced daily to `andy-private-docs/journals/`.

---

- ~2026-07-21T08:00Z [step] Surveyed prior art for NL⇄time (Abseil, Postgres, Java, chrono-node, Duckling, dateparser, Microsoft Recognizers-Text) plus the academic line (TimeML/TIMEX3, TempEval-3, SCATE). Finding that shaped everything: parsers collapse text to a concrete datetime, losing grain, ambiguity and week-start; formatters take a pre-computed (value, unit) and make the caller own the framing. Nobody owns the middle.
- ~2026-07-21T08:30Z [decision] Owner settled the four design questions: `now` is injectable but defaults to the system clock ("important for testability"); ambiguity returns **ordered candidates**, never a silent guess; recurrence is representable in the IR but not resolvable in v1; the time model is TC39 Temporal via polyfill. JS first, with portability to Python as an explicit constraint.
- ~2026-07-21T09:21Z [milestone] v0.1 of the IR-centered engine: `TimeExpr` operator tree, deterministic `resolve`, `describe` with calendar/elapsed/absolute framings (a69b486).
- ~2026-07-21T09:37Z [decision] **Corpus-first development**: import a third-party conformance corpus *before* writing parser rules, so the rules climb a fixed target instead of a target we invent. Microsoft Recognizers-Text specs (MIT) vendored at a pinned commit with the licence text beside the data.
- ~2026-07-21T09:40Z [decision] Licence discipline for corpus material: vendor only what is redistributable under MIT-compatible terms. GPL (SynTime), LDC (TimeBank) and ODbL (SCATE/THYME) sources deliberately excluded; TempEval-3 Platinum and WikiWars used eval-only, never vendored. Recorded per-case in `corpus/ATTRIBUTIONS.md`.
- ~2026-07-21T10:00Z [learning] Corpus-climbing teaches the conventions faster than reasoning about them does: "last week of X" = the week containing scope-end − 4 days; day-bearing literals complete to [on-or-before-today, next]; clock literals always compose while day-periods constrain. None of these were designed up front; all were read off failing cases.
- ~2026-07-21T10:57Z [milestone] English imported corpus 12.6% → 80.7% in one day (b2735b2), through holidays with Easter computus, business-day spans, word-number years, H1/H2 and range-operand rules.
- ~2026-07-21T11:25Z [milestone] Published to npm as nl2time@0.1.0; repo made public after a PII audit.
- ~2026-07-23T09:31Z [step] First production consumer: weatherbot-app wired `resolve_time`/`describe_time` as client-side Gemini Live tools. Real use immediately produced two bugs — #9 (bare hour + "this \<period\>") and #10 (bare hour + day-shifting period), both shipped as 0.1.1/0.1.2.
- ~2026-07-25T22:20Z [decision] Domain adaptation happens through **declarative JSON packs**, not forking: phrase→IR templates with captures, confidence-based shadowing of named built-ins, a `disable` list, and a code-level escape hatch. Worked example: a fiscal calendar not aligned to the calendar year.
- ~2026-07-25T22:21Z [decision] Owner's insight, adopted wholesale: don't synthesize the reverse (time→NL) corpus — **invert the forward cases**. The mapping is many-to-one, so a forward case becomes a reverse case with `primary` pinning current output and `accept` carrying the acceptance class.
- ~2026-07-26T00:31Z [step] Multilingual push: a language registry keyed on context locale, a `makeLatinRules(lexicon)` factory for Latin-script languages, and bespoke per-character tokenization for CJK. Five languages built in parallel by separate sessions in git worktrees, then merged.
- ~2026-07-26T01:02Z [incident] `git add -A` swept `.claude/worktrees/*` into the repo as embedded gitlinks. Fixed with `git rm -r --cached .claude` plus a `.gitignore` entry (2797d32), as a follow-up commit rather than a history rewrite, because main is shared.
- ~2026-07-26T01:05Z [surprise] French sat at ~58% and resisted every rule fix. The cause was upstream, not ours: a block of spec cases carries a stale `ReferenceDateTime`, so "aujourd'hui" with a 2016 reference expects a 2018 answer. Verified empirically before acting, then excluded 231 provably ungradeable cases at import via a `refSuspect` heuristic and documented it. Spanish was scanned the same way — its far-year hits were genuine (word-years, Roman centuries), so nothing was excluded there.
- ~2026-07-26T01:10Z [learning] Agents working in parallel worktrees found two tokenizer bugs neither would have found alone: U+3007 〇 missing from the token class, and a mid-run ASCII flush emitting shifted offsets. Merging their reports was worth more than either diff.
- ~2026-07-26T01:51Z [milestone] 0.3.0 — six languages (en 84.3%, es 96.0%, fr 89.9%, de 97.5%, ja 95.7%, zh 95.4%), each with a CI-gated per-language baseline so a regression fails the build.
- ~2026-07-26T09:06Z [learning] The step-by-step walkthrough doc was wrong in three places until every claim was executed against the library rather than reasoned about — nested intersect shapes, and a London example whose calendar day had already rolled. Docs that assert concrete outputs must be generated or verified by running them (c7c66bb).
- ~2026-07-26T09:15Z [decision] Python port strategy: **monorepo**, not a shared-corpus repo — a submodule adds version skew to exactly the artifact that must never skew. Anti-divergence rests on three gates: machine-generated IR-parity fixtures (2,760 `(expr,ctx)→candidates` triples from the JS reference, bit-exact), the shared corpora as the parser spec, and dual-suite CI.
- ~2026-07-26T09:16Z [milestone] Python engine at 100% parity on all 2,760 fixtures, `whenever`-based, with the Temporal bridges documented (`with_fields` clamping, explicit `disambiguate`, `Instant.format_iso()`).
- ~2026-07-26T14:28Z [milestone] PyPI 0.1.0 published; registry install verified.
- ~2026-07-26T14:45Z [decision] Releases move to **OIDC trusted publishing** for both registries — no long-lived tokens in CI. `v*` tags publish npm, `py-v*` tags publish PyPI, each guarded by a tag↔manifest version check.
- ~2026-07-26T18:07Z [milestone] 0.3.1 / Python 0.1.1 — seven parser and engine bugs fixed, every one found by the agent-time-bench benchmark rather than by the test suite: inclusive `between`, since/until/through/by, cross-midnight ranges under a day anchor, "earlier this week", "\<weekday\> before last", "the weekend of \<date\>", "first/second half of \<period\>".
- ~2026-07-26T18:00Z [decision] On #17 (`between July 4th and July 10th` excluding the 10th): emit the **inclusive reading first with the exclusive one as an alternative candidate**, rather than rewriting the parser. ~25 baselined Recognizers cases pin the exclusive value, and they grade by unordered membership — so both consumers stay correct and no baseline regressed.
- ~2026-07-26T18:07Z [learning] Zero conformance-baseline regressions across six languages while changing engine semantics, because the baselines are CI-gated and the IR fixtures are regenerated as a reviewed diff. The corpus paid for itself here.
- ~2026-08-16T03:33Z [milestone] First external contribution: PR #25 from an outside contributor fixing multi-day fine-grained `between` ends; merged 2026-09-10.
- ~2026-09-10T22:05Z [step] Repo hygiene from the deep audit: Apache-2.0/licence declarations, packaging metadata, a CI fixture-drift gate, CONTRIBUTING and SECURITY. 0.3.2 / Python 0.1.2.
- ~2026-09-11T23:48Z [step] Deadline connectors accept article forms and "before"; late-part deadlines collapse to a single candidate.
- 2026-10-16T18:05Z [step] Journal created and backfilled from commit history, issues and session records, per the owner's new global journal policy in `~/.claude/CLAUDE.md`.
