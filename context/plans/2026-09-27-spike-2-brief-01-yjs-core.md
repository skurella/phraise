# Brief 01: Yjs fork-rebase core

Status: active
Author: spike orchestrator (Opus 5.5)
Updated: 2026-09-27
Related: [plan and algorithm spec](2026-09-27-spike-2-plan.md), [charter](2026-09-27-spike-2-charter-crdt-rebase.md)
Assignee: builder (Sonnet)

## Goal

Build the core of the Yjs rebase: Markdown to ProseMirror, deterministic seeding, the two-way tree diff, and the fork-at-base rebase with records and snapshots. Serves decisions D1, D5, D6.

## Scope

Create `spikes/2026-09-27-crdt-rebase-yjs-fork/` as a self-contained npm package (TypeScript, ESM, Node 22, npm, not pnpm). Implement sections 1 to 4 of the plan:

- `src/schema.ts`, `src/markdown.ts`: schema and `parseMarkdown(md): PMNode`, plus `serializeMarkdown` (prosemirror-markdown's serializer adapted to the schema; used by later fuzz work to produce commit B).
- `src/ids.ts`: `hash32`, deterministic peer IDs.
- `src/seed.ts`: `seedDoc(docId, markdown, commit, author) -> Y.Doc` (gc off, deterministic seed peer, base pointer, `snapshot:<id>`, git author registration). `docToPM(doc)`.
- `src/diff.ts`: `applyTreeDiff(fragment, pmA, pmB, granularity)` for `word`, `char`, `block`, `yprosemirror`.
- `src/rebase.ts`: `computeRebaseUpdate(live, { docId, targetMarkdown, targetCommit, author, granularity }) -> { update: Uint8Array, rebaseId }`. Forks at the current base snapshot, applies the diff, asserts fork content equals pmB (throw otherwise), writes records, returns the fork's update since the fork point. Do not apply it; the caller does.
- `src/text.ts`: doc plain text and offset mapping (plan section 2).
- `README.md`: goal, status, how to run.

## Non-scope

Comments, needs-review, resurrection, replica harness, fuzz, Loro. Later briefs do those.

## Inputs

AGENTS.md; the [plan](2026-09-27-spike-2-plan.md) sections 1 to 4. Useful sources inside `node_modules` after install: `y-prosemirror/src/plugins/sync-plugin.js` (how marks and nodes are encoded, `updateYFragment`), `yjs` `createDocFromSnapshot`. Prototype that proved the fork idea works: the plan's section 1.

## Definition of done

From a clean checkout of the spike directory: `npm install && npm test` passes, with vitest tests that show:

1. Parse-then-seed-then-`docToPM` equals the parsed PM doc for every Markdown file in `fixtures/corpus/` (copy the `.md` files from `context/docs/` and `AGENTS.md` of this repo into it; they are realistic and MIT like the repo).
2. For at least 30 A/B pairs (hand-written edits covering: word change, paragraph rewrite, paragraph insert and delete, heading level change, mark added and removed, link href change, list item added and removed, nested list change, block type change paragraph to heading, code block edit, blockquote edit), for each granularity: the rebased doc with no concurrent edits equals `parseMarkdown(B)`.
3. Concurrent: a live doc with an unsynced edit in a paragraph B does not touch; after applying the rebase update, that edit survives and B's changes are present.
4. Idempotence: two independent replicas (one with extra local edits) compute byte-identical rebase updates; applying both yields no duplication.
5. Chained rebase A to B to C works.
6. `npx tsc --noEmit` is clean.

## Constraints

- Model Sonnet. Effort budget: about 2 hours of work. If you exceed it, stop, log the state and hand back partial.
- Working directory: `/Users/skk/code/phraise/.claude/worktrees/agent-afb20bfe01387fcb2`. Use absolute paths. Do not launch agents. Only add new files. Stage paths explicitly, never `git add -A`, never commit `node_modules`. Commit on the current branch when done with a clear message; do not push.
- Keep your log at `context/logs/2026-09-27-builder-spike-2-yjs-core.md` with entries at every milestone and at least every 15 minutes.

## Handback

Under 300 words: outcome, test counts and command, deviations from the spec and why, known issues, commit hash.
