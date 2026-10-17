# nl2time — project journal

Append-only. Every entry starts with a UTC timestamp and a tag
(`[step] [decision] [friction] [learning] [surprise] [incident] [idea]
[milestone]`). Never edit or delete a past entry; correct by appending
a new entry that names the earlier one's timestamp. Synced daily to
`andy-private-docs/journals/`.

Entries up to 2026-10-16 were backfilled on 2026-10-16 from git
history, GitHub issues/PRs, and Claude session transcripts; timestamps
are anchored to commits where available.

---

- 2026-07-21T16:21Z [milestone] v0.1: IR-centered bidirectional NL⇄time engine (a69b486). Design decisions: injectable `now`; ambiguity = ordered candidates, never silent guesses; TC39 Temporal via polyfill; recurrence representable in v1, resolvable in v2. Origin: weatherbot's time-correctness saga — the owner asked for "a really robustly tested local function (no database calls) that can correctly map natural language into points in time."
- 2026-07-21T17:57Z [milestone] Corpus day one: bidirectional golden set + Microsoft Recognizers-Text import (MIT), climbed 12.6% → 80.7% in one day of rule work; every previously-passing case became a CI regression gate (b2735b2). The 65-case datetime→NL golden set is, to our knowledge, the first published eval set for humanized time generation.
- 2026-07-21T18:25Z [milestone] Published nl2time@0.1.0 to npm (MIT, per owner's license policy: nl2time stays MIT) (49ee06c).
- 2026-07-23T16:31Z [surprise] First production consumer found the first production bug: weatherbot's eval corpus caught "8 this morning" parsing as 6am — the bare hour was dropped and the day-part start used (#9). The naive fix was itself caught by the imported corpus ("building 4 this afternoon" must keep its range reading) → noun-guarded rule (9b3d7b4). [learning] Consumer-side eval corpora and the library's own corpus gate each other; the regression is now pinned in both repos.
- 2026-07-23T18:04Z [friction] 0.1.1 publish blocked by an expired npm token (publish PUT returns 404, not 401 — looks like a missing package). Owner re-ran `npm login`; 0.1.1 shipped (2492d3e).
- 2026-07-23T21:00Z [decision] weatherbot pins `weekStart: 'mon'` in its TimeContext after its eval corpus exposed a three-way "last week" mismatch (CLDR en-US Sunday default vs prompt text vs Postgres date_trunc). Library default stays CLDR-correct; the knob exists precisely for this.
- 2026-07-26T01:18Z [step] "10 last night"-class phrases (day-shifting periods) fixed (#10, 842ed64).
- 2026-07-26T05:21Z [milestone] Domain packs — pluggable vocabulary/rules without forking (#11); corpus inversion derives reverse cases from forward cases (#12); en-GB + complex-calendar Recognizers specs imported (fc85a89). 0.2.0 (5e4d51e).
- 2026-07-26T08:51Z [milestone] Multilingual round via parallel worktree agents (#13): Spanish 96.0%, German 97.5%, Chinese 95.4%, Japanese 95.4%, French 89.9% of gradeable cases on imported corpora; language registry + Latin/CJK factories. 0.3.0 (e1343fd).
- 2026-07-26T16:16Z [milestone] Python engine port at 100% parity on 2,760 language-neutral IR fixtures; dual-suite CI (4a78915). [learning] The IR + fixtures as portability artifacts worked exactly as designed — the port needed no English grammar at all.
- 2026-07-26T21:45Z [milestone] PyPI 0.1.0 published; trusted-publishing (OIDC) release workflow for npm + PyPI (de9928c, fefab93).
- 2026-07-27T01:07Z [step] English grammar round from issue triage (#17/#20 among them): open-range connectors, "weekday before last", "weekend of <date>", period halves, cross-midnight ranges. 0.3.1 / Python 0.1.1 (0315a44).
- 2026-09-11T05:02Z [milestone] First external contribution merged: PR #25 (ariesclark) — between-ends as calendar periods (e499de3). Added CONTRIBUTING/SECURITY and a CI fixture-drift gate alongside; 0.3.2 / Python 0.1.2 (b689c38).
- 2026-09-12T06:48Z [step] Deadline connectors: article forms, "before", late-part deadlines collapse to one candidate (38c6009).
- 2026-09-18T23:20Z [step] Dependency bumps; GitHub Actions pinned to current majors by SHA (4bb7816).
- 2026-10-16T20:30Z [step] Journal created per new global journal policy; backfilled from git history, issues #9–#13/#17/#20, PR #25, and session transcripts.
