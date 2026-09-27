# Markdown core: remark parse, PM schema, block-preserving splice serializer

Status: done, spike 1 winner. All charter gates pass; see `results/gates.md`
and the findings doc
[`context/docs/2026-09-27-spike-1-findings-markdown-round-trip.md`](../../context/docs/2026-09-27-spike-1-findings-markdown-round-trip.md).
One command from a clean checkout: `npm ci && npm run gates` (fetches the
corpus if missing, about 8 minutes).

## Goal

Prove decision D4: a Markdown file parses into a real ProseMirror document,
serializes back byte-for-byte when untouched, and an edit to one word changes
only that block's bytes. See [the brief](../../context/plans/2026-09-27-spike-1-brief-02-core.md)
for the full algorithm design and [the architecture decisions](../../context/docs/2026-09-27-architecture-decisions.md#d4-block-preserving-markdown-document-model--locked)
for D4 itself.

## Layout

- `src/schema.ts` — ProseMirror `Schema`. Meta attrs (`src`, `gap`, `*Hint`) are ignored by semantic comparison.
- `src/parse.ts` — `parseMarkdown` (full document), `parseBlock` (isolation re-parse for one block, with an optional splice text-run map, link-span list, and per-node source-span table), mdast → PM conversion.
- `src/style.ts` — `detectStyle`: file-convention majority vote.
- `src/serialize.ts` — `serializeDoc`: the serializer candidate ladder (below).
- `src/compare.ts` — `semanticEq`, `stripMeta`.
- `src/yjs.ts` — the Yjs codec (below).
- `src/index.ts` — public re-exports.
- `test/*.test.ts` — round trip (handwritten + corpus smoke), single-word/structural/textblock edits, re-serializer fidelity, style detection, position tracking.

### The serializer candidate ladder (`src/serialize.ts`)

`serializeDoc` emits each top-level block through the cheapest candidate that
still verifies (re-parses to a semantically equal node), falling through to
the next when one doesn't apply or doesn't verify:

1. **Verbatim** (`kind: 'verbatim'`) — the block's own `src` attr, unedited:
   re-parsing it in isolation reproduces the same node. This is the common
   case for every untouched block (D4's core guarantee).
2. **Text splice** (`kind: 'splice'`, via `tryTextSplice`) — the edit is a
   literal character-for-character replacement inside one textblock's plain
   text (no mark change): find the diffed range, confirm the corresponding
   source run is a literal (unescaped, 1:1 source-mapped) span, and splice
   the new text directly over it. This is what a plain word replacement uses.
3. **Link splice** (`kind: 'splice'`, via `tryLinkSplice`) — the edit lies
   inside one link whose text is also its syntax (a shortcut reference or a
   bare literal/autolink URL), which a text splice cannot express: re-render
   just that link from the new document and splice it over the link's own
   source span.
4. **Textblock splice** (`kind: 'textblock-splice'`, via
   `tryTextblockSplice`) — the edit changes marks or structure (bold, a new
   link, ...) but still lies inside one textblock (a paragraph, heading, or
   table cell) at any nesting depth: re-render only that textblock's own
   inline content and splice it over the textblock's own mdast source span
   (with the enclosing list/blockquote's line prefix re-applied to any
   continuation line), instead of re-serializing the whole enclosing
   list/blockquote/table. This is what a bold/link toggle on a word inside a
   list item or blockquote paragraph uses; see brief 04.
5. **Re-serialize** (`kind: 're-serialize'` if it re-parses correctly,
   `'unverified'` if not — the latter is still returned; there is no further
   fallback) — the whole top-level block is rebuilt from the edited PM node
   via `mdast-util-to-markdown`, using the file's detected style
   (`detectStyle`) and per-node hints (emphasis/strong marker, list
   bullet/delimiter, fence, heading style, hard-break spelling, literal-link
   form, ...) recorded at parse time. This is the last resort, used when an
   edit's shape doesn't fit any splice (e.g. splitting one list item into
   two, or an edit spanning more than one textblock).

An `opaque-edit` trace kind covers the analogous case for a `raw_block`
(front matter, HTML, math, ...) whose text content was itself edited
directly.

`serializeDoc(doc, { semanticLineBreaks: true })` reformats a paragraph one
sentence per line whenever it goes through candidate 4 or 5 above (never
verbatim or a text splice): a custom `paragraph` handler splits after a `.`,
`!`, or `?` followed by whitespace and an uppercase letter or digit, skipping
protected spans (inline code, links, autolinks, bare URLs). Since a plain
`\n` with no trailing spaces/backslash is just a CommonMark soft break (a
space, semantically), `semanticEq(a, b, { equateSoftBreaks: true })` treats
one the same as a single space for this mode's own verification only.

### Tools (`tools/`)

Small standalone scripts (`npx tsx tools/<name>.ts [args]`), not part of
`npm test`/`npm run gates`, for interactively investigating one file or one
finding:

- `debug-edit.ts` — replays gate B's exact word-replacement edits for given
  `<set>/<file>:<seed>` args and prints the serializer trace, the literal
  text-run at the diff point, and a context window around the first byte
  difference.
- `debug-pos.ts` — prints the `positions` side table (`parseMarkdown(md,
  {positions:true})`) for one file, cross-referenced with gate B's eligible
  words.
- `quick-roundtrip.ts` — a fast no-edit round-trip pass over every corpus
  set, reporting byte-identical/unstable-block counts without the full
  gates harness.
- `b-failures.ts` — lists every gate B (single-word edit) failure, with
  category and path, for the corpus or one named set.
- `b2-before-after.ts` — brief 04's task 2 measurement: runs gate B2
  (structural bold-toggle edit) twice over the same parsed corpus and RNG
  seeds, with and without textblock splice (`noTextblockSplice`), and prints
  the before/after file/edit/single-line pass rates and path/category
  distributions.
- `top-diffs.ts` — brief 04's task 3 tool: for every top-level block whose
  forced re-serialization differs from its own `src`, computes the minimal
  (removed → added) span and groups occurrences by `(block type, removed,
  added)` shape, printing the most common ones with an example file each —
  used to find what's cheap to fix in `reserializeBlock` next.

### The Yjs codec (`src/yjs.ts`)

`docToYDoc`/`yDocToDoc` wrap y-prosemirror's
`prosemirrorToYXmlFragment`/`yXmlFragmentToProseMirrorRootNode`, closing two
gaps measured by gate A3 (plain y-prosemirror, no codec): a `Y.XmlFragment`
has no attribute slot for the *root* node, so the doc's own `lead`/`eol`
attrs get lost, and y-prosemirror stores an inline leaf node's (image,
hard_break, raw_inline) marks nowhere, so they get silently dropped (most
visibly a linked image, `[![alt](img)](href)`, loses its outer link). The
codec stores root attrs in a side `Y.Map` (`META_MAP_NAME`) next to the
fragment, and encodes each inline leaf's marks into a `leafMarks` meta attr
(`encodeLeafMarks`/`decodeLeafMarks`, ignored by `semanticEq`) before handing
the tree to y-prosemirror, decoding it back on the way out. Gate A3b (100%)
measures the round trip through this codec and a real binary Yjs update;
gate A3 (informational) measures plain y-prosemirror with neither, to keep
the finding visible. Covers seeding/reading a `Y.Doc` (D1/D2); the live
`ySyncPlugin` converting in-editor transactions directly still needs the
same encoding upstream or an `appendTransaction` plugin -- left to spike 2.

## Running

```bash
npm ci
npm test         # first fetches the corpus into corpus/fetched/ (gitignored); idempotent
npm run gates    # all gates, about 8 minutes
```

## Gates: `npm run gates`

`gates/` is the executable evidence for decision D4 (see
[brief 03](../../context/plans/2026-09-27-spike-1-brief-03-gates.md) and the
[charter](../../context/plans/2026-09-27-spike-1-charter-markdown-round-trip.md)'s
gate table). One command runs all five success gates over the whole corpus
and prints a Markdown results table.

```bash
npm run fetch            # node scripts/fetch-corpus.mjs, if corpus/fetched/ is missing
npm run gates             # full corpus; also fetches the corpus first if missing
npm run gates -- --quick  # deterministic subset (every 10th file per set), for fast iteration
```

Writes `results/gates.md` (the table, per-gate detail, and failure lists with
excerpts) and `results/gates.json` (the same data, machine-readable). Exits
non-zero if any gate misses its threshold. `results/` is committed (numbers
and short excerpts only, never full third-party file content).

Corpus sets, reported separately: `handwritten` (28), `real` (266),
`commonmark` (655), `gfm` (672). Thresholds apply to **real + handwritten**
combined ("corpus files"); `commonmark`/`gfm` spec examples are reported
alongside as stress tests, no threshold.

What each gate measures:

- **A. No-edit round trip** (100%): `serializeDoc(parseMarkdown(md).doc) === md`
  for every corpus file. Also: **A2**, the same after a `doc.toJSON()` /
  `Node.fromJSON` round trip; **A3**, the same after a Yjs round trip via
  y-prosemirror (`prosemirrorToYXmlFragment` / `yXmlFragmentToProseMirrorRootNode`).
- **B. Single-word edit** (98% of corpus files): for each file and 5 seeded
  runs, pick one eligible word inside a paragraph (at any depth), replace it
  via a real ProseMirror `Transaction`, serialize, and require both semantic
  correctness (the re-parsed output matches the edited doc block-for-block)
  and containment (every changed line lies inside the edited paragraph's own
  source line range — not just its enclosing top-level block). Failures are
  categorized: `semantic-mismatch`, `diff-outside-paragraph-but-inside-block`,
  `diff-outside-block`, `exception`.
- **C. Opaque and special constructs**: front matter, raw HTML, MDX/JSX,
  math, footnote definitions, link reference definitions, Mermaid and other
  fenced code, and tables. Reports per-construct file/block counts, gate A
  pass rate, gate B file pass rate, and — for every gate B edit — whether
  every other top-level block of one of these kinds stayed byte-identical
  outside the edited block.
- **D. Editor-model fidelity** (100%): the schema is a real
  `prosemirror-model` `Schema`; `doc.check()` passes for every parsed and
  every edited document; edits are `Transaction`s by construction; rolls up
  A2/A3.
- **E. Style detection** (>= 10 non-default files pass): for files whose
  detected conventions (bullet marker, emphasis marker, fence, heading
  style, thematic break, line endings) differ from the schema defaults,
  forces a full re-serialization and checks it reproduces the same
  conventions for whichever ones actually appear in the forced output.
  Also reports, as information, the fraction of top-level blocks whose
  forced re-serialization is byte-identical to `src` (hints on/off) and the
  fraction that verify as semantically equal.

### Current results and known limits

Numbers live in `results/gates.md` (regenerated by every full run) and are
discussed in the findings doc. Known limits, all measured there:

- **Plain y-prosemirror loses data** (A3): root-node attrs and marks on inline
  leaf nodes (linked badge images) are dropped by y-prosemirror 1.3.7 and
  `@tiptap/y-tiptap` 3.0.9. `src/yjs.ts` works around both for seeding and
  reading (A3b is 100 percent); the live `ySyncPlugin` path is not covered.
- **Unverified serialization**: when no candidate for a changed block
  re-parses to the edited block, `serializeDoc` throws
  `UnverifiedSerializationError` by default (`onUnverified: 'emit'` returns
  the best effort; the gates use it to measure). Only spec examples hit it,
  mostly entity-encoded characters such as `&#10;` that decode to newlines.
- **Gate E gaps**: the re-serializer cannot express a fence length above 3
  (mdast-util-to-markdown picks the shortest safe fence) or a file that mixes
  setext level 1 with ATX level 2 headings (one `setext` option covers both).
  Three files fail the convention check for these reasons.
- **Context-dependent blocks**: one block in the corpus parses differently in
  isolation than in its document (a lazily continued `<br>` after a nested
  list); it is kept as an opaque `unstable:` source block.

## Deviations from the brief's design

- **Leading-indentation "hug".** mdast position offsets for a block start at
  its first significant character (e.g. `#`, backtick, `-`), never at
  same-line leading spaces/tabs. Left as-is, indentation-sensitive
  isolation-reparsing (list nesting depth, fenced-code indent stripping)
  can disagree with the full-document parse for a shifted column. Fixed by
  "hugging" any pure-whitespace same-line prefix into the following block's
  `src` instead of leaving it in `lead`/the previous block's `gap`.
- **Overlapping top-level spans.** A link/footnote definition immediately
  followed (no blank line) by a setext-heading-eligible paragraph is a rare
  case where mdast reports overlapping start/end offsets for the two
  top-level nodes (both "compete" for the same span). Adjacent block spans
  are now clamped so they never overlap.
- **Duplicate mark types.** PM disallows two marks of the same type on one
  node, but CommonMark permits doubly-nested identical emphasis (e.g.
  `*a *b* c*`). Collapsed to a single (outer) mark instance rather than
  crashing; this loses the redundant-nesting distinction but keeps content
  and round-trip stable, since parse and re-parse apply the same rule.
- **Empty blockquotes/list items.** CommonMark allows `>` with no content;
  the schema requires `blockquote` content `block+`. Filled with an empty
  paragraph placeholder, same pattern already used for empty list items.
- **Style derivation for `serializeDoc`.** The brief left the exact
  mechanism open ("store it on the doc as attrs or compute at serialization,
  your choice"). Implemented by reconstructing the file's original-ish text
  from the doc's own `src`/`gap` attrs (exact for an untouched doc, since
  those are the literal slices `parseMarkdown` produced) and running
  `detectStyle` on that.
- **Tie-breaking in `detectStyle`.** For `setext` (combined level-1/2 vote)
  and `closeAtx`, an even split favors the non-default/marked variant (e.g.
  `style-star-bullets.md` has one ATX and one setext heading; forced
  re-serialize is expected to use setext for both, per the brief's own test
  5, so ties must resolve that way).

## What remark positions could not provide

- Whether a link/image was written as `<autolink>`, `[inline](url)`, a bare
  GFM literal, or `[reference][id]` is recovered by inspecting the raw
  source slice's first character, not from mdast fields (mdast's `link`
  type is used for all four; only `linkReference`/`imageReference` are
  distinguished structurally). This is `kindHint`, a meta attr, so it never
  affects semantic equality — only round-trip fidelity when hints are used.
- Whether a code block used a 4+ character fence, backtick vs. tilde, or
  plain 4-space indentation is not on the mdast `code` node at all; it's
  recovered by re-slicing the source's first line.
- List nesting depth and fenced-code content indentation are positionally
  *relative* (they depend on the column of the enclosing construct's first
  line), which is exactly what breaks isolation re-parsing when a block's
  own leading indentation isn't included in its `src` (see "leading
  indentation hug" above).
