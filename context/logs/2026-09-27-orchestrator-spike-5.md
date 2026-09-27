# Orchestrator log, spike 5: live collaboration stack

Status: active
Author: spike 5 orchestrator (Opus 5.5)
Updated: 2026-09-27
Charter: [spike 5 charter](../plans/2026-09-27-spike-5-charter-collab-stack.md)
Time zone: CEST (machine local). Every timestamp below is from `date` at the moment of writing.

## 07:49 — Task received
Worktree `/Users/skk/code/phraise/.claude/worktrees/agent-a9ca7fc64553beeea`, branch `spike/2026-09-27-collab-stack` at `0c2455e`. Read AGENTS.md, architecture decisions, agent workflow, charter, spike 1 and spike 2 findings (via `git show`), technology assessment section A.

## 07:54 — Plan and brief 01 written
Chose jsdom live editors, relay as child process, ports 4210-4239 (13) / 4240-4269 (14) / 4270-4299 (me). Recon: Hocuspocus 4.7 imports only Doc, applyUpdate, encodeStateAsUpdate, mergeUpdates, snapshot, snapshotContainsUpdate from yjs, so aliasing to @y/y is plausible. @y/y rc.26 exports createDocFromSnapshot, @y/prosemirror 2.0.0-13 exports yCursorPlugin, yUndoPlugin, accept/rejectAllChanges. Tiptap collaboration 3.31.3 peers on yjs ^13 and y-tiptap. Stack 13 workaround choice: leafMarks plugin plus root-attrs map plugin, binding unpatched.

## 08:54 — Brief 01 handback received
Gates A, B, C pass per builder; C 265/266 server-seeded, 266/266 client-loaded; one unexplained lead loss on npm-bull-readme. Commits e4c84c6, c19fe29. Verifying myself next.

## 08:56 — Verified brief 01; fixed root-attrs race
Ran full `npm run gates` (64 s): A pass (23 ms median, poll-bound), B pass, negative control shows the loss, C 266/266 on both paths after my fix. Cause of the builder's 1/266: rootAttrsPlugin.appendTransaction compared doc.attrs with the map on every transaction, so when a remote update's fragment observer fired before the map observer it wrote the editor's default attrs over the synced map. npm-bull-readme is the only corpus file with non-default lead. Fix: write only when the transactions changed doc.attrs. Finding for the doc: the workaround is order-sensitive and easy to get subtly wrong; builder also found plugin order matters (leafMarks before rootAttrs).
