# Brief 05: gate F on stack 13, spike 2's rebase with live editors

Status: done
Author: spike 5 orchestrator (Opus 5.5)
Updated: 2026-09-27
Plan: [spike 5 plan](2026-09-27-spike-5-plan.md). Charter: [spike 5 charter](2026-09-27-spike-5-charter-collab-stack.md), gate F; "Rules for every agent in this spike" binds you.
Model: Sonnet, builder. Serves D5 and D6.

## Goal

Run spike 2's rebase scenario and its gates A to D on stack 13 with live editors connected through the Hocuspocus relay while the rebase happens. Spike 2 proved the algorithm headless with an in-memory replica harness; this brief replaces that harness with the real relay and real `EditorView`s and reports what had to change.

## Inputs

- Spike 2 code (read-only reference), origin branch `spike/2026-09-27-crdt-rebase`, commit `88bd85c`: `/private/tmp/claude-501/-Users-skk-Library-Application-Support-Claude-scratch-workspaces-92acd837-26ab-4632-a512-01d178a06808-3d728634-4a64-405d-b4d8-e171544ef5b7-scratch-2026-09-26-c82a4d/8ff8ca9f-bda4-46ee-967d-cafcb461e5a1/scratchpad/ref/spikes/2026-09-27-crdt-rebase-yjs-fork/`. Read its README (especially "Orchestrator revision"), `src/seed.ts`, `src/rebase.ts`, `src/integrate.ts`, `src/comments.ts`, `src/replica.ts`, `src/gates/scenario.ts`, `src/gates/gate-a-c.ts`, `src/gates/gate-b.ts`, `src/gates/gate-d.ts`, `src/gates/gate-d2.ts`, `src/gates/gate-idempotent.ts`. The spike 2 findings summary is in the charter's reuse section; the algorithm in one line: fork with `Y.createDocFromSnapshot(live, S_A)`, set a deterministic client ID, apply a word-level two-way diff A to B on the fork, export the fork's update since the fork point, apply it to the live document; each replica runs `integrate` (needs-review flags, resurrection of blocks deleted upstream but edited locally) before applying a remote batch, using a snapshot P of its own state just before the merge.
- Stack 13 package (all gates but F pass): `/Users/skk/code/phraise/.claude/worktrees/agent-a9ca7fc64553beeea/spikes/2026-09-27-collab-stack-yjs13-hocuspocus/`. Read its README, `src/relay.ts`, `src/client.ts`, `src/harness.ts`.

## Design constraints (decided by the orchestrator)

- Copy spike 2's `src/` files into `src/rebase/` of the stack 13 package, with spike 2's own schema and Markdown converter (the rebase code is written against it; do not port it to spike 1's schema). Record the origin in the README. Change copied files only where the live setting requires it, and list every change.
- The rebase runs **on the relay**, serialized per document (spike 2 decision S2-3): for example an HTTP route `POST /rebase/<docName>` with the target Markdown and commit id, executed on the relay's in-memory document through Hocuspocus's direct connection or document transaction, so the result is broadcast to connected editors like any other update. A retry of the same rebase must be a no-op (idempotence).
- Documents are `gc: false` on the relay and on every client (Hocuspocus has a Y.Doc options setting; find it).
- The per-replica integration step needs the replica's state just before a remote batch is applied. In live clients, use the `Y.Doc`'s `beforeTransaction` / `afterTransaction` events for transactions whose origin is the provider: take a snapshot before, and after the transaction run `integrate` if it brought a new rebase record. Document exactly how, and whether the needs-review writes and resurrections then flow back through the relay correctly. The relay itself also integrates (it is a replica).
- The seed must be deterministic as in spike 2 (the relay seeds `rebase:<name>` documents from Markdown with spike 2's `seedDoc`).

## Ordered tasks

Stopping point: task 5 done, or two genuinely different attempts at the integration hook fail (log both, hand back with an account).

1. Copy and compile spike 2's code in the stack 13 package; run spike 2's own headless gates A to D there unchanged as a baseline (they must pass as in spike 2).
2. Relay: `rebase:` seeding, gc off, the rebase route, relay-side integration.
3. Live clients for spike 2's schema: `EditorView` with `ySyncPlugin` on spike 2's fragment name, `gc: false` docs, the integration hook, comment anchors created from an editor (spike 2's `addComment` on the client's doc is fine).
4. **Gate F**: spike 2's scenario with alice online and bob's editor offline (provider disconnected) while he edits, the relay rebases onto commit B while alice's editor is connected, then bob reconnects. Check spike 2's gates A (untouched anchor resolves identically), B (rewritten paragraph: anchor survives or is recovered by quote), C (deleted paragraph: comment orphaned, quote kept, negative control not captured), D (offline and upstream edits to the same paragraph both survive and the block is flagged in the shared `review` map; D2 resurrection once); plus: both editors and the relay converge to identical ProseMirror JSON, every block nobody touched equals commit B, and a retried rebase changes nothing. Also run one variant where alice types continuously while the rebase is applied.
5. Row F in `npm run gates` (and in `gates:quick`), README section: what had to change from spike 2 and why.

## Definition of done

`npm run gates:quick` passes including F; `npx tsc --noEmit` clean; no relay left running (`lsof -nP -iTCP:4210-4239 -sTCP:LISTEN` empty).

## Constraints

- Working directory `/Users/skk/code/phraise/.claude/worktrees/agent-a9ca7fc64553beeea`, absolute paths. Ports 4210 to 4239 on 127.0.0.1.
- Touch only the stack 13 directory and your own log. Do not break the existing gates. Commit with explicit paths, no push. Do not launch further agents.
- Log: `context/logs/2026-09-27-builder-spike-5-stack13-rebase.md`, timestamps from `date` only.

## Handback, under 300 words

Gate F result per sub-check; what changed from spike 2 and why; how the integration hook works on live clients; failures and skips; commits; no relay running.
