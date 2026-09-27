# src/crdt

The five-point CRDT interface (plan section 3; D5). **The only module in
this spike that imports `yjs`, `y-protocols`, `lib0` or `@tiptap/y-tiptap`**
(enforced by `test/import-boundary.test.ts`). Every other module deals only
in the opaque aliases below.

## Opaque types

- `CrdtDoc` = `Y.Doc`
- `CrdtSnapshot` = `Uint8Array` (an encoded `Y.Snapshot`)
- `CrdtUpdate` = `Uint8Array` (an encoded Yjs update)

No function outside this module ever receives a real `Y.Doc`/`Y.Snapshot`/
etc. type; callers pass and receive only these aliases plus plain
JS/ProseMirror values.

## Public API (`index.ts`)

1. **Seed and read.** `createDoc()` (`gc: false` -- forks need tombstones;
   `Y.createDocFromSnapshot` refuses a gc'd doc), `seed(doc, pmDoc, {clientId?})`,
   `read(doc): PMNode` (decoded leaf marks, root attrs from the sidecar
   `phraise-doc` map), `encodeState`, `applyUpdate`, `stateVector`, `onUpdate`,
   `clientId`/`setClientId`.
2. **Editor plugins.** `editorPlugins(doc, opts)` returns
   `[ySyncPlugin, leafMarksPlugin, rootAttrsPlugin]` in that order (order
   matters: see `workarounds/leafMarks.ts`'s comment on why leafMarks must
   come before rootAttrs). Brief 04 adds `initEditorDoc(doc) -> {doc,
   mapping}` (wraps `initProseMirrorDoc` on this module's own
   `FRAGMENT_NAME`/`schema`), so `src/testkit/editor.ts` (the live jsdom
   editor client) can build its initial `EditorState` without importing
   `yjs`/`@tiptap/y-tiptap` itself. `FRAGMENT_NAME` is now also re-exported
   from `index.ts` for the same reason (a caller outside this module needs
   the fragment name to check document emptiness/read raw state, e.g. a
   gate scratch-decoding the relay's `/state` bytes).
3. **Relay per-update hook.** `inspectUpdate(update)` via `Y.parseUpdateMeta`.
   Brief 03 adds `recordAttribution(doc, update, user, at)` and
   `listAttributedRanges(doc)` (`attribution.ts`, ported from spike 5's
   `attribution.ts`) -- per-client clock ranges mapped to a user and
   timestamp, and a walk of the doc's items grouping visible runs by who
   wrote them. Brief 04 adds `authorOf(doc, clientId) -> string |
   undefined` (plan section 3's other point-3 item, left open by brief 01's
   note above): the relay's forged-identity check (`src/relay/forgery.ts`)
   reads a client id's currently-mapped user directly, rather than walking
   `AttributionEntry.ranges` itself.
4. **Fork, diff, apply.** `snapshot(doc)`/`encodeSnapshot` (alias), and
   `forkDiffMerge(doc, base, target, {clientId, origin, forceFork?, onFork?})`:
   fork `doc` at `base` (or diff directly when `base` already equals the
   live state, the fast path -- `forceFork: true` skips this and always
   forks, needed by a caller like engine's rebase that requires the SAME
   `clientId` attributed on every replica regardless of whether a given one
   happens to have made no local edits since `base`), diff-apply `target`
   onto the fork's content (`diff.ts`, copied from spike 3's two-way
   block/word diff), verify the result equals `target` exactly, repair with
   a whole-fragment `updateYFragment` on mismatch (counted), run `onFork`
   (brief 03: called AFTER verify/repair, so any `snapshot(fork)` it takes
   is guaranteed target-equal content -- a deliberate deviation from a
   literal "immediately after the diff" reading, logged in
   `forkDiffMerge.ts`'s own doc comment), and merge the fork's update back
   into `doc`. `render(doc)` reads `doc` and calls `src/markdown`'s
   `renderDoc` (best effort plus degraded-block plus boundary-repair
   report). `blockStatesAt(doc, snapshot?)`/`resurrectBlock(doc, blockId,
   atSnapshot)` (`blocks.ts`, brief 03): every textblock ever created (live
   or deleted), generalized to the full schema -- a textblock is any
   element whose node type `isTextblock` (checked dynamically against
   `src/markdown`'s schema, not a hardcoded name set), and its signature at
   a snapshot covers its own semantic attrs plus, in child order, each text
   run's formatted delta and each inline atom's name/attrs (including
   `leafMarks`, force-included despite being a meta attr everywhere else --
   it is the only place an inline atom's marks live at this level).
   `blockHasOwnEditsSince` (new, not spike 2's) backs engine's resurrection
   rule ("only the author of the edits resurrects"), which the opaque
   signature string alone cannot answer. `onRemoteBatch(doc, isRemoteOrigin,
   handler(beforeSnapshot))` (`integrationHook.ts`): spike 5's
   `attachIntegrationHook` mechanics (snapshot before a remote transaction,
   callback after) with the integration logic itself removed -- that is
   engine's `attachIntegration`'s job. `wouldPend(doc, update)`: whether
   applying `update` would leave structs pending missing dependencies
   (spike 2's causal-delivery finding); used by `src/testkit/hub.ts`, not by
   engine.
5. **Anchors.** `textProjection(doc) -> string` (`anchors.ts`, brief 03): the
   plain-text projection defined ONCE here and used consistently by anchor
   creation, engine's fuzzy quote matching, and resolution -- textblocks in
   document order joined by `"\n"`, each inline atom contributing one
   `U+FFFC` placeholder char. `anchorAt(doc, offset, assoc)`/
   `resolveAnchor(doc, anchor) -> offset | null`: opaque, serializable
   anchors (base64 of an encoded `Y.RelativePosition`), anchored via
   `createRelativePositionFromTypeIndex` against either a text run's own
   `Y.XmlText` (character index) or, for a position at/adjacent to an
   inline atom or inside an empty block, the block's own `Y.XmlElement`
   (Yjs's array-like child-index scheme) -- there is no `Y.XmlText` to
   index against in that case.

Plus typed accessors for JSON values in named `Y.Map`s: `getMeta`,
`setMeta`, `transact`, `listMetaEntries`, `deleteMeta` (`meta.ts`; the last
two are brief 03's addition -- engine needs to enumerate/delete namespaced
keys like `rebase:*`/`ack:*`/`editorsSinceCommit:*`, not just get/set one
key), so engine can keep its own records without touching a `Y.Map`
directly.

## The Y.Doc's own shape

`prosemirror` (`Y.XmlFragment`): the document. `phraise-doc` (`Y.Map`): root
attrs `lead`, `eol` (a `Y.XmlFragment` has no attribute slot of its own,
hence this sidecar map -- see `codec.ts`'s header comment). Every inline
leaf/atom node (`image`, `hard_break`, `raw_inline`) carries its marks in
its own `leafMarks` attr (JSON-encoded), because `@tiptap/y-tiptap`, like
`y-prosemirror` before it, never converts marks on a `Y.XmlElement`; see
`codec.ts` (seed/read path) and `workarounds/leafMarks.ts` (the live
ySyncPlugin path).

## What it may import

`yjs`, `y-protocols`, `@tiptap/y-tiptap`, `prosemirror-model`,
`prosemirror-state`, `diff`, and `src/markdown` (never the reverse).

## Origin of copied code

`codec.ts` -- spike 5 `src/yjs.ts` (`eeb3fe2`), itself from spike 1's
`src/yjs.ts` (`1e1f4a6`) retargeted to `@tiptap/y-tiptap`.
`workarounds/leafMarks.ts`, `workarounds/rootAttrs.ts` -- spike 5
`src/workarounds/*` (`eeb3fe2`).
`diff.ts` -- spike 3 `src/core/diff.ts` (`9343b62`), itself from spike 2
(`88bd85c`) extended for the full schema; retargeted from `y-prosemirror` to
`@tiptap/y-tiptap`.
`forkDiffMerge.ts` -- adapted from spike 3 `src/core/docsync.ts`'s
`DocSync.importText` (`9343b62`): fork/diff/verify/repair/merge only, no
version ring or base choice (daemon's job later).
`editorPlugins.ts` -- the plugin construction/ordering from spike 5
`src/client.ts` (`eeb3fe2`), factored out as a standalone function.
`blocks.ts` -- generalized from spike 2's `integrate.ts` (via spike 5's live
copy, `collab-stack-yjs13-hocuspocus` `src/rebase/integrate.ts`, `eeb3fe2`)
to the full schema (dynamic `isTextblock` check, multi-run/atom
signatures); `blockHasOwnEditsSince` is new. `anchors.ts` -- generalized
from spike 2's `text.ts` (same location) to multiple text runs and inline
atoms per block; the anchor encoding itself (base64 of
`Y.encodeRelativePosition`, vs. spike 2's own ad hoc `Y.RelativePosition`
JSON plumbing in `comments.ts`) is new. `attribution.ts` -- spike 5's
`attribution.ts` (`eeb3fe2`), retargeted to this spike's fragment/map
naming; the item walk itself needed no schema change (already
schema-agnostic). `integrationHook.ts` -- spike 5's
`liveIntegration.ts`'s `attachIntegrationHook` mechanics (`eeb3fe2`), with
the integration logic removed; `wouldPend` is spike 2's `replica.ts`'s
same-named helper, moved here since it needs a raw Yjs probe doc.
`inspectUpdate.ts`, `meta.ts`, `render.ts`, `index.ts` -- new for this
spike.
