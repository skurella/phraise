# Brief 06: gate F on stack 14, spike 2's rebase ported to Yjs 14

Status: done
Author: spike 5 orchestrator (Opus 5.5)
Updated: 2026-09-27
Plan: [spike 5 plan](2026-09-27-spike-5-plan.md). Charter: [spike 5 charter](2026-09-27-spike-5-charter-collab-stack.md), gate F; "Rules for every agent in this spike" binds you.
Model: Sonnet, builder. Serves D5 and D6.

## Goal

Port spike 2's rebase (fork at snapshot, deterministic client ID, word-level two-way diff, merge, per-replica integration, comment anchors) to `@y/y` 14.0.0-rc.26 and `@y/prosemirror` 2.0.0-13, and run the same gate F as stack 13 with live editors through the stack 14 Hocuspocus relay. The charter asks specifically: do fork-at-snapshot and deterministic client IDs exist on Yjs 14, and what had to change.

## Inputs

- **Stack 13's gate F, finished and passing**: `/Users/skk/code/phraise/.claude/worktrees/agent-a9ca7fc64553beeea/spikes/2026-09-27-collab-stack-yjs13-hocuspocus/` — `src/rebase/` (spike 2's code as adapted for live use, including `liveIntegration.ts`), the rebase route in `src/relay.ts`, `gates/gateF.ts`, the README's gate F section, and its builder's log `context/logs/2026-09-27-builder-spike-5-stack13-rebase.md` (read the relay self-ack bug). Your gate F must check the same things. **Copy**, never import across directories.
- Spike 2's original code, read-only: `/private/tmp/claude-501/-Users-skk-Library-Application-Support-Claude-scratch-workspaces-92acd837-26ab-4632-a512-01d178a06808-3d728634-4a64-405d-b4d8-e171544ef5b7-scratch-2026-09-26-c82a4d/8ff8ca9f-bda4-46ee-967d-cafcb461e5a1/scratchpad/ref/spikes/2026-09-27-crdt-rebase-yjs-fork/` (origin `spike/2026-09-27-crdt-rebase` at `88bd85c`), and spike 2's Yjs 14 attribution probe `.../ref/spikes/2026-09-27-crdt-rebase-binding-probe/test/yjs14-attribution.spec.ts`, which already forked a `@y/y` document at a snapshot with `gc: false`.
- Stack 14 package: `/Users/skk/code/phraise/.claude/worktrees/agent-a9ca7fc64553beeea/spikes/2026-09-27-collab-stack-yjs14-rc/` (Hocuspocus relay with the dedupe postinstall, all gates but F done). `@y/y` exports `createDocFromSnapshot`, `snapshot`, `encodeSnapshot`, `decodeSnapshot`, `createInsertSetFromStructStore`, and `Doc.clientID` is assignable (the upstream demo does it).
- Representation: in Yjs 14 a paragraph is one `Y.Node` with inline text and inline element children in the same sequence, with marks as formatting attributes produced by `@y/prosemirror`'s own encoding (`pmnodeToDelta`, `marksToFormattingAttributes` in `node_modules/@y/prosemirror/src/sync-utils.js`). Spike 2's `diff.ts` emits Yjs 13 operations on `Y.XmlElement` and `Y.XmlText`; the emitter must be rewritten for `Y.Node`, and whatever it writes must be exactly what the binding would write, or the editors will see a different document.

## Ordered tasks

Stopping point: task 5 done, or two genuinely different approaches to task 2 fail (log both, hand back with an account of why).

1. Copy stack 13's `src/rebase/` (with spike 2's schema and Markdown converter) into the stack 14 package and port the pure parts. Seed deterministically with `pmnodeToDelta` + `applyDelta` under a fixed client ID; verify two independent seeds are byte-identical.
2. Port the diff emitter to `Y.Node`. Preferred: keep spike 2's block alignment and word-level text diff, and emit `Y.Node` operations (insert, delete, format, setAttr) using `@y/prosemirror`'s own encoding for inserted nodes and marks. Fallback if that proves intractable: apply `delta.diff` of the fork's current delta against `pmnodeToDelta(pmB)` per changed block, and measure how the granularity differs (spike 2 found word granularity mattered for comment anchors). Either way assert, as spike 2 did, that after the diff the fork reads back (`ynodeToPmnode`) equal to commit B.
3. Port the rebase (`createDocFromSnapshot`, deterministic client ID, export the fork's update since the fork point), integration (needs-review, resurrection) and comment anchors (`RelativePosition` on `Y.Node`; check what `createRelativePositionFromTypeIndex` means for inline content in Yjs 14). Run spike 2's headless gates A to D on stack 14 before going live.
4. Live: relay route, `gc: false` everywhere, the `beforeTransaction`/`afterTransaction` integration hook on clients and the relay (with the relay self-ack fix), live editors with `syncPlugin` on spike 2's schema. **Gate F** with the same sub-checks and the same continuous-typing variant as stack 13.
5. Row F in `npm run gates` and `gates:quick`; README section listing every change from spike 2 and from stack 13's port, with line counts of what was rewritten.

## Definition of done

`npm run gates:quick` passes F (or F fails with a documented account after task 2's two attempts); `npx tsc --noEmit` clean; no relay left running (`lsof -nP -iTCP:4240-4269 -sTCP:LISTEN` empty).

## Constraints

- Working directory `/Users/skk/code/phraise/.claude/worktrees/agent-a9ca7fc64553beeea`, absolute paths. Ports 4240 to 4269 on 127.0.0.1.
- Touch only the stack 14 directory and your own log. Do not break existing gates. Commit with explicit paths, no push. Do not launch further agents.
- Log: `context/logs/2026-09-27-builder-spike-5-stack14-rebase.md`, timestamps from `date` only.

## Handback, under 300 words

Gate F per sub-check; which emitter approach worked; what changed from spike 2 and stack 13's port, with rewritten line counts; anything in Yjs 14 that was missing or behaved differently; failures and skips; commits; no relay running.
