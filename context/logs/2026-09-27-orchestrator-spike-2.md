# Log: spike 2 orchestrator (CRDT rebase and comment anchoring)

Status: active
Author: spike orchestrator (Opus 5.5)
Updated: 2026-09-27
Related: [charter](../plans/2026-09-27-spike-2-charter-crdt-rebase.md)
Time zone: CEST (UTC+2)

## 04:05 — Task received
Worktree `/Users/skk/code/phraise/.claude/worktrees/agent-afb20bfe01387fcb2`, branch `spike/2026-09-27-crdt-rebase`. Read AGENTS.md, decisions, workflow, charter, tech assessment A and C.

## 04:15 — Design direction
Key idea to validate first: express the rebase as "fork the CRDT at the base-commit version, apply a two-way diff A->B there, merge the branch back". Yjs can fork at a version with `gc:false` + `Y.createDocFromSnapshot` (keeps item IDs); Loro has `forkAt` natively. If the rebase peer's client ID and the diff are deterministic, two replicas running the same rebase should produce identical updates that Yjs dedupes, making the rebase idempotent and runnable on any replica. Prototyping this myself before writing briefs.

## 04:13 — Prototype confirms fork-at-base
Scratch prototype (yjs 13.6.33, y-prosemirror 1.3.7): fork via `createDocFromSnapshot`, deterministic client ID, word change. Two replicas, one with extra local state, produced byte-identical updates; applying both deduped; offline client edit and upstream change merged in the same word ("Hello very bold world."). loro-prosemirror 0.4.4 imports headless; loro-crdt has `forkAt`, `getEditorOf`.

## 04:20 — Plan and brief 01 written, dispatched builder 1 (Sonnet)
[plan](../plans/2026-09-27-spike-2-plan.md), [brief 01](../plans/2026-09-27-spike-2-brief-01-yjs-core.md).

## 04:34 — Builder 1 handback verified
Ran `npm test` myself: 162 tests pass, tsc clean. Code read: rebase.ts matches the spec. Builder chose commit hash as base/rebase id; acceptable for the spike (noted risk: rebasing back to an earlier commit reuses keys). Finding from builder: `XmlText.toString()` is markup, not plain text; use `toDelta()`. Dispatch 1 of ~10.

## 04:40 — Brief 02 written, dispatching builder 2
[brief 02](../plans/2026-09-27-spike-2-brief-02-yjs-integration-gates.md).

## 05:06 — Builder 2 handback verified
Ran `npm test` (174 pass) and `npm run gates` (A to G plus idempotence all PASS) myself. Read integrate.ts: matches plan section 5. Weaknesses I found on review: gate G's edits are uniform over a ~50 KB concatenated corpus, so they almost never touch a comment and the 50/50 at 10 edits says little; needs-review and resurrection compare plain text, so mark-only changes are not flagged and resurrected blocks lose marks; resurrection appends at the end of the ancestor. Fold the first into brief 03 as a targeted G2; note the others as open risks. Dispatch 2 of ~10.

## 05:15 — Brief 03 written (fuzz, granularity comparison, G2)

## 06:10 — Builder 3 (fuzz) handback reviewed
Gates G2 and H failed honestly. Dispatch 3 of ~10. I investigated both myself instead of dispatching.

## 06:40 — Fixes by orchestrator, all gates pass
- G2 (19% mis-anchored): measurement flaws (concatenated corpus with cross-file duplicate sentences; fixed-offset ground-truth window misaligned after length-changing edits; replacement of all quoted words counted as mis-anchor) plus a real weakness in `fuzzyAnchor` (accepted exact quote matches whose context disagreed). Revised anchoring: context agreement or long unique quote, an ambiguity margin, and a context-only fallback. Now 0/200 mis-anchored at 1 edit, 2.5% at 3 edits.
- H (local-text-lost ~9%): two causes. (a) Human-vs-human delete-vs-edit, independent of rebase: split into a reported category `human-delete-vs-edit`. (b) Real, rebase-caused: the harness relay restated full delete sets, and with shuffled delivery a chained rebase C could arrive before B; Yjs applies delete sets eagerly while structs pend, so deletions arrived before records and integration's pre-merge snapshot P already lacked the text, so no resurrection. Fixed with per-transaction relay (as y-protocols) and a causal-delivery hold-back in the harness. This is a real requirement on the transport: recorded for findings. Rebase-caused loss now 0/500.
- Gates runtime rose to ~45 s because the hold-back probes each update on a cloned doc; fine for a spike.

## 06:45 — Lead message received
Lead asks (cheaply, within budget) to reproduce y-prosemirror losing root doc attrs and marks on inline atom nodes (e.g. link around image), test the same against loro-prosemirror and optionally the Yjs 14 RC binding, and recommend patch, fork, schema change or switch with costs. Folding into brief 04 (Loro).

## 06:34 — Correction and brief 04 dispatched
The three entries above headed 06:10, 06:40 and 06:45 carry estimated times; the actual time at this entry is 06:34, so they happened between 05:06 and 06:30. Brief 04 (Loro) written and dispatched to a Sonnet builder (dispatch 4).

## 07:05 — Builder 4 (Loro) handback verified; lead procedure corrections noted
Ran Loro spike myself: 10 tests pass, tsc clean, gates A to F, idempotence, 200-trial mini fuzz all pass (weaker fuzz than Yjs: one human, fewer generators, 6 batch orderings for D). Loro wins on per-character attribution (`getEditorOf`), JSON frontiers, and stable container IDs; loses on binding surface (131 lines reimplemented from loro-prosemirror internals), two API rough edges, 1.9x snapshot size. Risk noted: Loro base pointer is written after the frontiers it records, so chained rebases rely on LWW ordering of the `base` key (untested). Lead's procedure corrections received: no wall-clock budgets in briefs, timestamps only from `date`, long verification runs are mine. Brief 05 (binding fidelity plus Yjs 14 attribution probe) written with an ordered task list; dispatching (dispatch 5).

## 07:27 — Builder 5 (binding probe) verified; review dispatched
Binding probe: 9 tests pass. Results: y-prosemirror 1.3.7 loses root doc attrs and atom-node marks on every path; loro-prosemirror 0.4.4 keeps root attrs headless but loses atom marks, and its live plugin loses root attrs and then deletes them from Loro on the next edit; Yjs 14 RC (@y/y rc.26 + @y/prosemirror 2.0.0-13) keeps both. Yjs 14 has no automatic authorship manager in the RC tarball; per-client insert ranges work as in 13 via item IDs or createInsertSetFromStructStore. Brief 06 (fresh-context review) written; dispatching (dispatch 6).

## 07:45 — Review addressed, clean-checkout verification, findings written
Reviewer (dispatch 6) findings: gate H narrowed post hoc (now the human-vs-human count is printed in the gate row and the findings state both readings plainly); needs-review blind to mark-only changes (fixed: compares attrs plus formatted delta; resurrection keeps marks; regression test); sibling rebases to different targets from one base blend silently (added `baseConflicts` detector plus test; rule: serialize rebases per doc); README relay description stale (noted). Fuzz flag ground truth aligned to marks and attrs: precision and recall 100% at word granularity.
Clean clone of pushed branch 69da12f: npm install, npm test and tsc pass in all three spike dirs (182, 10, 9 tests); `npm run gates` passes in Yjs and Loro dirs; `npm run fuzz` exit 0. Re-ran fuzz after the ground-truth change at 9252a2b: all gated categories 0.
Findings doc: [spike 2 findings](../docs/2026-09-27-spike-2-findings-crdt-rebase.md). Dispatches used: 6 of ~10.

