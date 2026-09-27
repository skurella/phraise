Status: active
Author: builder (Sonnet)
Updated: 2026-09-27
Related: [brief](../plans/2026-09-27-spike-2-brief-05-binding-fidelity.md), [plan](../plans/2026-09-27-spike-2-plan.md)

Time zone: local machine time (CEST), from `date`.

## 07:06 — task received

Read AGENTS.md and the brief (`2026-09-27-spike-2-brief-05-binding-fidelity.md`).
Goal: new self-contained package `spikes/2026-09-27-crdt-rebase-binding-probe/` reproducing
two y-prosemirror 1.3.7 losses (root `doc` attrs, marks on inline atom nodes) with tiny tests,
same fixture against loro-prosemirror 0.4.4, against the Yjs 14 RC binding (`@y/y`@beta,
`@y/prosemirror`@beta), plus a Yjs 14 attribution probe. Checked registry: y-prosemirror@1.3.7,
yjs@13.6.33, loro-prosemirror@0.4.4, loro-crdt@1.16.3, @y/y@14.0.0-rc.26, @y/prosemirror@2.0.0-13
all resolve. Reused package.json/tsconfig conventions from sibling spikes
`2026-09-27-crdt-rebase-yjs-fork` and `-loro-fork` (ESNext/Bundler, vitest, tsx, strict).
Node v22.12.0, npm 11.0.0. Scaffolding directories now: src, test, fixtures, scripts.

## 07:11 — task 1 done: y-prosemirror 1.3.7 + yjs 13.6.33

Wrote `src/schema.ts` (own tiny schema: doc+frontmatter attr, paragraph, text,
inline atom image(src,alt), marks link(href)/strong) and `src/fixture.ts`
(the brief's fixture doc). Read `node_modules/y-prosemirror/src/lib.js` and
`src/plugins/sync-plugin.js` before writing tests:

- Root attrs: `Y.XmlFragment` (used for the document root type) has no
  `setAttribute`/attribute storage at all — verified directly
  (`'setAttribute' in new Y.XmlFragment()` is `false`). Every conversion
  path (`prosemirrorToYXmlFragment`, `updateYFragment`, the deprecated
  `yXmlFragmentToProsemirrorJSON`) either has no attrs branch for the
  fragment or explicitly gates attrs handling on `instanceof Y.XmlElement`
  (sync-plugin.js:1154), which the root fragment never is. Root always comes
  back with schema-default attrs (`yXmlFragmentToProseMirrorRootNode` calls
  `schema.topNodeType.create(null, ...)`, lib.js:218-219).
- Atom marks: `createTypeFromElementNode` (PM node -> Y.XmlElement,
  sync-plugin.js:874) copies only `node.attrs`, never `node.marks`.
  `createNodeFromYElement` (Y.XmlElement -> PM node, sync-plugin.js:801)
  calls `schema.node(el.nodeName, attrs, children)` with no marks argument.
  So a mark on an atom/leaf node (our `link` around `image`) is dropped on
  the way *into* Y, not just on the way out.

Wrote `test/y-prosemirror.spec.ts`, all 3 required paths: (i)
`prosemirrorToYXmlFragment` -> `yXmlFragmentToProseMirrorRootNode` (fragment
must be attached to a `Y.Doc` first, else "Invalid access: Add Yjs type to a
document before reading data" — passing it unattached the way the
deprecated single-arg overload of `prosemirrorToYXmlFragment` implies does
not work for reading back); (ii) `updateYFragment` from empty; (iii) real
`ySyncPlugin` + `EditorView` under jsdom, editing to add the link mark via
a dispatched transaction, then re-synced through a second `Y.Doc`. For path
(iii), discovered (via a throwaway debug script, deleted) that the
recommended wiring seeds the Y fragment *before* constructing the
`EditorState`, using `initProseMirrorDoc(fragment, schema)` for the initial
doc: the plugin's `view()` hook force-rerenders the editor from the (at
that point still empty) Y content immediately on `EditorView` construction,
silently discarding any richer doc passed straight to `EditorState.create`.
All 3 tests pass (`npx vitest run test/y-prosemirror.spec.ts`): root attrs
null in every path, atom marks `[]` in every path, surrounding text intact.
Moving to task 2 (loro-prosemirror).

## 07:16 — task 2 done: loro-prosemirror 0.4.4 + loro-crdt 1.16.3, one finding stronger than expected

Read `node_modules/loro-prosemirror/src/lib.ts` and `sync-plugin.ts`. Structural
difference from y-prosemirror: the doc root is a plain `LoroMap` at
`doc.getMap("doc")` (`ROOT_DOC_KEY`), stored identically to every other node
(`nodeName`/`attributes`/`children` keys) — no separate fragment type for the
root. So the *headless* path (`updateLoroToPmState` -> `createNodeFromLoroObj`)
keeps root attrs correctly (verified with a throwaway debug script, deleted).
Atom marks are still lost headlessly: `createLoroMap`/`updateLoroMapAttributes`
(lib.ts:532,583) copy only `node.attrs`; `createNodeFromLoroObj` (lib.ts:107)
calls `schema.node(nodeName, attributes.toJSON(), mappedChildren)` with no
marks arg — same structural gap as y-prosemirror's `createTypeFromElementNode`
/`createNodeFromYElement`.

But wiring the same fixture through the real `LoroSyncPlugin` under jsdom
(`test/loro-prosemirror.spec.ts`, second test) surfaced something worse than
expected: `init()` and `updateNodeOnLoroEvent()` (sync-plugin.ts) rebuild the
node correctly (frontmatter intact) but apply it with `tr.replace(0, size, new
Slice(Fragment.from(node), 0, 0))`. `Fragment.from(node)` wraps a *single*
node — including the reconstructed "doc" node — as-is; `Transform.replace`
only ever swaps content between two positions, so the wrapped node's own
attrs never reach the live doc, no matter what they are. Confirmed
`Transform.prototype.setDocAttribute` exists and works in the installed
prosemirror-transform (1.12.2) — the plugin just never calls it. Consequence
verified directly: after the live view's doc attrs are silently nulled this
way, dispatching an unrelated edit (adding the link mark) triggers
`appendTransaction` -> `updateLoroToPmState(state.doc, ..., newEditorState)`,
which writes the (now-null) `frontmatter` back over Loro's stored value —
`updateLoroMapAttributes` deletes any attr whose PM value is `null`. So this
is not a read-only display bug: one edit through the live binding actively
deletes previously-stored root attrs from the CRDT itself. Both tests pass
documenting this (`npx vitest run test/loro-prosemirror.spec.ts`). This is a
strong candidate for the "upstream patch" remedy sketch: add a
`tr.setDocAttribute` diff pass to `init()`/`updateNodeOnLoroEvent()`, small
and localized. Moving to task 3 (Yjs 14 RC).

## 07:23 — tasks 3 and 4 done: Yjs 14 RC binding fixes both losses; attribution probe works via item.id.client

Both `@y/y`@14.0.0-rc.26 and `@y/prosemirror`@2.0.0-13 installed and ran with
no install/runtime errors — nothing blocked. One API-shape surprise worth
recording: Yjs 14 has no `Y.Text`/`Y.Map`/`Y.XmlFragment`/`Y.XmlElement`
anymore; every shared type collapses into a single `Y.Node` (see
`node_modules/@y/y/src/ynode.js`, `export class YNode`), configured by which
methods you call on it (`insert`/`delete`/`format`/`toDelta` for text-like use,
`setAttr`/`getAttr`/`attrKeys` for attribute-bag use, `push`/`toArray` for
array-like use). Structurally this converges with loro-prosemirror's
"nodeName + attributes + children" uniform node shape from task 2: both
projects now treat the document root exactly like any other node.

Read `node_modules/@y/prosemirror/src/sync-utils.js`'s `nodeToDelta`
(~line 501-516): every node's own attrs go through `d.setAttrs(n.attrs)`
unconditionally, root included (`docToDelta = doc => nodeToDelta(doc, null)`
still calls the same function). More importantly, the child-serialization
loop attaches `marksToFormattingAttributes(c.marks)` to the insert op for
*every* child, text or element, not gated on `c.isText` — unlike
y-prosemirror 1.x's `createTypeFromElementNode` and loro-prosemirror's
`createLoroMap`, both of which only ever look at `node.attrs`. Verified with
a throwaway debug script (deleted) before committing to
`test/yjs14-prosemirror.spec.ts`: **both losses from tasks 1 and 2 are gone**
in this binding — root `frontmatter` and the image's `link` mark both survive
(a) the headless `pmnodeToDelta` -> `applyDelta` -> `ynodeToPmnode` path and
(b) the real `syncPlugin` + `EditorView` under jsdom, through an edit adding
the mark and a re-sync through a second `Y.Doc` (mirroring path iii from
task 1). The live binding here also uses a synchronous
`configureYProsemirror({ ytype })(view.state, view.dispatch)` to hydrate the
view — no `setTimeout(0)` round-trip like y-prosemirror 1.x's
`_forceRerender` or loro-prosemirror's `init()`, so no equivalent of the
loro live-binding attrs-clobber bug from task 2 was even possible to trigger
here. Both tests pass (`npx vitest run test/yjs14-prosemirror.spec.ts`).

Task 4, attribution: no `attributing-content.md` ships in the npm tarball
(package root only has LICENSE/README.md/package.json/global.d.ts) — likely
repo-only and not yet in this pre-release's published files, recorded as a
blocked sub-task (doc not found, not an error). What the package does ship:
`AttributionsRenderer`/`createAttributionsRenderer`
(`src/utils/Renderer.js`) and `ContentIds`/`ContentMap` helpers
(`src/utils/meta.js`, `src/utils/ids.js`). Read them: `AttributionsRenderer`
takes an attribution map *you construct* (via `createContentAttribute`) —
built for suggestion-mode/version-diff rendering into `y-attributed-*`
marks, not an automatic "who inserted this" query. That answer is exactly
where Yjs 13 leaves it: every `Item` carries `id.client` (the numeric peer
id of whoever created it), and the struct store is partitioned per client
regardless of any renderer. Verified two ways in
`test/yjs14-attribution.spec.ts`, both agreeing: (1) walking a `Y.Node`'s
`_start`/`.right` item chain directly (same technique as Yjs 13's
attribution approach, and this spike's own core plan section 7) gives
ordered, position-preserving per-client runs; (2)
`createInsertSetFromStructStore(doc.store, true)` -> `IdSet.forEach((range,
client) => ...)` (note: `f(range, client)`, range first) gives the same
partition from a public API with no internal-field access, unordered by
position. Both tested for the plain two-client case and for this spike's
exact rebase shape (fork at a state with `gc:false`, edit the fork with a
third client, merge back) — works identically; forking needs the same
`gc:false` requirement Yjs 13 has. Verdict: usable today for "who inserted
what" via either the low-level chain walk or `createInsertSetFromStructStore`;
NOT yet usable via a documented high-level "attribution manager" API — that
surface (`AttributionsRenderer`) solves a different, harder problem
(rendering diffs/suggestions) and needs you to supply the attribution
yourself. Moving to task 5 (remedy sketches + README).

## 07:25 — task 5 done, definition of done verified, wrapping up

Wrote `README.md`: result table (binding x path x root-attrs-kept? x
atom-marks-kept?), the attribution probe verdict, and remedy sketches for
each loss (sized: schema change / upstream patch pointing at the exact
function / fork / switch library), condensed from the log entries above.
Fixed 6 `tsc` errors in `test/loro-prosemirror.spec.ts` (loro-prosemirror's
`LoroDocType`/`LoroNode` types aren't exported by name, so `LoroDoc`'s
default generic doesn't structurally match the functions' declared
parameter types — added `as any` at those 4 call sites, noted inline).
Verified the definition of done exactly as specified: deleted
`node_modules`, ran `npm install && npm test` clean (4 files, 9 tests, all
pass) and `npx tsc --noEmit` (clean, no output). No task was blocked. Ready
to commit.
