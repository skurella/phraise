# Spike 5 findings: the live collaboration stack, Yjs 13 with workarounds or Yjs 14

Status: final for spike 5
Author: spike 5 orchestrator (Opus 5.5)
Updated: 2026-09-27
Charter: [spike 5 charter](../plans/2026-09-27-spike-5-charter-collab-stack.md). Plan and briefs: [plan](../plans/2026-09-27-spike-5-plan.md), briefs 01 to 07 in `context/plans/2026-09-27-spike-5-brief-*.md`.
Log: [orchestrator log](../logs/2026-09-27-orchestrator-spike-5.md); builder and reviewer logs are `context/logs/2026-09-27-builder-spike-5-*.md` and `2026-09-27-reviewer-spike-5.md`.
Code: [`spikes/2026-09-27-collab-stack-yjs13-hocuspocus/`](../../spikes/2026-09-27-collab-stack-yjs13-hocuspocus/README.md) and [`spikes/2026-09-27-collab-stack-yjs14-rc/`](../../spikes/2026-09-27-collab-stack-yjs14-rc/README.md).
Serves: D5, and D6 through gate F.

## Answer

Both stacks run end to end: a Hocuspocus 4.7 relay with SQLite, two live ProseMirror editors, spike 1's schema. **Stack 13 passes every gate.** It needs two small workaround plugins (137 non-comment lines) that were easy to get subtly wrong. **Stack 14 needs no workarounds for the two known losses, but its binding has a loss of its own.** When a transaction replaces an inline atom with one whose attributes and marks both differ, the old mark survives: an "edit image" dialog that changes a badge's URL and link keeps the old link, in the editor that made the edit too. Stack 14 also needs an install-time hack to run on Hocuspocus, has no Tiptap collaboration package, and its API renamed its core class three weeks ago.

**Recommendation for D5: build on stack 13 behind a narrow interface, and migrate to Yjs 14 when its binding is released stable and the atom-mark bug is fixed.** D1 makes the data side of that migration cheap, because every draft can be re-seeded from Markdown. The code side was measured in this spike, see "Migration cost".

## Gate results

Commands, from a clean checkout of the branch, in each spike directory: `npm ci && npm run fetch && npm run gates` (gate C, the longest, took 223 s on stack 13 and 238 s on stack 14 in the final runs; `npm run gates:quick` is the short version). The orchestrator ran both full suites on the final code; a fresh-context reviewer ran both from a fresh clone and got the same results.

| Gate | Stack 13: Yjs 13.6.33, `@tiptap/y-tiptap` 3.0.9, Hocuspocus 4.7, Tiptap 3.31.3 | Stack 14: `@y/y` 14.0.0-rc.26, `@y/prosemirror` 2.0.0-13, Hocuspocus 4.7 aliased |
|---|---|---|
| A. Relay | **Pass.** Two editors and the relay exchange edits. Median round trip 22.6 ms (bounded by the harness's 20 ms polling, not a network number). | **Pass on Hocuspocus 4.7**, 22.8 ms; also on a 259-line custom relay, 23.2 ms. Hocuspocus works only after deduplicating `yjs` and `lib0` at install time (see below). Stock Hocuspocus on Yjs 13 cannot relay Yjs 14 clients. |
| B. Schema fidelity while editing | **Pass with workarounds.** Typing character by character, paste of HTML with a linked image, split and join around a linked badge, adding a link to an image, a cross-block delete, concurrent typing in the other editor: editor 1, editor 2 and the relay's stored document are equal, root attributes and every linked image included, and serialize byte-identically. Negative control without workarounds shows the loss. | **Pass, no workarounds.** Same script, same checks. |
| B3. Link edits on inline atoms (added by the orchestrator) | **Pass**, 5 of 5: change an image's link, unlink it, whole-document replace, replace one image node with a new URL and link. | **Fail**, 3 of 5. Replacing an image node whose URL and link both change keeps the old link, in both editors. Mark-only changes sync. Upstream, in `@y/prosemirror`'s document diff (it delegates to `lib0` `delta.diff`). Minimal repro: `scratch/probe-atom-mark-change.ts`. |
| C. Corpus round trip through the live binding (266 real files) | **Pass**: 266/266 server-seeded, 266/266 loaded through the live plugin. Spike 1's plain y-prosemirror baseline was 160/294. State 17.2 MB summed. | Server-seeded **266/266**; loaded through the live plugin **234/266**. All 32 failures are the B3 bug, when one whole-document load replaces a previous document with a different linked badge at the same position. State 18.7 MB summed. |
| C. Workaround cost (stack 13 only) | Root attributes: sibling `Y.Map` plus a plugin, 111 lines (65 non-comment). Atom marks: spike 1's existing `leafMarks` meta attribute plus a plugin, 128 lines (72 non-comment). Binding unpatched. Schema constraint: every inline atom type must declare `leafMarks`, root attributes must be JSON values, and `leafMarksPlugin` must precede `rootAttrsPlugin` (the reviewer confirmed that swapping them loses every link). Spike 1's serializer is unchanged and passes byte-identical round trips on all 266 files through the live path. | Not applicable. |
| D. Tiptap 3 | **Pass**, 6 of 6: Tiptap's own `Collaboration` and `CollaborationCaret` on HocuspocusProvider, a generic converter from spike 1's schema to Tiptap extensions, gate B's script through two Tiptap editors, carets both ways, undo isolated per user. Only the two workaround plugins were wrapped in an extension. | **Pass, with custom extensions.** No Tiptap collaboration package supports Yjs 14: `@tiptap/extension-collaboration` peers on `yjs ^13`. About 35 lines of `Extension.create()` wrap `syncPlugin`, `yCursorPlugin` and `yUndoPlugin`. Same six checks pass. |
| E. Attribution | **Pass.** The relay's `onAuthenticate` puts the user into the connection context; `onChange` decodes each incoming update's client IDs and clock ranges and records them with user and receive time in a `Y.Map` inside the document. It persists with the document, survives relay restart, a provider reconnect (same client ID) and a reload (new client ID, same user). A client ID already mapped to another user is flagged. Ranges with user, time and text are listed by walking Yjs items. Cost about 1 KB on a 4 KB test document. | **Pass.** Same design, stored as Yjs 14's native `IdMap` with `createContentAttribute`. **Suggestion mode works** for inline changes, as a second document with `Y.createDiffRenderer` like the upstream demo. Bob suggests an insert, a delete and a link on an image; Alice sees `y-attributed-*` marks with Bob as author; accept and reject work; unresolved suggestions stay pending. Cost: the four `y-attributed-*` marks in the schema, an attribution listener registered before the renderer's own, and stripping the marks before serializing (spike 1's serializer throws on them). Block-level suggestions need container relaxation and `--attributed` node variants; not built. |
| F. Rebase port with live editors | **Pass.** Spike 2's code copied; the rebase runs on the relay via `POST /rebase/<doc>` while Alice's editor is connected and Bob's is offline. Spike 2's gates A to D and D2 pass, all three replicas converge, untouched blocks equal commit B, a retried rebase is a no-op, and a variant with Alice typing continuously during the rebase converges. Changes: an integration hook on `beforeTransaction`/`afterTransaction` for provider-origin transactions, `gc: false` everywhere, and the relay acking its own rebase record (without that, it flagged every upstream-changed block). | **Pass**, same sub-checks. `createDocFromSnapshot` and assignable `clientID` exist. The word-level diff emitter was replaced by `lib0` `delta.diff` over `@y/prosemirror` deltas (428 lines down to 58); `Y.isDeleted` has no equivalent and was re-implemented with `IdSet#hasId`. Caveat: the rebase now uses the diff that has the B3 bug, and spike 2's schema has no images, so an upstream commit that changes a linked image is untested. |
| G. Persistence and reconnect | **Pass**, 5 of 5: SIGTERM restart; SIGKILL before and after the store debounce (2 s, max 10 s); edits while the relay is down; an offline editor with overlapping edits, including both sides linking the same image. After a hard kill the reconnecting clients restore what the relay had not stored yet. | **Pass**, same scenarios. |
| H. Maturity | Yjs 13.6.33 released 23 Sep 2026; y-prosemirror 1.3.7 since Jul 2025. | See below. Not ready to depend on without pinning and owning upgrades. |

The reviewer found no vacuous gate and one weak check (stack 14 gate D's awareness check could not fail); the orchestrator fixed it and it passes.

## Gate H, stack 14 maturity

Measured by the orchestrator (installing each version and diffing its exports), versus read from primary sources.

**Release cadence (read).** `@y/y` had 27 release candidates between 25 Feb and 7 Sep 2026 ([releases](https://github.com/yjs/yjs/releases)); most release notes are an empty "Full changelog" link. npm's `latest` tag still points at rc.7, `beta` at rc.26. `@y/prosemirror` had 12 prereleases, 5 of them in September; 2.0.0-13 came out on 25 Sep ([releases](https://github.com/yjs/y-prosemirror/releases)).

**Breaking changes across recent releases (measured).**

| Step | Exports removed | Notable |
|---|---|---|
| `@y/y` rc.0 to rc.10 | 3 | `getItem`, `getState` |
| rc.10 to rc.20 | 8 | the whole `AttributionManager` family, replaced by Renderers |
| rc.20 to rc.24 | 3 | `TwosetRenderer`, which the yjs repo's `attributing-content.md` still documents |
| rc.24 (15 Jul) to rc.26 (7 Sep) | 7 | the core class `Type` renamed `Node`, plus `$ytype` |
| `@y/prosemirror` 2.0.0-11 to -12 (21 Sep) | 4 | `pmToFragment`, `fragmentToPm`, `deltaAttributionToFormat`, `defaultAttributionConf`; listed as breaking in the [changelog](https://github.com/yjs/y-prosemirror/blob/master/CHANGELOG.md) |

`@y/prosemirror` 2.0.0-4 and -8 no longer import against current `lib0`. The -12 changelog also lists a fix for syncing document-node attributes into the view, which stack 14's gate B relies on; it has been out for six days.

**Open issues that affect Phraise (read).** The V2 release checklist ([y-prosemirror#234](https://github.com/yjs/y-prosemirror/issues/234)), open design questions on suggestion-mode cursors and undo ([#235](https://github.com/yjs/y-prosemirror/issues/235)), no migration guide yet ([#261](https://github.com/yjs/y-prosemirror/issues/261)), suggestion bugs ([#245](https://github.com/yjs/y-prosemirror/issues/245), [#263](https://github.com/yjs/y-prosemirror/issues/263)), and schema-violation handling ([#275](https://github.com/yjs/y-prosemirror/issues/275)). The atom-mark bug found here (B3) has no issue yet. On the Yjs 13 side, the atom-mark loss has been open since 2023 ([tiptap#4339](https://github.com/ueberdosis/tiptap/issues/4339)), and two PRs adding marks on element nodes to y-prosemirror 1.x were closed unmerged ([#157](https://github.com/yjs/y-prosemirror/pull/157), [#213](https://github.com/yjs/y-prosemirror/pull/213)). No Hocuspocus or Tiptap issue or release mentions Yjs 14.

**Server (read).** The upstream demos run against `@y/hub` 0.9.0, licensed AGPL-3.0 OR PROPRIETARY and needing Redis, Postgres and S3. It does not fit an MIT project with a single-binary self-host story (D2).

**Does 14 read 13, and the reverse (measured, and read).** Measured in `spikes/2026-09-27-collab-stack-yjs14-rc/compat/`: raw updates apply in both directions without throwing. A document written by Yjs 13 and y-prosemirror 1.x reads fully in `@y/prosemirror` (the two 1.x losses stay lost). A document written by Yjs 14 throws in y-prosemirror 1.x. This matches y-prosemirror's own [CAVEATS.md](https://github.com/yjs/y-prosemirror/blob/master/CAVEATS.md): old documents load in the new binding, the old binding cannot read new documents, and old and new clients must not edit one document at the same time.

## Tried, fixed, abandoned

- **Hocuspocus with Yjs 14 through npm aliasing alone** crashed with a stack overflow in `lib0`. The builder concluded it could not be fixed locally. The orchestrator found two causes, both about install layout. Two `lib0` majors were installed side by side. The alias also installs `@y/y` a second time under `node_modules/yjs`, so Hocuspocus's `Doc` class differs from the binding's. Fix: an `overrides` entry `"lib0": "$lib0"`, and a 77-line postinstall script that symlinks `node_modules/yjs` and `node_modules/y-protocols` to `@y/y` and `@y/protocols` and asserts a single `Doc` class. It works under `npm ci`. A bundler alias would do the same in the web app.
- **Custom relay for stack 14** (`ws` plus `@y/protocols`, 259 lines): works, kept as a fallback behind a flag.
- **Stack 13's root-attributes plugin** first compared `doc.attrs` with the map on every transaction. When a remote update's fragment observer fired before its map observer, it wrote stale defaults over the synced value, and one corpus file lost its leading newline. Fixed by writing only when a transaction changed `doc.attrs`. The builder separately found that plugin order matters. Both show that the workaround is small but has sharp edges.
- **Gate C "flake" on stack 13**: a harness race, not a loss. The check compared as soon as text lengths matched, before the separate map and attribute updates arrived. It now waits for full convergence. Three runs from fresh databases plus the final full run gave 266/266 on both paths.
- **Patching y-prosemirror for atom marks**: not needed; the plugin approach keeps the binding stock. Spike 2 sized the patch (two functions in `sync-plugin.js` plus a wire-format decision).
- **Playwright and a real browser**: not used. All editors run in jsdom; see open risks.

## Migration cost from stack 13 to stack 14, as measured here

- **Data.** None required. Under D1 every session document is re-seeded from Markdown at the next commit or on load, and the drafts ref (D2) holds rendered Markdown. A Yjs 13 document also reads in 14. What cannot happen is a mixed fleet: all clients and the relay switch together, per document.
- **Code, all already written in this spike:** remove the two workaround plugins (minus 239 lines); swap the Tiptap collaboration extensions for about 35 lines of custom ones; port attribution (171 lines to 217, native `IdMap`); port the rebase core (2,144 lines to 1,655, one builder dispatch; the diff emitter is the part that changes); relay alias and dedupe until Hocuspocus supports Yjs 14; four attribution marks in the schema if suggestion mode is wanted.
- **Interface that keeps this cheap:** the rest of Phraise touches the CRDT only through (1) seed from and read to a ProseMirror document, (2) the editor plugin list, (3) the relay's per-update hook for attribution, (4) the rebase engine's fork, diff and apply, and (5) comment anchors as relative positions. Keep `Y.XmlFragment`, `Y.Map` and `Y.Node` out of every other module.

## What would change the recommendation

- **Build on 14 now** if `@y/prosemirror` 2.0.0 is released stable with the B3 bug fixed, and either Hocuspocus or Tiptap ships Yjs 14 support; or if suggestion mode moves into the first release.
- **Stay on 13 longer** if Yjs 14 keeps renaming core API after its stable release, or if the stable binding drops document-node attributes again.
- **Revisit stack 13** if a new schema construct defeats the `leafMarks` plugin (a new inline atom type that forgets the attribute loses its marks silently; a schema test should enforce it).

## Decisions

Made by the spike 5 orchestrator, for the lead to transfer to the register.

| # | Decision | Impact | Difficulty to reverse |
|---|---|---|---|
| S5-1 | D5: build the integration on Yjs 13.6, `@tiptap/y-tiptap` 3.0.x, Hocuspocus 4.7 and Tiptap 3, behind the five-point CRDT interface above; migrate to Yjs 14 when the conditions under "What would change the recommendation" hold. | high | moderate: the port is measured and mostly written |
| S5-2 | Yjs 13 workarounds: root attributes in a sibling `Y.Map` kept in sync by a plugin; marks on inline atoms in the `leafMarks` meta attribute kept in sync by a plugin. The binding stays unpatched. | medium | easy |
| S5-3 | Every inline atom node type must declare `leafMarks`; `leafMarksPlugin` is registered before `rootAttrsPlugin`. Enforce both with a schema test. | medium | easy |
| S5-4 | The client-ID-to-user-and-time mapping is recorded by the relay's per-update hook from the authenticated connection and stored inside the document (a `Y.Map` on 13, an `IdMap` on 14), so it persists and reconnects with the document. A client ID claimed by a second user is flagged. | medium | easy |
| S5-5 | Rebases run on the relay against its in-memory document, and the relay acknowledges its own rebase record at once. Clients and relay run integration from `beforeTransaction`/`afterTransaction` on provider-origin transactions. Confirms S2-3 in a live setting. | medium | easy |
| S5-6 | Session documents are `gc: false` on relay and clients. Confirms S2-4. | medium | easy |
| S5-7 | Relay for the integration spike: Hocuspocus 4.7 with its SQLite extension. Do not adopt `@y/hub` (AGPL, Redis, Postgres, S3). | medium | easy |
| S5-8 | Live-editor tests run in jsdom, driving `EditorView` APIs; a real-browser pass is left to the integration spike. | low | easy |
| S5-9 | If suggestion mode is adopted: `y-attributed-*` marks are stripped or resolved before serialization, and the serializer refuses otherwise. | low | easy |
| S5-10 | Report the `@y/prosemirror` atom-mark bug upstream with the minimal repro before planning the Yjs 14 migration. | medium | easy |

## Open risks

1. **No real browser.** Typing, paste, split and join were driven through `EditorView` APIs in jsdom, with small shims (no `ClipboardEvent`, no `getClientRects`). IME, real selection and DOM input handling are untested. The latency numbers are harness polling, not network measurements.
2. **Forged client IDs are flagged, not rejected.** The forged update is still applied and broadcast; Yjs's own client-ID collision defense then silently reassigns the victim's client ID. Rejecting such updates needs relay-side filtering before apply.
3. **Unflushed relay state.** A relay killed within the store debounce (2 s, max 10 s) loses what no connected client still holds. Fine under D2's recoverable-relay model; it bounds the loss window.
4. **Stack 14's rebase uses the diff with the B3 bug.** A commit that changes a linked image's URL and link together would keep the old link. Untested because spike 2's schema has no images.
5. **Stack 13 workarounds are order- and timing-sensitive.** Two bugs of this kind were found and fixed here. A schema test and B3-style probes should run in CI.
6. **Attribution data grows** with every update (about 1 KB per short two-user session). D1's re-seed bounds it.
7. **Suggestion mode at block level** (suggesting a whole paragraph, list item or table row) is unbuilt and needs schema relaxation and `--attributed` variants per upstream's ATTRIBUTION.md.
8. **Tiptap needs its own schema instance.** Comparisons by node-type reference break when the Tiptap editor's schema and spike 1's schema object differ. Stack 13 compares by name; production code must too.
