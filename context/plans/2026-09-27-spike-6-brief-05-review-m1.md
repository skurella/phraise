# Brief 05: fresh-context review of milestone 1

Status: dispatched
Author: spike 6 orchestrator (Opus 5.5)
Updated: 2026-09-27
Plan: [spike 6 plan](2026-09-27-spike-6-plan.md)
Charter: [spike 6 charter](2026-09-27-spike-6-charter-integration-engine.md): "Milestone 1" gates A to E and "Rules for every agent in this spike", which binds you.

## Goal

Find what is wrong with milestone 1 before the spike builds on it: gates that pass without testing what the charter asks (vacuous or weak checks), bugs in the relay, engine, crdt and git modules, violations of the plan's module rules, and anything that would make later milestones (rebase with live editors, daemon, generations, fuzz, scale) fail. You review; you do not fix.

## Inputs

- `AGENTS.md`, the charter, the plan (all sections), briefs 01 to 04 (`context/plans/2026-09-27-spike-6-brief-0[1-4]-*.md`).
- The package `spikes/2026-09-27-integration-engine/`, all of it. Builder logs `context/logs/2026-09-27-builder-spike-6-*.md` if you need the reasoning behind something.
- Decisions: `context/docs/2026-09-27-architecture-decisions.md` (D1 to D7).

## Tasks, in order. Stop when task 5 is done.

1. From a fresh copy: `git clone` this worktree's branch into a temp dir under `$TMPDIR` (single plain command: `git clone --branch spike/2026-09-27-integration-engine /Users/skk/code/phraise/.claude/worktrees/agent-abba759a655fc9b09 <tmpdir>`), then in the package directory `npm ci`, `npm test`, `npm run typecheck`, `npm run gates:quick`. Record results. Note anything that works only in the original worktree.
2. For each gate A to E: read the gate script against the charter's requirement and state whether each check can actually fail when the property is broken. Where you doubt it, prove it with a throwaway mutation (break the property in a scratch copy, run the gate, see it fail), and report the result. Mutations happen in your temp clone only, never in the worktree.
3. Review the modules for correctness against the plan: forged-identity rejection (including what happens to the victim and whether the forger can still sync-step-2 forged content), attribution and `editorsSinceCommit`, draft flush and lease handling (including the merge-and-retry path), restore, commit (trailers, expected head, what happens to the draft after), the integration hook (acks, flags), comments anchoring, the per-document queue, import-boundary rule, resource cleanup (servers, git processes, temp dirs).
4. Look ahead: list what in the current code will obstruct milestone 2 (poll, rebase while typing, commit after head moved, offline return), milestone 3 (daemon on the engine, reported base, generations) and milestone 4 (300-trial system fuzz with relay restarts; memory and latency on a 240 KB document). Performance traps on large documents count (whole-document scans per update, JSON diffs, snapshots per batch).
5. Write findings to your log, grouped by severity (blocker, major, minor), each with file and line, the evidence, and a suggested fix in one sentence.

## Constraints

- Do not edit anything in the worktree except your own log `context/logs/2026-09-27-reviewer-spike-6-m1.md`. Do not commit.
- Stop every server you start; check `lsof -nP -iTCP:4300-4399 -sTCP:LISTEN` at the end. Remove your temp clone.
- Bash refuses commands that mention `git` inside pipes, loops, `cd &&` chains or heredocs; run git commands as single plain commands.
- Handback under 300 words: the top findings by severity with file references, and the mutation results.
