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
   come before rootAttrs).
3. **Relay per-update hook.** `inspectUpdate(update)` via `Y.parseUpdateMeta`.
   Brief 01 scope note: `recordAttribution`/`authorOf` (plan section 3 point 3)
   are **not** implemented here yet -- left to a later brief alongside
   engine's attribution listing.
4. **Fork, diff, apply.** `snapshot(doc)`/`encodeSnapshot` (alias), and
   `forkDiffMerge(doc, base, target, {clientId, origin})`: fork `doc` at
   `base` (or diff directly when `base` already equals the live state, the
   fast path), diff-apply `target` onto the fork's content (`diff.ts`,
   copied from spike 3's two-way block/word diff), verify the result equals
   `target` exactly, repair with a whole-fragment `updateYFragment` on
   mismatch (counted), and merge the fork's update back into `doc`.
   `render(doc)` reads `doc` and calls `src/markdown`'s `renderDoc` (best
   effort plus degraded-block plus boundary-repair report).
   `blockStatesAt`/`resurrectBlock` are brief 03's addition, not here.
5. **Anchors.** Not implemented in brief 01 (brief 03's addition).

Plus typed accessors for JSON values in named `Y.Map`s: `getMeta`,
`setMeta`, `transact` (`meta.ts`), so engine can keep its own records
without touching a `Y.Map` directly.

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
`inspectUpdate.ts`, `meta.ts`, `render.ts`, `index.ts` -- new for this
spike.
