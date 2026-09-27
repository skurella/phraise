# Spike 2, brief 05: editor-binding fidelity probe

Status: done
Author: builder (Sonnet)
Updated: 2026-09-27
Related: [brief](../../context/plans/2026-09-27-spike-2-brief-05-binding-fidelity.md), [plan](../../context/plans/2026-09-27-spike-2-plan.md), [log](../../context/logs/2026-09-27-builder-spike-2-binding-probe.md)

Reproduces two losses the lead reported in y-prosemirror 1.3.7 — dropped
`doc` root attributes and dropped marks on inline atom (leaf) nodes, e.g. a
`link` mark wrapped around an `image` — against the same fixture on
loro-prosemirror 0.4.4 and the Yjs 14 release-candidate binding, and probes
whether the Yjs 14 attribution API is usable today.

Self-contained package, no imports from other spike directories. Own tiny
schema (`src/schema.ts`): `doc` with one attribute (`frontmatter`),
`paragraph`, `text`, an inline atom `image(src, alt)`, marks `link(href)` and
`strong`. Fixture (`src/fixture.ts`): `frontmatter` set, paragraph `see
[![ci](badge.svg)](https://ci) now` — the image node carries the `link` mark
directly in its `marks` array (marks apply to individual nodes in
ProseMirror, atoms included, not just to characters).

```
npm install && npm test   # 4 files, 9 tests, all pass
npx tsc --noEmit           # clean
```

Every test asserts the *observed* behavior (including losses), so the suite
passing documents reality rather than an aspiration — e.g.
`expect(rebuilt.attrs.frontmatter).toBeNull()` where the binding drops it.

## Result table

| Binding | Path | Root `doc` attrs kept? | Atom (`image`) mark kept? |
|---|---|---|---|
| y-prosemirror 1.3.7 + yjs 13.6.33 | (i) `prosemirrorToYXmlFragment` → `yXmlFragmentToProseMirrorRootNode` | No | No |
| y-prosemirror 1.3.7 + yjs 13.6.33 | (ii) `updateYFragment` from empty (the `ySyncPlugin` path) | No | No |
| y-prosemirror 1.3.7 + yjs 13.6.33 | (iii) real `ySyncPlugin` + `EditorView`, live edit, re-synced via 2nd doc | No | No |
| loro-prosemirror 0.4.4 + loro-crdt 1.16.3 | headless: `updateLoroToPmState` → `createNodeFromLoroObj` | **Yes** | No |
| loro-prosemirror 0.4.4 + loro-crdt 1.16.3 | live `LoroSyncPlugin` + `EditorView`, live edit, re-synced via 2nd doc | No — worse: the edit deletes it from Loro's stored map too (see below) | No |
| Yjs 14 RC (`@y/y`@14.0.0-rc.26 + `@y/prosemirror`@2.0.0-13) | headless: `pmnodeToDelta` → `applyDelta` → `ynodeToPmnode` | **Yes** | **Yes** |
| Yjs 14 RC (`@y/y`@14.0.0-rc.26 + `@y/prosemirror`@2.0.0-13) | live `syncPlugin` + `EditorView`, live edit, re-synced via 2nd doc | **Yes** | **Yes** |

No install/runtime blockers anywhere; every path above ran and is asserted
in `test/`.

### Why, in one line each

- **y-prosemirror 1.3.7**: the document root is a `Y.XmlFragment`, which has
  no `setAttribute` at all (verified directly) — there is nowhere for root
  attrs to live. `createTypeFromElementNode`/`createNodeFromYElement`
  (`y-prosemirror/src/plugins/sync-plugin.js`) only ever read/write
  `node.attrs`, never `node.marks`, for element (atom) nodes.
- **loro-prosemirror 0.4.4**: the root is a plain `LoroMap`, stored exactly
  like every other node (`nodeName`/`attributes`/`children`), so root attrs
  *are* representable and the headless conversion keeps them.
  `createLoroMap`/`updateLoroMapAttributes` (`src/lib.ts`) have the same
  attrs-only gap as y-prosemirror for atom marks. The **live plugin**
  additionally fails to propagate root attrs it has correctly stored: `init()`
  and `updateNodeOnLoroEvent()` (`src/sync-plugin.ts`) apply the rebuilt node
  via `tr.replace(0, size, new Slice(Fragment.from(node), 0, 0))`, and
  `Transform.replace` can never change the wrapping node's own attrs, only
  content between two positions. Worse: since the live view's doc attrs are
  therefore stuck at `null`, the *next* edit's write-back
  (`updateLoroToPmState`) writes that `null` over Loro's correctly-stored
  value — `updateLoroMapAttributes` deletes any attr whose PM value is
  `null` — so one edit through the live binding destroys previously-stored
  root attrs in the CRDT itself, not just in the view.
- **Yjs 14 RC**: both losses are structurally fixed. Every shared type is now
  a single unified `Y.Node` (no more `Y.Text`/`Y.Map`/`Y.XmlFragment`
  distinction), so the root is projected the same way as any other node —
  converging with loro-prosemirror's design. `nodeToDelta`
  (`@y/prosemirror/src/sync-utils.js`) sets attrs on every node
  unconditionally (`d.setAttrs(n.attrs)`, root included via `docToDelta`) and
  attaches `marksToFormattingAttributes(c.marks)` to a child's insert op
  regardless of whether the child is text or an element — not gated on
  `c.isText` the way the other two bindings are.

## Attribution probe (Yjs 14)

No `attributing-content.md` ships in the `@y/y`@14.0.0-rc.26 npm tarball
(package root has only `LICENSE`/`README.md`/`package.json`/`global.d.ts`) —
likely a repo-only doc not yet in this pre-release's published files;
recorded as a blocked lookup, not an error.

What the package does ship is `AttributionsRenderer` (`src/utils/Renderer.js`)
and the `ContentIds`/`ContentMap` helpers (`src/utils/meta.js`,
`src/utils/ids.js`). Reading them: `AttributionsRenderer` needs an
attribution map *you construct yourself* (via `createContentAttribute`) — it
is built for suggestion-mode/version-diff rendering into `y-attributed-*`
marks, not an automatic "who inserted this" query.

**Verdict**: "who inserted what" is exactly where Yjs 13 leaves it — every
`Item` carries `id.client` (the numeric peer id of whoever created it), and
the struct store is partitioned per client independent of any renderer.
Verified two ways in `test/yjs14-attribution.spec.ts`, both agreeing, for a
plain two-client case and for this spike's actual rebase shape (fork at a
state with `gc:false`, edit the fork with a third client, merge back):

1. Walk a `Y.Node`'s `_start`/`.right` item chain directly (same technique
   Yjs 13 attribution — and this spike's own core plan section 7 — use):
   ordered, position-preserving per-client runs.
2. `createInsertSetFromStructStore(doc.store, true)` → `IdSet.forEach((range,
   client) => ...)` (note the argument order: range first): the same
   partition from a public API, no internal-field access, unordered by
   position.

Usable today via either of those two. **Not** usable today via a documented
high-level "attribution manager" — `AttributionsRenderer` solves a different,
harder problem (rendering diffs/suggestions) and expects you to supply the
attribution, not derive it.

## Remedy sketches

Factual sizing only, no production code written.

- **y-prosemirror 1.3.7, root attrs**: no small patch — `Y.XmlFragment`
  structurally has no attribute slot. Options are a schema change (move
  `frontmatter`-like root attrs into a separate `Y.Map` alongside the `pm`
  fragment, e.g. the `phraise` map this spike's core plan already has) or
  switching binding. Small if the schema change is acceptable (this spike's
  own core plan already puts non-content state in a sibling map); a fork/
  upstream patch would need a new root-level construct Yjs doesn't have.
- **y-prosemirror 1.3.7, atom marks**: upstream patch, localized. Two exact
  functions: `createTypeFromElementNode` (`plugins/sync-plugin.js:874`) would
  need to also serialize `node.marks` (e.g. as a reserved
  `__marks`/`ychange`-style attribute), and `createNodeFromYElement`
  (`plugins/sync-plugin.js:801`, the `schema.node(el.nodeName, attrs,
  children)` call) would need to read it back and pass it as the node's
  marks argument. Same shape of fix on the `updateYFragment` diff path.
  Medium size: touches the core attrs<->element mapping used everywhere, and
  needs a wire-format decision (dedicated attribute key) that every existing
  document written by this binding would need to tolerate reading without it.
  A schema change (link as an image attribute, e.g. `image(src, alt, href)`,
  or a wrapping inline node) avoids touching the binding at all — smallest
  option if the schema can absorb it.
- **loro-prosemirror 0.4.4, atom marks**: same shape and size as
  y-prosemirror's — `createLoroMap`/`updateLoroMapAttributes` (`src/lib.ts:532,
  583`) and `createNodeFromLoroObj`'s `schema.node(nodeName,
  attributes.toJSON(), mappedChildren)` (`src/lib.ts:132`) would need a
  parallel marks channel. Medium size, same wire-compat caveat.
- **loro-prosemirror 0.4.4, live-binding root attrs (the worse bug)**: small,
  well-localized upstream patch. `init()` and `updateNodeOnLoroEvent()`
  (`src/sync-plugin.ts`) already compute the fully-correct rebuilt node
  (attrs included); they just need one extra step before/alongside the
  `tr.replace(...)` — diff the rebuilt node's attrs against
  `view.state.doc.attrs` and call `tr.setDocAttribute(key, value)`
  (confirmed present and working in the installed `prosemirror-transform`
  1.12.2) for each that changed. This alone would also close the
  data-loss-on-edit consequence, since the live doc's attrs would no longer
  be stuck at the schema default.
- **Yjs 14 RC**: no remedy needed for either loss — both are already fixed.
  Remaining caveat: it is a pre-release (`beta` dist-tag, `-rc.26`), the API
  surface differs substantially from Yjs 13 (no `Y.Text`/`Y.Map`/
  `Y.XmlFragment`, a single unified `Y.Node`; different plugin wiring —
  `syncPlugin()` + `configureYProsemirror`, not a constructor argument), and
  no automatic attribution query is documented (see above) — that part would
  need building on the same low-level `item.id.client` primitive this spike
  already uses for Yjs 13, ported to the new `Y.Node`/`Item` shape. Adopting
  it now means committing to tracking a moving pre-release.
- **Switching library entirely**: out of scope to size here beyond the above
  — this spike's own core plan is already committed to Yjs 13 fork-at-base
  rebase (gate I compares against Loro); switching either would be a
  large, cross-cutting decision for the lead/orchestrator, not a local patch.

## Files

- `src/schema.ts` — the probe schema.
- `src/fixture.ts` — the shared fixture doc and an `fixtureImageMarks` helper.
- `test/y-prosemirror.spec.ts` — task 1.
- `test/loro-prosemirror.spec.ts` — task 2.
- `test/yjs14-prosemirror.spec.ts` — task 3.
- `test/yjs14-attribution.spec.ts` — task 4.
