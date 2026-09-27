# Markdown core: remark parse, PM schema, block-preserving splice serializer

Status: functional spike, matches brief 02's design with a few documented
deviations (see below).

## Goal

Prove decision D4: a Markdown file parses into a real ProseMirror document,
serializes back byte-for-byte when untouched, and an edit to one word changes
only that block's bytes. See [the brief](../../context/plans/2026-09-27-spike-1-brief-02-core.md)
for the full algorithm design and [the architecture decisions](../../context/docs/2026-09-27-architecture-decisions.md#d4-block-preserving-markdown-document-model--locked)
for D4 itself.

## Layout

- `src/schema.ts` — ProseMirror `Schema`. Meta attrs (`src`, `gap`, `*Hint`) are ignored by semantic comparison.
- `src/parse.ts` — `parseMarkdown` (full document), `parseBlock` (isolation re-parse for one block, with an optional splice text-run map), mdast → PM conversion.
- `src/style.ts` — `detectStyle`: file-convention majority vote.
- `src/serialize.ts` — `serializeDoc`: verbatim / splice / re-serialize candidates, in that order.
- `src/compare.ts` — `semanticEq`, `stripMeta`.
- `src/index.ts` — public re-exports.
- `test/*.test.ts` — round trip (handwritten + corpus smoke), single-word/structural edits, style detection.

## Running

```bash
npm install
node scripts/fetch-corpus.mjs   # once, populates corpus/fetched/ (gitignored)
npm test
```

## Test results (last run)

- Handwritten corpus (28 files): byte-identical, 100% verbatim path.
- `corpus/fetched/real/` (all 266): 265/266 byte-identical.
- `corpus/fetched/commonmark/` (all 655 examples): 655/655 byte-identical.
- `corpus/fetched/gfm/` (all 672 examples): 672/672 byte-identical.
- Single-word edit (6 named fixtures): exact replacement, splice path used.
- Structural edit (toggle `strong` in a list item): re-parses semantically
  equal, change confined to one top-level block.

The one remaining real-world failure
(`kubernetes-enhancements-kepssignode2837podlevelresourcespecr.md`) is a
remark/micromark parser-statefulness edge case, not a bug in this code: an
isolated re-parse of a top-level block's own `src` occasionally disagrees
with how the same substring parsed inside the full document, specifically
for a lazily-continued trailing HTML line (`<br>`) at the end of a list
nested 2+ levels deep. Diagnosed by comparing the raw mdast trees from a
full-document parse vs. an isolated parse of the identical substring: they
differ before any of our conversion code runs. See the builder log for the
full diagnosis.

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
