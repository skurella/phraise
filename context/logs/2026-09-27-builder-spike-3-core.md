Status: in-progress
Author: builder (Sonnet 5)
Updated: 2026-09-27
Plan: [spike 3 plan](../plans/2026-09-27-spike-3-plan.md), sections 1, 3, 5
Brief: [brief 01](../plans/2026-09-27-spike-3-brief-01-core.md)

Time zone: Europe (machine local time), from `date`.

## 08:10 — task received

Read AGENTS.md, brief 01, charter rules section, plan sections 1-6. Read spike 2's
`diff.ts` and `rebase.ts` at commit 88bd85c (spikes/2026-09-27-crdt-rebase-yjs-fork/),
and spike 1's `src/md/schema.ts`, `yjs.ts`, `compare.ts`, plus `parse.ts`/`serialize.ts`
exports. Read the scaffold: package.json, tsconfig.json, corpus manifest, fixtures/half-typed.json
(47 states), corpus/handwritten (26 files) + corpus/fetched/real (266 files).

Design notes before coding:

- `applyDiff`'s top-level match step must key on `stripMeta(child).toJSON()` (semantic
  equality) rather than spike 2's raw `toJSON()`, because spike 1's schema has meta attrs
  (`src`, `gap`, `*Hint`, `leafMarks`) that spike 2 never had. LCS-matched ("skip") pairs
  therefore need an active attr-sync pass (recursive, text untouched) instead of spike 2's
  true no-op — this is the `attrOnly` counter.
- `updateAttrs` needs value-equality via JSON stringify, not `!==`, to handle
  `table.align` (array-valued attr).
- Textblock diff needs to be inline-leaf aware: classify a textblock's PM children into
  alternating text-groups/leaf-nodes (mirrors y-prosemirror's own `normalizePNodeContent`
  grouping), and only take the word-diff fast path when the leaf-type sequence matches
  between Y and B and Y has no two adjacent `Y.XmlText` children (a well-formedness
  check); otherwise fall back to `updateYFragment` on that one textblock element
  (`Y.XmlElement` extends `Y.XmlFragment` so this works) and count `coarseTextblocks`.
- DocSync's `importText` verification step compares full JSON (`toJSON()`, meta attrs
  included) between `yDocToDoc(target)` and the freshly parsed target doc — stricter
  than `semanticEq`, per plan 3.3 wording ("meta attrs included").
- `current(target)` (plan's pseudocode name) reads the live/forked doc's PM view WITHOUT
  decoding leaf marks (so it lines up with B's `encodeLeafMarks(newDoc)` for apples-to-apples
  structural comparison) — implemented directly with `yXmlFragmentToProseMirrorRootNode`
  + the meta map, skipping `decodeLeafMarks`, rather than round-tripping through the
  public `yDocToDoc`/`encodeLeafMarks` pair.

Starting task 1 (`src/core/diff.ts`).
