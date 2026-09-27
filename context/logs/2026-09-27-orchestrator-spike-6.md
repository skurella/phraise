# Log: spike 6 orchestrator, integration engine

Status: active
Author: spike 6 orchestrator (Opus 5.5)
Updated: 2026-09-27
Charter: [spike 6 charter](../plans/2026-09-27-spike-6-charter-integration-engine.md)
Time zone: CEST (UTC+2), from `date`.

## 16:06 — task received

Launched by the lead. Worktree `/Users/skk/code/phraise/.claude/worktrees/agent-abba759a655fc9b09`, branch `spike/2026-09-27-integration-engine` at `0913c6d` (charter only).

Source commits for provenance: spike 1 `1e1f4a6`, spike 2 `ab552ed`, spike 3 `9343b62`, spike 5 `eeb3fe2`, spike 4 on `main` at `8dc47ba`.

Reference copies of the four spike directories extracted with `git archive` into the session scratchpad (`ref/spikes/`), for reading only. Nothing is imported from them; code is copied into the spike directory with origin noted.

## 16:12 — reading notes (for later sessions and workers)

Read: AGENTS.md, charter, decisions doc on this branch, amendment sections on the four spike branches (D1 after spike 3; D4, D5 after spike 1; D5, D6, D3 after spike 2; D7 after spike 3; D5 resolved after spike 5), the five findings docs, the workflow doc.

- **Best source per piece.** Markdown: spike 3 `src/md/` (spike 1 plus persistent LRU parse cache); spike 5 adds DOM rules and compare-by-name. Diff: spike 3 `core/diff.ts` (full schema, patience anchors, inline leaves), which supersedes spike 2's `diff.ts` (S3-10). Rebase records, deterministic peers, integration (review, resurrection), comments: spike 2 code as copied into spike 5 `src/rebase/`, but written for spike 2's small schema (`pm` fragment, one XmlText per textblock). **Must be generalized** to spike 1's schema: textblocks with several text runs and inline atoms, tables. Relay, attribution, workaround plugins, live jsdom client: spike 5.
- **Map naming conflict.** Spike 2 uses fragment `pm`, maps `phraise`, `authors`; spikes 1/3/5 use fragment `prosemirror`, map `phraise-doc`; spike 3 `phraise-authors`; spike 5 `phraise-attribution`. Unified in plan section 4.
- **Unifying insight.** Spike 3's `DocSync.importText` (fork at snapshot, diff, verify, repair, merge) is the same operation as spike 2's `computeRebaseUpdate` minus records and deterministic peer. One `forkDiffMerge` in crdt serves rebase, file import and generation import.
- **Open gaps the charter names.** Forged IDs flagged not rejected (S5); serializer degrade, composition, entity escapes, footnote continuation bug, parse cache (S3 to S1); exact tie in base choice (S3 fuzz seeds 439041158, 439041369); memory 731 MB on the 240 KB doc (S3 gate J); generations untested (D1 amendment); draft ref per branch parented on base untested (D2 amendment 3).
- **Draft `.phraise/` in tree vs `git diff` cleanliness.** The amendment puts sidecar data under `.phraise/` in the draft tree, but gate D wants `git diff <branch> <draft>` to show exactly the uncommitted changes. Plan: sidecar in a parentless second-parent commit. Decision to record.
- **Generations and the base snapshot.** After a re-seed from uncommitted content, no snapshot equals the base commit. Plan: seed the base commit first, then fork-diff-merge to the current content, so the base snapshot exists in every generation.
- **Environment.** The Bash tool refuses git commands inside compound shell constructs in this worktree; use single plain git commands. Node 22.12.0, npm 11.0.0.

## 16:12 — plan written

[Plan](../plans/2026-09-27-spike-6-plan.md): module layout, CRDT interface, Y.Doc layout, git layout, relay, generations, daemon, gates, task order. [Brief 01](../plans/2026-09-27-spike-6-brief-01-foundation.md) written.

## 18:18 — milestone 1 built, full gates run, reviewed

Workers: brief 01 foundation (13 tests), brief 02 git storage (15 tests), brief 03 engine (20 tests), brief 04 relay and gates A to E. Dispatches used: 5 of about 18.

Full `npm run gates` by the orchestrator: A pass (relay state 830 B, byte-identical to an independent seed), B pass (1 forged update rejected), C pass, D pass (12 checks), E pass (50 corpus files, 94 edits, 0 containment violations; 108.6 s). Total 1 min 54 s. No port left listening.

Review (brief 05, reviewer log `2026-09-27-reviewer-spike-6-m1.md`): **blocker** — forged updates sent as sync step 2 bypass the check (same apply path server-side), reproduced by the reviewer; gate B only tested the update message. Other gates judged non-vacuous. Look-ahead: whole-document walks in `blockStatesAt`, restore when head moved past the draft base not handled yet. Milestone 1 is therefore not closed until the forgery fix lands; folded into brief 06 as task 1 to save a dispatch.

Decision: forgery rule becomes a clock rule for all message types (other users' clocks the relay lacks are forgery unless the document is in a recovery window after a state loss). Residual stated.
