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
