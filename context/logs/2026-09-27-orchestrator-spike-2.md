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
