# Brief 02: stack 14 foundation, gates A, B, C, Yjs 13/14 compatibility probe

Status: done
Author: spike 5 orchestrator (Opus 5.5)
Updated: 2026-09-27
Plan: [spike 5 plan](2026-09-27-spike-5-plan.md) (the "Choices" and "Common gate harness" sections are part of this brief)
Charter: [spike 5 charter](2026-09-27-spike-5-charter-collab-stack.md), section "Rules for every agent in this spike" binds you.
Model: Sonnet, builder. Serves D5.

## Goal

Build the stack 14 package: `@y/y` 14.0.0-rc.26 and `@y/prosemirror` 2.0.0-13, a relay that works with them, two live ProseMirror editors under jsdom, and spike 1's schema, parser and serializer with **no workarounds**. Answer gates A, B and C for this stack with the same harness and edit script as stack 13, so the two are directly comparable. Also establish whether Yjs 13 and Yjs 14 can read each other's documents.

## Directory

`spikes/2026-09-27-collab-stack-yjs14-rc/` (create it), self-contained like stack 13.

## Inputs

- **Stack 13, finished and verified:** `/Users/skk/code/phraise/.claude/worktrees/agent-a9ca7fc64553beeea/spikes/2026-09-27-collab-stack-yjs13-hocuspocus/`. Read its README, `src/relay.ts`, `src/client.ts`, `src/harness.ts`, `gates/`, `scripts/gates.ts`. **Copy** what you need (the spike 1 core in `src/` except `yjs.ts` and `workarounds/`, `fixtures/live.md`, `corpus/` manifest and handwritten files, `scripts/fetch-corpus.mjs`, the edit helpers and gate B script, the equality check). Never import across spike directories. Keep gate B's edit script identical in substance; only the binding calls change.
- Spike 2's Yjs 14 binding probe shows how to wire the live plugin: `/private/tmp/claude-501/-Users-skk-Library-Application-Support-Claude-scratch-workspaces-92acd837-26ab-4632-a512-01d178a06808-3d728634-4a64-405d-b4d8-e171544ef5b7-scratch-2026-09-26-c82a4d/8ff8ca9f-bda4-46ee-967d-cafcb461e5a1/scratchpad/ref/spikes/2026-09-27-crdt-rebase-binding-probe/test/yjs14-prosemirror.spec.ts` (origin: branch `spike/2026-09-27-crdt-rebase`, commit `88bd85c`). Key facts: every shared type is a `Y.Node`; seed with `ytype.applyDelta(pmnodeToDelta(pmDoc))` on `doc.get('prosemirror')`; read with `ynodeToPmnode(ytype, schema)`; bind a view with `syncPlugin()` in the state and then `configureYProsemirror({ ytype })(view.state, view.dispatch)`.
- The orchestrator checked: Hocuspocus 4.7 server imports only `Doc`, `applyUpdate`, `encodeStateAsUpdate`, `mergeUpdates`, `snapshot`, `snapshotContainsUpdate` from `yjs`, and `Awareness` plus the sync message functions from `y-protocols`. `@y/y` exports all of those names. `@y/protocols` 1.0.6-rc.1 and `@y/websocket` 4.0.0-rc.2 exist on npm with `@y/y` as peer.

## Ordered tasks

Stopping point: task 7 done, or all three relay attempts in task 2 fail (then do task 6, log everything and hand back).

1. **Scaffold and copy.** Exact pins: `@y/y@14.0.0-rc.26`, `@y/prosemirror@2.0.0-13`, `@y/protocols@1.0.6-rc.1`, and whatever `lib0` they require. Verify spike 1's no-edit round trip on the real corpus as stack 13 did.
2. **Relay.** Try, in order, and record the outcome of each attempt with the exact error if it fails:
   a. Hocuspocus 4.7 server and provider with npm `overrides` aliasing `yjs` to `npm:@y/y@14.0.0-rc.26` and `y-protocols` to `npm:@y/protocols@1.0.6-rc.1`. Keep SQLite persistence, the `onAuthenticate` token-to-user context, and `GET /state/<docName>` exactly as stack 13 has them.
   b. If (a) fails in a way you cannot fix in the spike's own code: a minimal custom relay on `ws` and `@y/protocols` (sync and awareness), with persistence of the merged update per document to a file or SQLite, the same `/state` route, and a token-to-user hook; client side `@y/websocket` or a small provider of your own.
   Also try (c) as a measurement only: stock Hocuspocus with real Yjs 13 relaying Yjs 14 clients. Expected to fail; record how.
   Relay as a child process, 127.0.0.1, same CLI flags and ready line as stack 13. `onLoadDocument` seeds `file:<relpath>` with spike 1's `parse` then `pmnodeToDelta`; there is no `plain:` control here.
3. **Live client** as in stack 13 with `syncPlugin` from `@y/prosemirror`, no workaround plugins.
4. **Gate A** as in stack 13.
5. **Gate B**: the identical edit script on `fixtures/live.md`, same equality check (whole-doc JSON including `doc.attrs` and marks on inline leaves; serialization succeeds and matches). Also check that the number of Yjs updates stops growing after settling.
6. **Compatibility probe** `scripts/compat.ts` (in a `compat/` subpackage with its own `package.json` if the alias in task 2a prevents having real `yjs@13.6.33` alongside `@y/y`): encode a document with Yjs 13 through y-prosemirror 1.3.7 or y-tiptap and apply the update to an `@y/y` doc, then read it with `ynodeToPmnode`; and the reverse. Report exactly what happens (throws, empty, partial, full), at the byte level if useful. Also report whether a Yjs 13 `Y.XmlFragment`-shaped document is readable by `@y/prosemirror` at all.
7. **Gate C**: both paths as in stack 13 (server-seeded; client-loaded through the live plugin), all real corpus files if the run stays reasonable, report counts, failures with causes, and run time. Report the encoded state size summed over the corpus.
8. **Gate runner and README** as in stack 13 (`npm run gates`, `npm run gates:quick`, results files, rows D to H "not run"). README: goal, status, origin of copied code (stack 13 directory plus spike 1 branch and commit), how to run, relay choice and every relay attempt.

## Definition of done

`npm ci && npm run fetch && npm run gates:quick` passes from the spike directory; `npm run gates` documented. `npx tsc --noEmit` clean (if the RC's types are broken, say so and use narrow local declarations rather than disabling checks globally). No relay left running: `lsof -nP -iTCP:4240-4269 -sTCP:LISTEN` empty.

## Constraints

- Working directory `/Users/skk/code/phraise/.claude/worktrees/agent-a9ca7fc64553beeea`, absolute paths.
- Ports 4240 to 4269 only, 127.0.0.1 only.
- Do not edit anything outside `spikes/2026-09-27-collab-stack-yjs14-rc/` except your own log. Do not touch the stack 13 directory.
- Commit with explicit paths, no push. Do not launch further agents.
- Log: `context/logs/2026-09-27-builder-spike-5-stack14-core.md`, timestamps from `date` only.

## Handback, under 300 words

Outcome per task; which relay works and what failed; gate A, B, C numbers next to stack 13's (A 23 ms, B pass, C 266/266 both paths); compatibility probe result; failures and skips with reasons; commit hashes; no relay running.
