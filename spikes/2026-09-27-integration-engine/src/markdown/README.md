# src/markdown

Block-preserving Markdown document model. Pure functions on ProseMirror
nodes and plain strings: **no import of `yjs`, `y-protocols`, `lib0` or
`@tiptap/y-tiptap`** anywhere in this module (enforced by
`test/import-boundary.test.ts`).

## Purpose

- Parse Markdown to a ProseMirror doc that round-trips byte for byte when
  untouched (`parseMarkdown`), keeping each top-level block's own source
  span (`src`) and inter-block gap (`gap`) as attrs so an untouched block
  re-emits verbatim.
- Serialize a doc back to Markdown (`serializeDoc`), preferring in order:
  verbatim (`src` still parses to the same block), text/link splice (a
  literal edit inside one block reuses as much of the original bytes as
  possible), textblock splice (re-serialize just the touched textblock),
  then full re-serialization of the block, verified by re-parsing. A block
  whose re-serialization does not verify falls back to best effort
  (`onUnverified: 'emit'`) rather than throwing, when the caller asks for
  that.
- `renderDoc(doc)`: the best-effort-plus-degraded-plus-boundary-repair
  wrapper `src/crdt`'s `render()` calls after reading a `CrdtDoc` into a
  `PMNode`. Lives here (not in `crdt/`) because it only needs a PM doc.
- `semanticEq`/`stripMeta` (`compare.ts`): structural equality ignoring meta
  attrs (`src`, `gap`, `*Hint`, `leafMarks`), compared by node/mark **type
  name** (not object identity -- a live editor's Tiptap schema instance is
  never `===` the canonical schema even when structurally identical).
- `detectStyle` (`style.ts`): majority-vote file conventions (bullet
  marker, emphasis character, fence character, heading style, etc.) used
  when a block must be freshly serialized with no `src` to imitate.

## Public API (`index.ts`)

`schema`, `isMetaAttrName`, `parseMarkdown`, `parseMdast`, `detectEol`,
`parseBlock`, `clearParseBlockCache`, `buildDefsContextFromDoc`,
`serializeDoc`, `UnverifiedSerializationError`, `detectStyle`, `semanticEq`,
`stripMeta`, `renderDoc`, plus their types.

## What it may import

`prosemirror-model`, `unified`/`remark-*`/`mdast-util-*`, `diff` is **not**
used here (that is `src/crdt/diff.ts`). Node built-ins only otherwise.
Never `yjs`, `y-protocols`, `lib0`, `@tiptap/y-tiptap`, or anything from
`src/crdt/`, `src/engine/`, `src/testkit/`.

## Origin of copied code

See the top-level README's "Origin of copied code" section; each file here
also carries a first-line comment naming its own origin.

## Persistent parse-block cache

`parse.ts`'s `parseBlock` and its `ctx`-skip helper are cached across calls
(bounded LRU, `PARSE_BLOCK_CACHE_MAX` / `CTX_SKIP_CACHE_MAX`), not cleared
per call: a save that touches one block reuses every other unchanged
block's isolation re-parse from the previous call. `clearParseBlockCache()`
resets both, for tests that compare a cold parse against a warm one.
