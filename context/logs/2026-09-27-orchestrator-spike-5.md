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

## 11:40 — Brief 04 handback received
Hocuspocus primary for 14 via postinstall dedupe; B3 FAIL (upstream, expected); D pass with ~35 lines of custom Tiptap extensions; E pass with native IdMap attribution and working suggestion mode (serializer must strip y-attributed marks); G pass. Commit 4d2c59b. Running full gates.

## 11:43 — Verified brief 04 (full stack 14 gates: A, B, D, E, G pass; B3 and C path B fail on the upstream atom-mark bug; 0 listeners). Brief 05 dispatched (gate F, stack 13).

## 12:37 — Brief 05 handback: gate F passes on stack 13 (commits 4e4bce3..e000014); gate C flake recurred (underscore, path B). Investigating the flake myself.

## Gate H evidence (orchestrator, measured and read)
- Measured, export surface of `@y/y` (script in scratchpad `churn/churn.mjs`): rc.0 to rc.10 removed 3 exports; rc.10 to rc.20 removed the whole AttributionManager family (8 exports) for Renderers; rc.20 to rc.24 removed 3 (TwosetRenderer, Attributions, baseRenderer); rc.24 (15 Jul) to rc.26 (7 Sep) removed 7 including the core class `Type` (renamed `Node`) and `$ytype`. `@y/prosemirror` 2.0.0-11 to -12 (21 Sep) removed 4 exports (`pmToFragment`, `fragmentToPm`, `deltaAttributionToFormat`, `defaultAttributionConf`); 2.0.0-4 and -8 fail to import against current lib0 ("reading 'nullable'").
- Read: yjs releases page: 27 v14 RCs from 25 Feb to 7 Sep 2026, most with an empty "Full changelog" body; npm `latest` for @y/y is still rc.7, `beta` is rc.26. y-prosemirror CHANGELOG v2.0.0-12 lists breaking changes and a fix "attributes of the document node sync from Y into the view". Open V2 release checklist yjs/y-prosemirror#234, open questions #235, migration guide not written #261, suggestion bugs #245 #263.
- Read: y-prosemirror CAVEATS.md "Compatibility with older y-prosemirror": v1 docs load in v2, v1 cannot read v2, no mixed clients. Matches the compat probe.
- Read: Yjs 13 loss is long-known upstream: ueberdosis/tiptap#4339 (marks on Mention not encoded, open since 2023-08); y-prosemirror PR #213 (marks on inline nodes) closed 2026-01 unmerged for 1.x.
- Read: @y/hub 0.9.0 (official Yjs 14 backend used by the demos) is AGPL-3.0 OR PROPRIETARY, needs Redis, Postgres, S3. No Hocuspocus issue or release mentions Yjs 14.

## 14:37 — Stack 13 gate C flake: harness race, fixed
Path B compared editor 2 as soon as its text length matched editor 1, but the root-attrs map write and leafMarks attr writes travel as separate Yjs updates, so the compare could run before they arrived. Fix in both stacks' gateC.ts: also wait (up to 8 s) until the two editors' whole ProseMirror JSON is equal, then compare once. Stack 13 gate C alone, 3 runs from fresh databases: 266/266 on both paths every time. Debug script scratch/debug-pathb.ts found no file that fails to converge. The one path-A lead flake reported in brief 03 has not recurred in 6 runs; cause unconfirmed. My own mistake along the way: my first loop script reused SQLite files between runs, so the load: document accumulated history to 200 MB and runs took 8 to 20 minutes; numbers from those runs are discarded.
Also probed yjs/y-prosemirror#241 (swap bold for code in one transaction): syncs correctly on both stacks (case 6 in both probe scripts).

## 14:37 — Brief 06 dispatched (gate F, stack 14)

## 15:14 — Brief 06 handback: gate F passes on stack 14 (d390072), diff via lib0 delta.diff (same diff as the B3 bug path, so a commit that changes an image's url and link together would hit it; spike 2's schema has no images, so untested). Running both full gate suites.

## 15:23 — Full runs: stack 13 all pass (A, B, B2, B3, C 266/266 both paths, D, E, F, F-variant, G); stack 14 A, B, D, E, F, G pass, B3 and C path B (234/266) fail on the upstream atom-mark bug. Brief 07 (review) dispatched.
