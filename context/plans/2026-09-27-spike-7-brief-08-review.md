# Brief 08: fresh-context review of spike 7

Status: dispatched
Author: spike 7 orchestrator (Opus 5.5)
Updated: 2026-09-27
Plan: [spike 7 plan](2026-09-27-spike-7-plan.md). Charter: [spike 7 charter](2026-09-27-spike-7-charter-web-editor.md).
Model: Sonnet (reviewer, fresh context)

## Goal

An independent check that the spike's gates test what the charter says they test, that the commands work from a clean clone, and that no finding has been hidden. You review and report; you do not fix.

## Inputs

- `AGENTS.md`; the charter (all of it: gates A to K, rules, deliverables); the [plan](2026-09-27-spike-7-plan.md); the [orchestrator log](../logs/2026-09-27-orchestrator-spike-7.md).
- D3, D4 and D5 in the [architecture decisions](../docs/2026-09-27-architecture-decisions.md).
- The code: `spikes/2026-09-27-web-editor-tiptap/` (README, `e2e/`, `test/`, `src/`, `web/src/`, `scripts/`, `playwright.config.ts`).

## Tasks, in order

1. **Clean clone.** Clone the pushed branch `spike/2026-09-27-web-editor` from `https://github.com/skurella/phraise.git` (or, if that fails, from the local worktree path) into a new directory under `$TMPDIR`. In its spike directory run `npm ci`, `npm run setup`, `npm test`, `npx tsc --noEmit`, `npm run gates`. Record each command's result and the gate table. Then run `npm start`, fetch the printed address with `curl`, stop it with SIGINT, and confirm nothing listens on 4400 to 4499. Delete the clone at the end.
2. **Vacuity.** For each gate A to K, read its tests and judge whether the assertions could fail if the feature were broken. For at least three gates of your choice, prove it: make a one-line breaking change in the clone (for example disable a plugin, drop the comment highlight, stop the caret workaround), run that gate's file, confirm it fails, revert. Report which you broke and the result.
3. **Charter conformance.** For every gate, compare what the charter asks with what the tests do, and list gaps: a charter requirement not tested, tested programmatically where the charter says real keyboard, or weakened. Pay attention to: gate A "untouched blocks are byte-identical"; gate B copy puts Markdown and HTML on the clipboard; gate C "HTML preview is sanitized"; gate D linked image address and link together; gate E never removes the other user's typing; gate F highlight follows through the other user's edits; gate G input methods while the other types in the same paragraph; gate H asks for confirmation; gate I reload while offline; gate K p95 while a second user types.
4. **Hidden findings.** Look for places where tests normalize text, retry actions, widen timeouts, `skip`, `fixme` or `fail`, and judge whether each hides a product defect. Look for edits to copied model code (`src/model/`) that change its behaviour, and for anything under `node_modules` being relied on in a fragile way.
5. **Rules.** Check the charter's rules: only new files outside the spike directory; no committed binaries other than screenshots under 300 KB; no `node_modules`, databases, browser binaries or fetched corpora committed; servers bind 127.0.0.1 in 4400 to 4499; tests use `$TMPDIR`.

## Definition of done, and stopping point

Stop when all five tasks are done and written up in your log with evidence (commands and outputs). Do not modify the worktree at `/Users/skk/code/phraise/.claude/worktrees/agent-a40b6e74050a061e9` except to add your log file; all experiments happen in the clone.

## Constraints

- Do not launch other agents. npm, not pnpm. Ports 4400 to 4499 on 127.0.0.1 only. Stop every process you start.
- Log to `context/logs/2026-09-27-reviewer-spike-7.md` in the worktree, timestamps from `date`. Commit only that file, with an explicit path; do not push.

## Handback

Under 300 words: findings ordered by severity (blocker, major, minor), each with evidence and file paths; the clean-clone results; the vacuity experiments; path of your log.
