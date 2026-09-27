# Brief 02: markdown core, ProseMirror schema, block-preserving serializer

Status: dispatched
Author: spike orchestrator (Opus 5.5)
Updated: 2026-09-27
Plan: [spike 1 plan](2026-09-27-spike-1-plan-markdown-round-trip.md)
Worker: builder (Sonnet)

## Goal

Implement the document model and serializer that prove decision D4: a Markdown file parses into a real ProseMirror document, serializes back byte for byte when untouched, and an edit to one word changes only that block's bytes. The algorithm is designed below; your job is to implement it well, with tests.

## Working directory and layout

`/Users/skk/code/phraise/.claude/worktrees/agent-af7320636299cd0d4/spikes/2026-09-27-markdown-core-remark-splice/`. The corpus already exists there (`corpus/`, `scripts/fetch-corpus.mjs`); run `node scripts/fetch-corpus.mjs` once to populate `corpus/fetched/`. Create:

```
package.json          npm, "type": "module", TypeScript run with tsx; scripts: test
tsconfig.json         strict
src/schema.ts         ProseMirror Schema
src/parse.ts          markdown -> PM doc (+ optional position side table)
src/style.ts          detect file conventions
src/serialize.ts      PM doc -> markdown
src/compare.ts        semantic equality of PM nodes
src/index.ts          re-exports: schema, parseMarkdown, serializeDoc, detectStyle, semanticEq
test/*.test.ts        node:test or vitest, your choice; `npm test` runs them
README.md             goal, status, how to run
```

Use npm (pnpm is broken on this machine). Node 22.12. Dependencies: `unified`, `remark-parse`, `remark-gfm`, `remark-frontmatter`, `remark-math`, `mdast-util-to-markdown` with `mdast-util-gfm`, `mdast-util-frontmatter`, `mdast-util-math` for serialization, `prosemirror-model`, `prosemirror-state`, `prosemirror-transform`. Dev: `typescript`, `tsx`, `@types/node`.

## Inputs to read

- `AGENTS.md`, and D4 in `context/docs/2026-09-27-architecture-decisions.md`.
- The corpus hand-written files in `corpus/handwritten/`.
- Nothing else is required.

## Design (implement this)

### Schema (`src/schema.ts`)

A `prosemirror-model` `Schema`. Attributes are of two kinds: **semantic** (compared) and **meta** (ignored by comparison). Meta attrs: `src`, `gap`, and anything named `*Hint`.

Top-level block nodes all have meta attrs `src: string|null` and `gap: string|null`. Nested blocks carry hint attrs only.

Nodes:
- `doc`: content `block+`, attrs `lead` (bytes before first block, usually `""`), `eol` (`"\n"` or `"\r\n"`).
- `paragraph`: `inline*`.
- `heading`: `inline*`, attrs `level`, hint `setextHint` (bool), `closeHint` (closing `#` sequence present).
- `blockquote`: `block+`.
- `bullet_list`: `list_item+`, attrs `tight` (semantic), hint `markerHint` (`-`,`*`,`+`).
- `ordered_list`: `list_item+`, attrs `start`, `tight`, hint `delimHint` (`.` or `)`).
- `list_item`: `block*`, attrs `checked` (`null|true|false`).
- `code_block`: `text*`, `marks: ""`, `code: true`, attrs `lang`, `meta`, hints `fenceHint` (`` ` ``, `~`, or `indent`), `fenceLenHint`.
- `horizontal_rule`: hint `ruleHint` (the exact source line, e.g. `***`).
- `table`: `table_row+`, attrs `align` (array); `table_row`: `table_cell+`, attr `header` bool; `table_cell`: `inline*`.
- `raw_block`: opaque source block. Content `text*`, `marks: ""`, `code: true`, attr `kind` (`html`, `yaml`, `toml`, `math`, `footnoteDefinition`, `definition`, or the unknown mdast type). Its text is the block's source (top level: exactly `src`; nested: the mdast `value` if present, else the source slice with container indentation removed from continuation lines). Opaque blocks are edited as source text.
- Inline: `text`; `hard_break` (inline leaf, hint `breakHint`: the exact source such as `"  \n"` or `"\\\n"`); `image` (inline leaf, attrs `url`, `alt`, `title`, reference attrs `refType`, `identifier`, `label` when it came from an imageReference); `raw_inline` (inline leaf, attrs `kind` (`html`, `inlineMath`, `footnoteReference`, unknown), `value` = the exact source slice).
- Marks: `em` (hint `markerHint`), `strong` (hint `markerHint`), `strike`, `code` (excludes other marks is not required; keep simple), `link` (attrs `href`, `title`, `refType`, `identifier`, `label`; hint `kindHint`: `inline`, `autolink`, `literal`, `reference`). Soft line breaks stay as `"\n"` inside text.

### Parse (`src/parse.ts`)

`parseMarkdown(md: string, opts?: { positions?: boolean }): { doc: Node, positions?: BlockPos[] }`

1. Parse with unified + remark-parse + remark-gfm + remark-frontmatter(`['yaml','toml']`) + remark-math. Positions are UTF-16 offsets into `md` (`position.start.offset`).
2. For each top-level mdast child `i`: `src = md.slice(start_i, end_i)`, `gap = md.slice(end_i, start_{i+1})` (last block: to end of file). `doc.lead = md.slice(0, start_0)`. Assert gaps are whitespace; if not, include the non-whitespace in the previous block's `src` (log it).
3. Convert mdast to PM recursively. Nested mdast inline trees become flat text with marks. Any unknown node type becomes `raw_block` (block) or `raw_inline` (inline). `html`, `yaml`, `toml`, `math`, `footnoteDefinition`, `definition` become `raw_block`. `inlineMath`, `footnoteReference`, inline `html` become `raw_inline`.
4. An empty document is `doc(paragraph())` with `lead = md`.
5. With `positions: true`, return a side table `BlockPos[]`: for every PM block node (any depth), its PM start position and its source `[startOffset, endOffset]` and start/end line. This is test instrumentation only; do not store it in the doc.
6. `eol`: `"\r\n"` if CRLF lines are the majority, else `"\n"`.

**Isolation parse**, `parseBlock(src, ctx)`: to compare one block, it must parse as it did in context. Build `ctx` once per document: the concatenated source of every `definition` and `footnoteDefinition` node in the document (at any depth), each followed by a blank line. Parse `ctx + src`, drop the leading nodes that come from `ctx` (count them by parsing `ctx` alone once), and convert the rest. Prepend, never append: an unclosed fence or HTML block at the end of `src` would swallow appended context. Store `ctx` on the doc as a meta attr `defs` or recompute it from the `raw_block`s of kind `definition` and `footnoteDefinition` at serialization time (preferred: recompute, so the doc stays self-describing).

### Semantic compare (`src/compare.ts`)

`semanticEq(a: Node, b: Node): boolean`: same type, same semantic attrs (ignore meta attrs), same marks with same semantic attrs, same text, children pairwise equal. Also provide `stripMeta(node)` if useful.

### Style detection (`src/style.ts`)

`detectStyle(md, mdast)` returns file conventions by majority vote over the source: bullet marker, ordered delimiter, emphasis marker, strong marker, fence character and length, heading style (ATX or setext for levels 1 and 2), closed ATX, thematic break string, list item indent (`one` or `tab`/`mixed`), `eol`. Defaults when absent: `-`, `.`, `*`, `**`, backtick x3, ATX, no close, `---`, `one`, `\n`. Store it on the doc as attrs or compute at serialization; your choice, but gate E needs `detectStyle` exported.

### Serialize (`src/serialize.ts`)

`serializeDoc(doc, opts?: { useHints?: boolean (default true), forceReserialize?: boolean, noSplice?: boolean, trace?: (info) => void }): string`

Output is `doc.lead` + for each top-level block: `emit(block)` + `(block.gap ?? eol + eol for new blocks, eol for the last new block)`.

`emit(block)` tries candidates in order and returns the first that **verifies**:
1. **Verbatim.** If `src != null` and `semanticEq(parseBlock(src, ctx), block)`: return `src`. No further verification needed.
2. **Splice.** If `src != null`: let `old = parseBlock(src, ctx, { map: true })`. Compute `start = old.content.findDiffStart(block.content)` and `{a: endOld, b: endNew} = old.content.findDiffEnd(block.content)` (normalize so `endOld >= start` and `endNew >= start`, per the ProseMirror docs about overlapping ends). If the old range `[start, endOld)` lies inside one literal text run of `old` (see map below) or is empty and adjacent to one, and the new slice `block.slice(start, endNew)` is plain text whose marks equal the marks at that position in `old`, then candidate = `src.slice(0, s) + escape(newText) + src.slice(e)` where `s,e` are source offsets of `start,endOld`. Verify by `semanticEq(parseBlock(candidate, ctx), block)`. If verification fails, retry once without escaping.
   The **map**: during the `map: true` parse, for each mdast `text` node (and `inlineCode` value) record its PM range and an array mapping each value character to a source offset. Build it by greedy alignment of `value` against `md.slice(start, end)`: walk both; when characters match, record and advance both; otherwise skip source characters that are whitespace, `>`, `\\` (escape) or `\r`; if a source character cannot be skipped, mark the run non-literal (unsplicable). For `inlineCode`, align `value` against the slice after the opening backtick run. Entities (`&amp;`) make a run non-literal; that is acceptable.
   `escape(text)`: backslash-escape `\ * _ \` [ ] < > #` and a leading `+ - = |` only when needed; start minimal and let verification catch mistakes.
3. **Re-serialize.** Convert the block to mdast and run `mdast-util-to-markdown` with the gfm, frontmatter and math extensions and options from the style: node hints first when `useHints`, else file conventions, then defaults. Map to its options: `bullet`, `bulletOrdered`, `emphasis`, `strong`, `fence`, `fences: true`, `setext`, `closeAtx`, `rule`, `ruleRepetition`, `listItemIndent`, `incrementListMarker`. Strip the trailing newline to-markdown adds; convert `\n` to `\r\n` if `eol` is CRLF. `raw_block` converts to an mdast `html` node whose value is its text, so it is emitted verbatim. Verify; if verification fails, still return it but report `trace({ kind: 'unverified', ... })`.

`forceReserialize: true` skips candidates 1 and 2 (for gate E). `noSplice` skips candidate 2. `trace` reports which candidate won per block, so the gate harness can count them.

Cache `parseBlock` results by `src` string within one `serializeDoc` call.

## Tests (definition of done)

`npm test` passes and includes:
1. **Round trip, hand-written:** every `corpus/handwritten/*.md` satisfies `serializeDoc(parseMarkdown(x).doc) === x`, and every top-level block took the verbatim path.
2. **Round trip, quick corpus smoke:** the first 50 files of `corpus/fetched/real/` and the first 200 CommonMark examples, byte-identical. Report failures with file names; do not hide them. If some fail, fix what you can and list the rest in your handback with a diagnosis.
3. **Single word edit:** for at least `tables.md`, `blockquotes.md`, `nested-mixed-markers.md`, `crlf.md`, `reference-links.md`, `long-paragraphs.md`: replace a word in a paragraph via `EditorState.create({doc}).tr.insertText('zebra', from, to)`, serialize, and assert the output equals the original with exactly that word replaced (string replace at the known offset), and that the splice path was used.
4. **Structural edit:** toggle `strong` on a word in a list item; serialize; the output re-parses to the edited doc (`semanticEq`) and only that top-level block changed.
5. **Style:** `detectStyle` on each `style-*.md` returns the conventions the file uses; `serializeDoc(doc, { forceReserialize: true, useHints: false })` on `style-star-bullets.md` uses `*` bullets, `_` emphasis, `__` strong, `~~~` fences, setext headings.
6. `doc.check()` passes for every parsed document in the tests.

## Constraints

- Model: Sonnet. Budget: one long session; if the corpus smoke keeps failing after about two hours of fixing, stop, log where you are and hand back.
- Do not write the gate harness; that is the next brief. Keep `src/` free of test concerns except the optional positions side table and `trace`.
- The Bash sandbox is off; network and git work normally.
- Commit on the current branch (`spike/2026-09-27-markdown-round-trip`) as you go with clear messages; do not push. Never commit `corpus/fetched/` or `node_modules/`.
- Do not launch further agents.
- Log at `context/logs/2026-09-27-builder-spike-1-core.md` per AGENTS.md: decisions, surprises (especially about remark positions), test results.

## Handback, under 300 words

Outcome; test results with counts; smoke round-trip failures with diagnosis; deviations from this design and why; what remark positions could not provide; commit SHA; log path.
