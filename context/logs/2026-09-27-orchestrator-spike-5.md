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

## 08:57 — Brief 02 dispatched (stack 14 core)

## 09:35 — Brief 02 handback received
Custom relay works; Hocuspocus alias fails on lib0 0.2/1.0 duplication (per builder); B pass without workarounds; C path A 266/266, path B 234/266 blamed on @y/prosemirror pmNodeDiff; 13->14 read ok, 14->13 fails. Commit 2138c19. Verifying the path B claim and retrying the Hocuspocus alias with lib0 overridden.

## 09:41 — Verified brief 02; two corrections
1. **Hocuspocus 4.7 does work with Yjs 14.** The builder's crash had two causes, both install-layout: two lib0 majors, and two module instances of @y/y (the npm alias installs @y/y a second time under node_modules/yjs, so Hocuspocus's Doc class differs from @y/prosemirror's; Yjs prints its 'already imported' warning). In a scratch copy with overrides lib0=$lib0 and node_modules/yjs, node_modules/y-protocols symlinked to @y/y, @y/protocols, the builder's own attempt-(a) relay and client synced two editors, carried root attrs and linked images, and /state matched (port 4271, stopped). Needs a postinstall dedupe step or a bundler alias.
2. **@y/prosemirror 2.0.0-13 has its own atom-mark loss**, reproduced minimally in spikes/...yjs14-rc/scratch/probe-atom-mark-change.ts: when a transaction replaces an inline atom with one whose attrs AND marks differ (an 'edit image' dialog replacing the node; or any whole-doc replace), the new attrs sync but the old mark stays, in the originating editor too. Mark-only changes (removeMark/addMark) sync fine. Stack 13 with workarounds passes all five cases (twin probe in stack 13 scratch/). This is the real cause of stack 14 gate C path B 234/266.

## 09:44 — Brief 03 dispatched (stack 13 D, E, G, B3)

## 10:47 — Brief 03 handback received
All pass per builder: B3 5/5, D 6/6, E 5/5 (mapping in a Y.Map in the doc), G 5/5, C 266/266 with 17.19 MB state; one 265/266 flake in four runs. Commits dbe0138, 3f26040. Running full gates myself.

## 10:51 — Verified brief 03 (full gates all pass, 0 listeners); brief 04 dispatched
Research for brief 04: y-prosemirror CAVEATS.md states v1 documents load in the new binding but the old binding cannot read new documents, so no mixed clients (matches the compat probe). The official Yjs 14 backend @y/hub 0.9.0 is AGPL-3.0 OR PROPRIETARY and needs Redis, Postgres and S3. Suggestion mode is a second Y.Doc plus DiffRenderer (upstream yhub-tiptap-demo).
