# Brief 06: fresh-context review of the spike 3 daemon

Status: dispatched
Author: spike 3 orchestrator (Opus 5.5)
Updated: 2026-09-27
Charter: [spike 3 charter](2026-09-27-spike-3-charter-daemon-file-sync.md), its gate table and its section "Rules for every agent in this spike", which you obey
Plan: [spike 3 plan](2026-09-27-spike-3-plan.md)
Role and model: reviewer, Sonnet, fresh context

## Goal

Find what is wrong with the spike 3 daemon before the lead relies on it: correctness bugs that lose or revert text, claims the gates make that their code does not actually check, and races the tests do not exercise. You report; you do not fix.

## Working directory

`/Users/skk/code/phraise/.claude/worktrees/agent-ad2057bb46c104eec`, spike directory `spikes/2026-09-27-daemon-file-sync-fork-import/`. Absolute paths in every command.

## Inputs to read

1. `AGENTS.md`, `context/docs/2026-09-27-architecture-decisions.md` (D1, D6, D7 only), the charter, the plan.
2. The code: `src/core/` (docsync, diff, versions), `src/daemon/` (daemon, git), `gates/` (especially `fuzz.ts`, `lib/locate-token.ts`, and the gate files A to J). `src/md/` is spike 1's copied model; review only the changes brief 04 made (see the spike README's "Changes to copied code", and `git log` for commit 36462c4).
3. The orchestrator log `context/logs/2026-09-27-orchestrator-spike-3.md` for what was already found and fixed, so you do not re-report it.

## What to check, in priority order

1. **Text loss or reversion paths.** Walk `DocSync.importText` and `chooseBase` with concrete scenarios and find one where a save reverts a remote edit, or loses the user's edit, that the fuzz categories would not flag or would misclassify as accepted (`delete-vs-edit`, `ambiguous-delete`). Pay attention to the fast path (no fork) versus the fork path, the version ring eviction (32 entries, anchor rules), and restart with persisted versions.
2. **The daemon's write guard** (`runExport`): can a user's save be lost between the read and the rename in any path the code handles, beyond the documented microsecond window? Does the in-place-writer recovery path work? Is the git check bypassed anywhere?
3. **Gate honesty.** For each gate, does the code check what the charter's requirement says? Look for checks that cannot fail, classifications in `gates/fuzz.ts` that could hide real losses, thresholds that were tuned rather than justified, and numbers printed but not asserted.
4. **Git detection** (`src/daemon/git.ts` and its wiring): a sequence of git commands that changes the file and is imported as the local user's edit, or a plain save that is wrongly treated as a git operation.
5. **The brief 04 cache**: can the persistent parse cache return a stale result when the definitions context or anything else the parse depends on changes?

Run `npx vitest run` and `npm run gates:quick` once each. You may write small throwaway scripts under `$TMPDIR` to demonstrate a bug; put a reproducer for every high-severity finding in your log. Do not run the full gates or the 300-trial fuzz.

Stopping point: all five areas reviewed.

## Deliverable

Your log `context/logs/2026-09-27-reviewer-spike-3.md` with timestamps from `date`: findings by severity (high: text lost or reverted, or a gate claim that is false; medium: a race or misclassification with a plausible real trigger; low: the rest), each with file and line, the scenario, and a reproducer or the reasoning.

## Constraints

- Do not change code. Only add your log. Do not commit; the orchestrator does.
- Do not launch other agents. Bind only to 127.0.0.1 on ports 4100 to 4199; stop every server and process you start; temp dirs only under `$TMPDIR`.

## Handback

Under 300 words: findings by severity, one line each with file and line, and the path of your log.
