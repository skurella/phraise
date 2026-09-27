# Brief 08: fresh-context review of milestone 2

Status: dispatched
Author: spike 6 orchestrator (Opus 5.5)
Updated: 2026-09-27
Plan: [spike 6 plan](2026-09-27-spike-6-plan.md)
Charter: [spike 6 charter](2026-09-27-spike-6-charter-integration-engine.md): "Milestone 2" gates F, G, H and "Rules for every agent in this spike", which binds you.

## Goal

Find what is wrong with milestone 2: gates F, G and H and the code behind them (forgery clock rule, head poller, rebase with live editors, commit after the head moved, restore behind the head, serializer and parser fixes, best effort plus flag). Judge whether each check can fail when its property is broken. You review; you do not fix.

## Inputs

- `AGENTS.md`, the charter, the plan, briefs 06 and 07, the milestone 1 review log `context/logs/2026-09-27-reviewer-spike-6-m1.md` (to check its blocker is really closed).
- The package `spikes/2026-09-27-integration-engine/`; focus on `src/relay/` (forgery, poller, rebaseHead, commit, seeding, flush), `src/engine/` (rebase, integrate, commit, renderForSave), `src/markdown/` (changes listed in its README), `gates/b.ts`, `f.ts`, `g.ts`, `h.ts`, `test/`.
- Builder logs `context/logs/2026-09-27-builder-spike-6-rebase.md` and `-serializer.md` for reasoning.

## Known already (do not spend effort re-finding)

Gate H's concurrent-formatting check skipped mark boundaries on a space; the orchestrator changed it to count them and it now reports 2 of 78 such cases with a numeric character reference (mark nesting order: em is emitted outside strong when strong spans longer). This will be fixed separately.

## Tasks, in order. Stop when task 5 is done.

1. Fresh clone of this branch into a temp dir under `$TMPDIR` (single plain command: `git clone --branch spike/2026-09-27-integration-engine /Users/skk/code/phraise/.claude/worktrees/agent-abba759a655fc9b09 <tmpdir>`), then `npm ci`, `npm run fetch`, `npm test`, `npm run typecheck`, `npm run gates:quick`. Record results.
2. Gates F, G, H and the extended gate B: for each check, can it fail when the property is broken? Prove doubts with throwaway mutations in the temp clone (for example: make the relay skip `ackOwnRebase`; make integration never flag; drop resurrection; make commit skip the rebase-first step; restore the old message-type exemption in forgery; revert the footnote fix). Report each mutation and whether the gate caught it.
3. Correctness review: the forgery clock rule (can a forger still get new clocks for another user's id applied outside the recovery window? what opens a recovery window, and can a client trigger it?); poller races (a commit and a poll-triggered rebase on the same document at once; two heads in quick succession; rebase while a flush is in flight); the commit retry loop; restore-behind-head; `recordCommit` base-pointer handling and the tie-break bug the builder fixed (is the underlying last-writer-wins exposure closed in general, for example a rebase record written by the relay concurrently with a commit record?); `renderForSave` flag keys and clearing.
4. Look ahead to milestones 3 and 4 (daemon on the engine with reported bases, generations and compaction, a 300-trial fuzz mixing editors, daemon saves, external commits, commits, relay restarts, offline periods and compaction; memory and latency on a 240 KB document). Name concrete obstacles in the current code.
5. Write findings in your log grouped by severity (blocker, major, minor), each with file and line, evidence, and a one-sentence suggested fix.

## Constraints

- Do not edit anything in the worktree except your log `context/logs/2026-09-27-reviewer-spike-6-m2.md`. Do not commit.
- Stop every server you start; check `lsof -nP -iTCP:4300-4399 -sTCP:LISTEN` at the end; remove your temp clone.
- Bash refuses commands that mention `git` inside pipes, loops, `cd &&` chains or heredocs; run git commands as single plain commands.
- Handback under 300 words: top findings by severity with file references, and the mutation results.
