# Brief 04: the same rebase on Loro (gate I)

Status: done
Author: spike orchestrator (Opus 5.5)
Updated: 2026-09-27
Related: [plan](2026-09-27-spike-2-plan.md), [charter](2026-09-27-spike-2-charter-crdt-rebase.md) gate I
Assignee: builder (Sonnet)

## Goal

Implement the fork-at-base rebase on Loro far enough to judge, against the working Yjs implementation, whether Loro makes it materially simpler or more correct, how mature `loro-prosemirror` is, and what switching would cost. Serves D5.

## Scope

New self-contained package `spikes/2026-09-27-crdt-rebase-loro-fork/` (TypeScript, npm, vitest; `loro-crdt@1.16.3`, `loro-prosemirror@0.4.4`). No imports from the Yjs spike: copy what you need (schema, Markdown parsing, the two-way tree alignment in `diff.ts`, fuzz helpers, corpus) and note the origin at the top of each copied file.

1. **Document layout**: store the ProseMirror doc exactly the way `loro-prosemirror` does (read its source in `node_modules/loro-prosemirror`: root map, `nodeName`, `attributes`, `children` list, `LoroText` with marks, and its mark expand config). Seed from Markdown with a deterministic peer ID via `doc.setPeerId`, and convert back with `createNodeFromLoroObj` or equivalent. Round-trip every corpus file (copy `fixtures/corpus/` from the Yjs spike). If `loro-prosemirror` cannot be used headless, write the mapping yourself, verify it against the library's own reader, and record that as a finding.
2. **Rebase**: base = frontiers stored in the doc (or alongside). `fork = live.forkAt(baseFrontiers)`, deterministic `setPeerId`, apply the two-way diff pmA to pmB (word granularity, marks via `LoroText.mark`/`unmark`), assert the fork equals pmB, export updates since the fork point, import into live. Check idempotence: two replicas computing the same rebase produce identical bytes, or at least importing both yields no duplication.
3. **Integration**: needs-review via Loro's own version tools (for example `doc.diff(frontiersA, frontiersB)` for upstream changes and the pre-import frontiers for local changes) instead of snapshot rendering. Resurrection for blocks deleted upstream but edited locally, only if simple; otherwise measure the loss and report.
4. **Comments**: Loro `Cursor` (`LoroText.getCursor`, `doc.getCursorPos`) plus the same quote-selector fallback (copy `fuzzyAnchor` from the Yjs spike's current `src/comments.ts`, which the orchestrator revised).
5. **Attribution**: `LoroText.getEditorOf(pos)` plus a peer-to-user map. Say whether it gives per-character authorship directly.
6. **Gates**: `npm run gates` prints A, B, C, D (converge under all batch permutations and 50 shuffled orders), E, F, idempotence, and a mini fuzz of at least 200 trials (text-level local edits, block deletes, upstream mutations; categories exception, diverged, local-text-lost, F-violation).
7. **Assessment notes** in the README and your log: lines of code per concern compared with the Yjs spike (`wc -l`), what was simpler, what was harder, bugs or rough edges found in `loro-crdt` or `loro-prosemirror`, performance per trial, and snapshot and update sizes for the same corpus document in both libraries.

## Non-scope

UI, network, re-seed (gate G), the Yjs spike's code (read it, do not modify it).

## Inputs

AGENTS.md; the [plan](2026-09-27-spike-2-plan.md); the Yjs spike's README (especially the orchestrator revision section) and `src/` as reference.

## Definition of done

From the new directory: `npm install && npm test && npm run gates` succeed or fail honestly with categorized reasons; `npx tsc --noEmit` clean; README with goal, status, how to run, and the assessment notes. Commit.

## Constraints

- Model Sonnet. Effort budget about 3 hours; if exceeded, stop, log, hand back partial with a clear state. Partial but honest beats complete but shallow; prioritize 1, 2, 4, 5, 3, 6 in that order.
- Working directory `/Users/skk/code/phraise/.claude/worktrees/agent-afb20bfe01387fcb2`, absolute paths. No agents. Only add new files outside your spike directory. Stage explicitly. Do not push.
- Log: `context/logs/2026-09-27-builder-spike-2-loro.md`, entries at every milestone and at least every 15 minutes.

## Handback

Under 300 words: gate table, the assessment notes condensed (simpler, harder, bugs, sizes, LOC), commit hash.
