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

## 08:29 — tasks 1-5 done, tests pass

Wrote `src/core/diff.ts`, `src/core/versions.ts`, `src/core/docsync.ts`,
`src/testkit/remote-editor.ts`, `src/testkit/tokens.ts`, and
`test/core.docsync.test.ts` / `test/core.concurrent.test.ts` /
`test/core.inline-leaves.test.ts` (plus `test/helpers.ts`). All 10 tests
pass (3 fresh/stale/undo, 4 concurrent x order combinations, 2 inline-leaf,
1 md-roundtrip carried over); `npx tsc --noEmit` clean.

Deviations from the literal test list in the brief:
- "Decode the resulting update and assert every inserted/deleted item lies
  inside that top-level block": implemented via Yjs's own transaction
  change-tracking (`ydoc.on('update', (_,_,_,tr) => tr.changed)`) rather
  than hand-decoding the update's binary struct list. `tr.changed` gives the
  exact set of Y types whose content changed in that transaction; walking
  each up to its top-level-block ancestor and checking there is exactly one
  such ancestor, equal to the target block, is an equivalent guarantee
  (nothing outside that type had an item inserted/deleted) with far less
  fragile code than parsing update bytes by hand. See `test/helpers.ts`
  (`changedTypesDuring`, `topLevelBlockOf`).
- Token generator (`src/testkit/tokens.ts`) deliberately avoids `_` in
  generated tokens: the serializer escapes a literal `_` in plain text
  (`\_`, since it's an emphasis marker), which split naive substring/regex
  matching against rendered markdown. Alnum-only tokens sidestep this.

Committed as tasks 1-5 (commit 80c85de).

## 08:31 — task 6: gates/f-roundtrip.ts written

Wrote `gates/f-roundtrip.ts` per plan section 6 / brief task 6: seeded
(mulberry32, seeded per corpus file id) 5-round byte-fuzz per corpus file
(`corpus/handwritten` + `corpus/fetched/real`, 294 files total; `--quick`
takes every 10th), plus all 47 half-typed states x 10 base docs (3 under
`--quick`) x 4 positions (start/between-blocks/end/end-of-line). Uses
`render({ wholeDocCheck: true })` (gate mode, per plan 3.5) and classifies
`UnverifiedSerializationError` by `blockIndex` (-1 = whole-doc check, >=0 =
per-block). Writes `results/f-roundtrip.json`.

`--quick` run: 100% pass (714/714), 5 coarse fallbacks, 15 repairs.

## 08:36 — task 7: full gate F run, found and fixed a real bug in my own diff.ts

First full run (294 files x 5 rounds = 1470, + 1880 half-typed = 3350
checks): 99.94% pass (3348/3350), but **`repairTotal: 214`** (DocSync's
internal verify-then-repair safety net firing on 214/3350 imports, ~6.4%)
was a red flag -- the whole point of the word-level diff (plan 3.4's "why
word level, not `updateYFragment` everywhere") is to avoid needing the
repair fallback that often, so I investigated instead of just logging the
number.

Root cause (confirmed by direct `applyDiff` instrumentation, no CRDT
merge/fork involved -- reproduced on a single fast-path import): my
`syncMatchedPair` (the "matched pairs, meta attrs may still differ" step,
plan 3.4 step 2) recursed into a **textblock**'s children by naive array
index, pairing `yNode.toArray()[i]` against `nodeChildren(bNode)[i]`. This
is correct for structural containers (blockquote, list_item, table_row: PM
children map 1:1 to Y children) but wrong for textblocks: y-prosemirror
merges every run of consecutive PM text nodes (one per distinct mark-run)
into a *single* `Y.XmlText`, while inline leaves (image/hard_break/
raw_inline) stay their own `Y.XmlElement` -- so Y's child count is usually
much smaller than PM's own child count, and the arrays are not
index-parallel. On an untouched paragraph with a link then a hard_break
then more text (7 PM children: 3 plain/marked text runs + 1 link-marked
run repeated + hard_break, Y has 3: [XmlText, hard_break, XmlText]), index
`i` paired the hard_break's Y element against a random PM *text* node
(which has an empty `attrs` object), and `updateAttrs`'s "remove attrs B
doesn't have" loop then deleted the hard_break's own `breakHint` attr,
silently resetting it to the schema default the next time the doc was
read back. This is why `render()` kept passing (a hard break is still a
hard break either way) but the whole-doc verify step tripped, and gate F's
repair count was masking it.

Fixed in `src/core/diff.ts`'s `syncMatchedPair`: for a textblock node
(`isTextblockName`), classify B's children with the same `classifyChildren`
helper `updateTextblockContent` already uses (groups of consecutive text
into one slot, one slot per leaf), walk Y's actual children in order, and
only recurse (sync attrs) on the leaf slots -- text slots are skipped
entirely per "never touch text". This is a bug in my own new code
(`src/core/diff.ts`), not in `src/md/`, so I fixed it outright rather than
just logging it as a finding.

Verified: re-ran the corpus fuzz loop standalone (no DocSync, just
`applyDiff` + JSON equality) against the specific file that showed the
mismatch (`golang-proposal-design55022pgoimplementationmd.md`, one
hard_break, backslash-style) -- no mismatch after the fix. Full test suite
still green (`npx vitest run`, 10/10). Full gate F re-run:

```
corpus files: 294 (handwritten + real)
round-trip rounds: 1470/1470 passed
half-typed insertions: 1878/1880 passed (10 base docs x 47 states x 4 positions)
overall pass rate: 99.94% (3348/3350)
coarse-textblock fallbacks: 26
repairs (whole-fragment fallback after verify mismatch): 0
forked imports: 0, noop imports: 0
failures: 2 (half-typed-mismatch x2)
```

`repairTotal` is now 0 (was 214) -- confirms the fix, not just a
symptom-level workaround.

### Remaining 2 failures: a genuine `src/md/` finding, not fixed

Both failures are the *same* root cause: half-typed states
`indented-code-start` (`"    indented code"`) and `tab-indent`
(`"\tstarts with tab"`) inserted at the `between-blocks` position into
`corpus/handwritten/footnotes.md` (a file with multi-paragraph footnote
definitions whose continuation paragraphs are themselves indented).

Isolated with a standalone `parseMarkdown` + `serializeDoc` round-trip (no
diff, no Yjs at all -- confirmed this is 100% a spike-1 issue):
`parseBlock`'s isolation-reparse technique (used by `serializeDoc`'s
verbatim/splice candidate to confirm a block's own `src` still parses back
to the same block) prepends `ctx` -- *all* of the document's footnote/link
reference definitions, concatenated, **regardless of where they actually
sit in the real document** -- before the candidate block's own `src`. Our
inserted indented-code block sits *before* `footnotes.md`'s footnote
definitions in the real document (so it's genuinely a standalone block
there), but `ctx` places those same footnote definitions immediately
*before* it when reparsing in isolation. Since one footnote definition
here has an indented continuation paragraph, the isolated reparse of
`ctx + src` sees "blank line, then 4-space-indented content" right after
an open footnote definition, and lazy-continuation rules attach our
content to that footnote as more of its own body instead of parsing it as
a fresh top-level code block (`parseBlock` returns `count: 0`, i.e. the
combined parse produced no *additional* top-level block at all). Verbatim
reuse therefore correctly bails (as designed) and falls through to the
structured re-serialize candidate for `code_block`, which -- separately --
**always** emits fenced style (`fences: true` is unconditional in
`optionsFor`, and the `fenceHint === 'indent'` case explicitly skips
borrowing a fence character, i.e. indented style is never reachable via
re-serialize, only via verbatim). Net effect: a *genuinely new* indented
code block that happens to precede an indented-continuation footnote
definition gets serialized back as fenced -- semantically identical
content, different bytes, so gate F's byte-equality check fails.

This is a real spike-1 parser/serializer limitation (`src/md/parse.ts`'s
`parseBlock` ctx-adjacency artifact, compounded by
`src/md/serialize.ts`'s re-serialize path never producing indented-style
code blocks), not a spike-3 diff bug -- reproduced with zero CRDT/diff
code involved. Not a "few lines" fix (would need either making the
isolation reparse aware of true document adjacency, or teaching
re-serialize to honor `fenceHint: 'indent'`), so per the brief I did not
touch `src/md/`. Logging it here as the finding instead.

**Findings summary for the lead:**
1. (fixed, spike-3-owned) `syncMatchedPair`'s textblock recursion assumed
   Y/PM child-array parity; fixed to classify textblock children the same
   way `updateTextblockContent` does. Impact: was silently corrupting meta
   attrs (observed: hard_break `breakHint`) on ~6% of real-corpus edits,
   papered over by the repair fallback until gate F's repair-count anomaly
   surfaced it.
2. (not fixed, `src/md/`-owned) `parseBlock`'s `ctx` prepend can create a
   spurious lazy-continuation merge between an unrelated block and a
   footnote/reference definition's own continuation, when reparsed in
   isolation for verbatim-reuse verification. Combined with re-serialize
   never emitting indented-style code blocks, an indented code block
   inserted ahead of such a definition loses its indentation style (stays
   semantically valid, fenced instead of indented). Affects 2/3350 gate F
   checks (both synthetic half-typed insertions into the same corpus
   file); not observed in any of the 1470 pure byte-fuzz rounds across 294
   real/handwritten files.

Committing tasks 6-7 next.
