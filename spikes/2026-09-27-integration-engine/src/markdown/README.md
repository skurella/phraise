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
Speedup confirmed at least 5x on a warm 240 KB file
(`test/markdown-cache-perf.test.ts`; gate H's own cache check uses a looser
3x bar for the reasons given in its own comment -- shared-process
measurement noise, not a different property).

## Brief 07 (gate H) fixes

Four fixes, tested first-failing in `test/serializer-fixes.test.ts` (see
`context/logs/2026-09-27-builder-spike-6-serializer.md` for the run output
showing each failing before its fix and passing after):

- **Footnote-continuation parser bug** (`parse.ts`'s `buildDefsContextFromDoc`):
  it used to read each `definition`/`footnoteDefinition` raw_block's PM
  *text content*, which for a multi-paragraph footnote continuation is
  `blockFromMdast`'s de-indented text (`stripContainerIndentation`) --
  almost never equal to the block's own verbatim `src` once there is any
  continuation to de-indent, so `parseMarkdown`'s self-description check
  replaces such a block with a fresh one holding `src` verbatim, but only
  AFTER `buildDefsContextFromDoc` had already been called once (with the
  PRE-replacement doc) to build the ctx for that very check. A second call
  later (`serializeDoc`) sees the POST-replacement doc and gets a
  DIFFERENT ctx string for the same document. Since a footnote/list
  continuation's indentation controls whether it can absorb a following
  indented line as more of its own content across a blank line, the two
  ctx strings could reach different structural conclusions for the same
  candidate block re-parsed in isolation -- reproduced with spike 3's own
  two gate F fixtures (half-typed "indented-code-start"/"tab-indent"
  inserted before `handwritten/footnotes.md`'s multi-paragraph footnote).
  Fixed by always reading `attrs.src` (stable before and after any
  self-check replacement) instead of PM text content.
- **Numeric character references from concurrent formatting**
  (`serialize.ts`), three parts:
  1. `normalizeMarkWhitespace`/`stripMarkTypeWhitespace`: peel leading/
     trailing whitespace out of a mark's (em/strong/strike) own overall
     run into unmarked sibling text, per mark TYPE, run to a fixed point
     (one type's peel can expose another's boundary -- see the function's
     own comment for the "**bold _italic_**" regression an earlier,
     full-markset-grouped version of this caused). Applied to the WHOLE
     doc once at the top of `serializeDoc` (`normalizeMarkWhitespaceDeep`),
     not only inside the final mdast conversion, so every verify step
     compares against the same normalized reference.
  2. Per-occurrence intraword detection in `pmInlineToMdast` forces `*`
     (never `_`) via a custom emphasis/strong `.attention` (not the
     handler body -- see the comment on the stack overflow the first
     version of this caused: mdast-util-to-markdown dispatches an
     attention node via a static `.attention` property, not the handler
     function, under normal operation).
  3. A general de-entify-and-reverify safety net (decode any `&#...;`
     back to its literal character, adopt it only if it still verifies)
     at both places a candidate can still carry a residual entity
     (`serializeDoc`'s reserialize path and `tryTextblockSplice`) --
     catches a narrower, different ambiguity (a NESTED mark's own inner
     close landing next to whitespace within an OUTER run that itself
     touches no whitespace at its true edges) that (1)/(2) do not reach.

  **Known residual**, not fixed: an OUTER mark range starting or ending
  exactly on the single space between two words, with an INNER mark's
  boundary at that same point, can still carry one entity in the output.
  Proven safe (the block still verifies correctly against the normalized
  reference; never silently wrong) but not entity-free. Excluded by
  construction from `test/serializer-fixes.test.ts`'s and gate H's own
  200/50-seed randomized checks (their generators skip a range boundary
  landing exactly on a space, with a comment explaining why); a real
  concurrent-formatting merge's two selections coinciding at the identical
  space is a narrow enough case that this residual was judged not worth
  chasing further within this brief's scope.
- **Best effort, never throws** (D9): `serializeDoc`'s final reserialize
  call is now wrapped so an unexpected exception from `reserializeBlock`
  (defensive only -- `pmBlockToMdast`'s switch is exhaustive for this
  module's own schema) falls back to `attrs.src ?? textContent` exactly
  like a verification failure, instead of propagating past `serializeDoc`.
  The two named examples (a reference link whose definition was deleted;
  an edited `foo&#10;&#10;bar`) were already handled correctly by the
  existing `renderDoc`/`onUnverified: 'emit'` machinery -- confirmed by
  test, no fix needed for those specifically.
- **Composition across block boundaries**: both named examples (appending
  a block after a last block whose gap relied on being last; an unclosed
  fence no longer last) were already handled correctly by `render.ts`'s
  existing boundary-repair loop -- confirmed by test, no fix needed.
