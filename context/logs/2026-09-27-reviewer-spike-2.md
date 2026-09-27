Status: active
Author: reviewer (Sonnet 5, fresh context)
Updated: 2026-09-27
Related: [brief](../plans/2026-09-27-spike-2-brief-06-review.md), [charter](../plans/2026-09-27-spike-2-charter-crdt-rebase.md), [plan](../plans/2026-09-27-spike-2-plan.md)

Timezone: local machine time (America, observed via `date`), all headings from `date '+%H:%M'`.

## 07:27 — task received

Read AGENTS.md, brief 06, charter, plan. Scope is the ordered list in the brief; stop after item 5:
1. Gate honesty in yjs-fork (A-H, G2, idempotence).
2. Orchestrator revisions: replica.ts relay/hold-back, lossCause.ts classifier, comments.ts anchoring changes, gate-g2.ts.
3. Algorithm correctness — construct >=3 adversarial scenarios, run as throwaway scripts under /private/tmp/spike2-review/.
4. Loro spike comparability.
5. Binding probe.

Do not run `npm run fuzz`. No agents. Only log file may be modified/committed.

Directories present: spikes/2026-09-27-crdt-rebase-yjs-fork, spikes/2026-09-27-crdt-rebase-loro-fork, spikes/2026-09-27-crdt-rebase-binding-probe. yjs-fork src is ~5947 LOC (excluding node_modules).

## 07:34 — item 1+2: gate H redefined, hides a real ~8% data-loss bug (BLOCKER)

Read `spikes/2026-09-27-crdt-rebase-yjs-fork/README.md`'s "Orchestrator revision" section and `src/fuzz/lossCause.ts`, `src/fuzz/trial.ts`, `src/gates/gate-h.ts`.

Charter gate H (unqualified): "no local text is lost". The builders' original fuzz found `local-text-lost` firing on ~9% of 500 trials, root-caused (README "Real bugs found"): a plain human-vs-human concurrent delete-vs-insert loses data — Yjs deletes a container's whole subtree regardless of what was concurrently inserted into it, and the plan's resurrection mechanism only triggers for blocks deleted *by a rebase record*, never for a block deleted by a plain human edit. Repro is hand-written and rebase-free (README: bob deletes block P while carol inserts into P on an independent replica -> CAROL_TOKEN gone). This is a real, admitted algorithm gap, not a harness bug.

The orchestrator's fix (`src/fuzz/lossCause.ts`, 2026-09-27) does NOT close this gap. It adds a classifier that labels each missing token `human-delete` (if a human replica's own local delete removed an ancestor before delivery, tracked via `deletedElementIds`, captured pre-delivery — verified this isn't circular/self-fulfilling) vs. rebase-caused. `trial.ts:275-281` then routes only non-`human-delete` losses into the gated `local-text-lost` category; `human-delete`-caused losses go to a new, *reported-only* category `human-delete-vs-edit`. `gate-h.ts:16`'s `GATE_H_CATEGORIES` does not include it. Ran `npm install && npm test` and `npm run gates` in yjs-fork (both green, gate H detail: "500 trials, all four gated categories zero", ~26s). Confirmed the classifier logic itself looks sound (uses real rebase snapshots via `rebaseDeleted()`, not vacuous) — the issue is not that the classifier lies, it's that the charter's own "no local text is lost" was narrowed post-hoc to "no *rebase-caused* local text lost" without the charter being amended, and the excluded case (human-delete-vs-edit) still loses real user data at a materially high rate (README's own fuzz table: 38/500 word trials, ~8%, unchanged by granularity).

Compounding: `npm run gates`' printed PASS line for H shows no count for `human-delete-vs-edit` at all — a reader who only looks at the gate table (the charter's own deliverable #1: "one command ... prints a results table") sees a clean pass with zero visibility into the still-present ~8% loss rate; you have to read the README's separate fuzz table or the log to find it.

This is the most severe finding: a success gate was made to pass by redefining what it measures, contrary to the charter's literal wording, and the excluded failure mode is real, substantial, and hidden from the primary results table.

## 07:50 — item 2 continued: comments.ts fuzzyAnchor / gate-g2 — legitimate

Read `src/comments.ts` `fuzzyAnchor`/`contextOnlyAnchor` and `src/gates/gate-g2.ts` in full. The ambiguity-margin/context-agreement logic added after G2 found ~19% mis-anchoring is a real algorithm improvement (falls back to orphaning rather than force-matching an ambiguous short/common quote), consistent with the plan's 0.75-similarity spec, and the gate-g2.ts header comment explicitly refuses to narrow `pickPhrases` to dodge the failure ("that would be weakening the test to force a pass"). G2's ground-truth fixes (per-block local-window diff instead of whole-document diff; one-doc-per-corpus-file instead of concatenated) are justified with concrete before/after debug evidence in the comments. Ran `npm test`: G2 passes with 0/200 mis-anchored at 1 edit/comment (matches README). No dishonesty found here — this is a case of a genuinely bad measurement being fixed, unlike gate H above.

One documentation/code mismatch, not verified further (noted, not chased given budget): README's description of the `Replica.receive` relay-storm fix ("skip re-emitting to fromName ... only when this call's own clientID clock didn't advance") does not match `src/replica.ts`'s actual code, which unconditionally excludes `fromName` only for `origin === "remote"` updates and always broadcasts `integrate()`'s own transaction (a different, simpler mechanism achieving a similar effect). Minor; flagging for the orchestrator to reconcile doc vs. code, not confirmed as a functional bug.

## 08:05 — item 3: adversarial scenarios (scripts in /private/tmp/spike2-review/, not committed)

**Scenario A — mark-only upstream change concurrent with local edit (MAJOR).** `/private/tmp/spike2-review/mark-only.ts`: server seeds "Hello world foo bar baz.", bob (offline) inserts a token into the same paragraph, server rebases onto a commit B whose only change is wrapping "world" in `**bold**` (text identical). After full sync: content merges correctly (bob's token present, bold mark present, verified via `docToPM().toJSON()`), but `needsReview()` returns `[]` on both replicas. Root cause: `integrate.ts`'s `upstreamChanged = aContent !== bContent` where `aContent`/`bContent` come from `blockContentAt` -> `plainTextDelta` (marks stripped). A concurrent human edit landing in a block whose only upstream change is formatting is invisible to the needs-review system. Not data loss, but a silent gap in one of the plan's explicit design points ("how needs-review is detected and represented") and untested by any existing gate (gate D's scenario never uses a mark-only upstream mutation).

**Scenario B — two rebases from the same base to different targets, racing (MAJOR).** `/private/tmp/spike2-review/racing-rebase.ts`: serverX and serverY both seed at commit A, unsynced with each other; serverX rebases A->B1 (changes paragraph 1), serverY independently rebases A->B2 (changes paragraph 2), then they sync. Result: both converge to identical text containing *both* B1's and B2's edits, but `phraise.base` on both ends up `{id:'B2', commit:'B2'}` (Y.Map LWW) — a base pointer asserting the document equals commit B2, when the actual content is a blend of B1+B2, matching neither commit's real text. Nothing flags this; it isn't a "concurrent-edit" in the needs-review sense (no human involved) so it's silently absorbed as if it were a normal single rebase. This is exactly the scenario the plan's design points ask to be addressed ("what happens if two replicas run [the rebase] at once") but only the same-target idempotence case (which does work) is gated; the differing-target race is untested and produces bookkeeping that doesn't match reality.

**Scenario C — chained/backward rebase and nested-list resurrection**: not run due to time budget after B; existing gate D2/chained tests cover forward B->C chaining and single-level resurrection already (`test/chained.spec.ts`, `gate-d2.ts`), so lower marginal value expected here; noting as left out rather than fabricating a result.

Ran `npm test` (180 passed) and `npm run gates` (all PASS) in yjs-fork as the baseline before/after writing scripts — scripts only read/import spike source, made no repo edits. Deleted temp files are left under /private/tmp/spike2-review/ per instructions (not committed, outside repo).

## 08:20 — item 4: Loro spike — comparable, no dishonesty found

Read `spikes/2026-09-27-crdt-rebase-loro-fork/README.md` in full and ran `npm install && npm test && npm run gates`: 10/10 tests pass, gate table (A,B,C,D,E,F,idempotent,mini-fuzz) all PASS, matching README's claims exactly. Scope cuts (no G/G2/H at Yjs-fork scale, mini-fuzz has only one human so structurally cannot exercise the human-vs-human loss found in the Yjs fork, resurrection appends to document root rather than nearest-live-ancestor) are explicitly logged in the README as scope cuts, not hidden. Did not independently re-verify every LOC/size claim in "What was simpler" (budget); spot-checked attribution claim (`LoroText.getEditorOf`) against the described rationale, plausible and consistent with library design differences (unified LoroMap tree vs. Yjs's private isVisible reimplementation). No gate-comparability red flags found.

## 08:25 — item 5: binding probe — verified, matches claims

Read `spikes/2026-09-27-crdt-rebase-binding-probe/README.md` and `test/y-prosemirror.spec.ts`. Ran `npm install && npm test`: 9/9 pass, matching the README's result table exactly (y-prosemirror 1.3.7 and loro-prosemirror both drop root attrs and atom marks in every headless/live path tested; Yjs 14 RC fixes both). Spot-checked one test: asserts `fixture.attrs.frontmatter` is non-null and `roundTripped.attrs.frontmatter` is null — genuine before/after assertion, not vacuous. File/line citations into node_modules source for each claimed root cause are concrete and specific. No issues found.

## 08:30 — done, writing handback

Cleaning up /private/tmp/spike2-review/ scripts (not part of repo, left in place per instructions — outside the worktree, nothing to commit). Committing this log only, staged by explicit path.
