# Builder log: spike 1, brief 04 (structural edits)

Status: in progress
Author: builder (Sonnet 5)
Updated: 2026-09-27
Plan: [brief 04](../plans/2026-09-27-spike-1-brief-04-structural-edits.md)

Timezone: local machine (CEST, `date` confirms e.g. `Sun Sep 27 05:12:58 CEST 2026`).

## 04:35 -- task received

Brief 04 (structural edits): gate B2 measurement, textblock splice, re-serializer
fidelity, semantic line breaks (if time), harness fixes. Read AGENTS.md, the
brief, README.md, src/serialize.ts, src/parse.ts, gates/gateB.ts, gates/index.ts,
gates/gateE.ts, gates/lib/*, src/compare.ts, src/schema.ts, test/edit.test.ts,
test/positions.test.ts.

Key facts noted before touching src/:
- `parseBlock(src, ctx, {map:true})` already has a TextRun map + LinkSpan list
  for tryTextSplice/tryLinkSplice, but no per-textblock source-span info.
- `parseMarkdown(md, {positions:true})` already builds a `BlockPosMap`
  (WeakMap<PMNode, {startLine,endLine,startOffset,endOffset}>) recorded during
  mdast->PM conversion, for every non-inline node at any depth. This is exactly
  the shape brief 04 task 2 needs for textblock splice, just not yet threaded
  through `parseBlock`'s isolation parse.
- Candidate ladder in `serializeDoc`'s `emit()`: verbatim -> trySplice
  (tryTextSplice ?? tryLinkSplice) -> reserializeBlock (forced). Task 2 adds
  a fourth rung between link splice and full re-serialize.

## 04:40 -- task 2 implemented first (textblock splice), ahead of task 1's harness

Deviation from the brief's literal task order: I implemented task 2 (textblock
splice) in src/ before wiring up gate B2 (task 1), because task 1's stated goal
is to measure the *effect* of task 2, and I wanted one coherent measurement
pass. To still get an honest before/after without touching git history, I
added a `noTextblockSplice` SerializeOpts flag (mirrors the existing
`noSplice` flag) that disables only the new candidate; `tools/b2-before-after.ts`
runs gate B2's edits twice (with the flag on, then off) over the same corpus
subset and RNG seeds, so "before" reflects exactly the pre-task-2 code path
with zero risk of stashing/checkout mistakes in a shared worktree.

Implementation (src/parse.ts, src/serialize.ts):
- `parse.ts`: exported `BlockPosMap`/`NodePosInfo` (were private), and made
  `parseBlock` build and return a `positions: BlockPosMap` when `opts.map` is
  set, by threading the same `posMap` used by `parseMarkdown(..., {positions:true})`
  through `blockFromMdast` inside the isolation parse. Added `positions?` to
  `ParseBlockResult`. No change to existing map/links behavior.
- `serialize.ts`: new `tryTextblockSplice(block, src, ctx, style)`:
  1. Reparse `src` in isolation (`old = parseBlock(src, ctx, {map:true})`).
  2. `findDiffStart`/`findDiffEnd` between `old.content` and `block.content`
     (same technique as tryTextSplice) to get the diff range.
  3. Resolve that range in *both* `old` and `block` (`.resolve()` works on any
     PM node, not just a real doc -- already used elsewhere in this file);
     require the diff's start/end share one parent node in each, and that
     parent `isTextblock` (paragraph, heading, or table_cell -- excludes
     code_block/raw_block via `.type.spec.code`).
  4. Look up that old textblock's own source span in `positions` (the new
     posMap), convert to `src`-relative offsets.
  5. For ATX headings, narrow the span to after the `#`s+space and before any
     closing `#`s. For setext headings, drop the underline row. Table cells:
     bail if the new content contains a newline or unescaped `|`.
  6. Serialize the *new* textblock's own inline content by itself via
     `pmInlineToMdast` + `mdast-util-to-markdown` (same options as
     `reserializeBlock`), strip trailing newline.
  7. If the result (or the original span) is multi-line, re-apply the
     enclosing container's line prefix (blockquote `>` / list continuation
     indent) to every line after the first, taken from the span's own second
     physical source line (or derived from column if the span was one line).
  8. Splice over `[innerStart, innerEnd)` in `src`; verify
     (`parseBlock(candidate, ctx).count === 1 && semanticEq(...)`); return
     `null` on any failure so it always falls through to full re-serialize.
- Wired into `emit()`'s splice branch as a third candidate after
  tryTextSplice/tryLinkSplice, traced as `'textblock-splice'` (new `TraceInfo`
  kind). Guarded by the new `noTextblockSplice` opt.

Hand-verified (ad hoc scratch scripts, removed after): a bold toggle on a word
3-levels deep in `nested-mixed-markers.md`'s nested list now changes exactly
one physical line (`traces: [..., 'textblock-splice', ...]`); a bold toggle on
a word spanning a soft-wrapped 2-line blockquote paragraph in `blockquotes.md`
reproduces both `>`-prefixed lines untouched except the bolded word, and
re-parses `semanticEq` to the edited doc.

Added two tests to `test/edit.test.ts` per the brief's definition of done:
- "textblock splice: bold toggle in a nested list item changes only that item
  line, via textblock-splice" -- asserts exactly one changed physical line and
  a `textblock-splice` trace.
- "textblock splice: bold toggle in a blockquote paragraph keeps the > prefixes
  on every line" -- asserts byte-exact output (`md.replace(word, **word**)`)
  and a `textblock-splice` trace.

`npm test`: 13/13 pass (was 11/11; +2 new). `npx tsc --noEmit`: clean.

## 04:55 -- task 1: gate B2 harness

Added `gates/gateB2.ts` (`runGateB2`/`runGateB2One`), a near-duplicate of
`gateB.ts`'s per-file/per-seed loop reusing `findEligibleWords`/`posIndex`/
`makeRng`/`pick`/`computeHunks`/`hunksContained`/`firstHunkExcerpt` and gate
B's own `EditCategory`/`EditResult`/`FileWordResult`/`SEEDS_PER_FILE` types
(imported from `gateB.js`, not redefined), differing only in the edit itself:
toggle `strong` on the chosen word (`addMark`, or `removeMark` if every text
node in the range already carries it) instead of `insertText` replacement.
Takes an optional `SerializeOpts` passthrough so the same function can be used
for the before/after measurement without duplicating the loop.

Wired into `gates/index.ts`: refactored `setBCounts(set)`'s body into a
reusable `wordEditCounts(rs: FileWordResult[])` (same semantics, just no
longer hardwired to gate B's grouping), and added `setB2Counts(set)` on top
of it. Added a "B2. Structural edit (bold toggle)" results-table row,
threshold "none, measured", pass `'n/a'`, plus a full detail section
(per-set file/edit/single-line rates, path distribution, failure categories)
mirroring gate B's, and B2 counts in `results/gates.json`.

`npm run gates -- --quick` (30 corpus files, 27 real + 3 handwritten; also ran
against the full commonmark/gfm stress sets) with B2 wired up and textblock
splice *already in src/* (see deviation note above) gave, informationally:
B2 30/30 files (100%), 150/150 edits (100%). Gates A/A2/A3b/B/C/D/E all still
pass their thresholds; no regression. (results/gates.md|json from this
--quick run were reverted before committing -- only a full run's results are
meant to be committed, per the brief.)

## 05:05 -- B2 before/after (task 2's required measurement)

`tools/b2-before-after.ts` (kept as a small permanent tool; runs gate B2's
edits twice over the same parsed corpus and RNG seeds, once with
`{noTextblockSplice: true}` and once with the default opts) on the --quick
subset (30 corpus files: 3 handwritten + 27 real; commonmark 40, gfm 44
sampled):

**BEFORE (textblock splice disabled, i.e. the state at the start of this brief):**
- corpus files (real+handwritten): files 20/30 (66.7%), edits 136/150 (90.7%), single-line 128/150 (85.3%)
- real alone: files 17/27 (63.0%), edits 121/135 (89.6%)
- path distribution (all sets incl. commonmark/gfm): re-serialize 506, splice 61, unverified 3
- category distribution: ok 510, diff-outside-paragraph-but-inside-block 54, semantic-mismatch 6

**AFTER (textblock splice enabled, current code):**
- corpus files (real+handwritten): files 30/30 (100.0%), edits 150/150 (100.0%), single-line 141/150 (94.0%)
- real alone: files 27/27 (100.0%), edits 135/135 (100.0%)
- path distribution: textblock-splice 506, splice 61, unverified 3
- category distribution: ok 567, semantic-mismatch 3

Finding: textblock splice not only fixes every
`diff-outside-paragraph-but-inside-block` case (the expected effect -- a list
or blockquote edit no longer forces the whole list/blockquote to
re-serialize) but also fixes 3 of the 6 `semantic-mismatch` cases outright.
Root cause (consistent with the README's existing "Findings from the first
full run" B section): those 3 mismatches were the `incrementListMarker: true`
list-renumbering bug (editing one item forced whole-list re-serialize, which
renumbers ordered-list markers even when the source repeated `1.`
throughout) -- textblock splice sidesteps it by never re-serializing the
enclosing list at all. The full-corpus before/after numbers are captured in
the final `npm run gates` run and `results/gates.md`/`.json` (see later entry).

Committed checkpoint next (tasks 1+2 with tests green), then moving to task 3
(re-serializer fidelity) before a final full gates run.
