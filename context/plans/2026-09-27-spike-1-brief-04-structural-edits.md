# Brief 04: structural edits, textblock splice, re-serializer fidelity, semantic line breaks

Status: dispatched
Author: spike orchestrator (Opus 5.5)
Updated: 2026-09-27
Plan: [spike 1 plan](2026-09-27-spike-1-plan-markdown-round-trip.md)
Worker: builder (Sonnet)

## Goal

Gates A to E pass (see `spikes/2026-09-27-markdown-core-remark-splice/results/gates.md`). Word replacements are handled by splicing text into the block's source. This brief covers what happens on **structural** edits, such as bolding a word or inserting a link, which today re-serialize the whole top-level block: a whole list or blockquote gets rewritten when one item's paragraph gains a bold word. Serves D4 and the charter's stretch goals (a list-item edit touching only that item; semantic line breaks).

## Working directory

`/Users/skk/code/phraise/.claude/worktrees/agent-af7320636299cd0d4/spikes/2026-09-27-markdown-core-remark-splice/`. Read its `README.md`, `src/serialize.ts` (`serializeDoc`, `trySplice`, `tryTextSplice`, `tryLinkSplice`, `reserializeBlock`), `src/parse.ts` (`parseBlock` with `map: true`, `TextRun`, `LinkSpan`), and `gates/` (`index.ts`, `gateB.ts`, `gateE.ts`).

## Inputs to read

`AGENTS.md`; D4 in `context/docs/2026-09-27-architecture-decisions.md`; the code above. Nothing else.

## Tasks, in priority order

### 1. Measure first: gate B2, structural edits (informational, no threshold)

Add to the gates run, reusing gate B's word selection and seeds: instead of replacing the word, **toggle `strong`** on it (`tr.addMark(from, to, schema.marks.strong.create())`, or `removeMark` if it is already strong). Report per set exactly like gate B: semantic correctness, diff inside the edited paragraph, inside the top-level block, single-line rate, path distribution, failure categories. Add a B2 row to the results table with threshold "none, measured". Record the baseline numbers in your log before changing `src/`.

### 2. Textblock splice (new serializer candidate between link splice and full re-serialization)

When the diff between `old = parseBlock(src)` and the new block lies inside one textblock (paragraph, heading, or table cell) at any depth, re-serialize only that textblock's inline content and splice it over the textblock's source span:
- `parseBlock(src, ctx, { map: true })` must also return, for each textblock, its PM range and its mdast source span (`position.start.offset` to `position.end.offset`). Match PM textblocks to mdast nodes in document order, as the link spans do; disable if counts differ.
- Serialize the new textblock's inline content with `mdast-util-to-markdown` (a `paragraph` node wrapping the phrasing content, same extensions and style options as `reserializeBlock`), strip the trailing newline.
- Line prefixes: for a textblock whose source spans several lines (inside a list item or blockquote), every continuation line in the source starts with a container prefix (spaces, `>` markers). Take the prefix from the textblock's own second source line (the characters from the line start up to the first character of the textblock's content on that line, found through the text-run map offsets); if the original is a single line, derive it from the first line: characters from the line start up to the textblock start column, with list markers replaced by spaces and `>` kept. Apply it to every line after the first of the re-serialized text.
- Headings: only splice the inline content of ATX headings (the span after `#`s and the space); for setext headings splice the text lines only. Table cells: splice the cell content between the pipes; if the result contains a newline or an unescaped `|`, give up.
- Verify as every candidate is verified (`count === 1 && semanticEq`). Trace as `textblock-splice`.

Expected effect: B2's "inside the edited paragraph" rate goes up sharply and list or blockquote edits touch only the edited item. Report before and after.

### 3. Re-serializer fidelity (the last-resort path)

Improve `reserializeBlock` output fidelity using the hints the parser already records, measured by gate E's informational "byte-identical to src" rate (currently 94.2 percent with hints on) and the B2 numbers:
- `hard_break`: emit its `breakHint` (two spaces or backslash) instead of always a backslash. Use a custom `break` handler for `mdast-util-to-markdown` or carry the hint through the mdast node.
- Links with `kindHint` `autolink` whose text equals the URL: emit `<url>`; `literal` whose text equals the URL (or `www.` form): emit the bare text. Keep `[text](url)` when the text differs.
- Anything else cheap you find by looking at the top ten most common forced-re-serialization diffs (add a small tool that prints them). Stop when returns diminish; this is not a pretty-printer project.

### 4. Semantic line breaks, only if 1 to 3 are done

`serializeDoc(doc, { semanticLineBreaks: true })`: when a paragraph is re-serialized or textblock-spliced (never when verbatim or text-spliced), put one sentence per line (split after `.`, `!` or `?` followed by whitespace and an uppercase letter or a digit; never inside inline code, links or URLs). Verification must treat soft line breaks and single spaces as equal in this mode only (a `semanticEq` option). Add a test showing that an edited paragraph is reformatted and the neighbouring paragraphs are byte-identical.

### 5. Small harness fixes

- Gate E: report the number of non-default files in total, not only the passing ones, and list failing non-default files if any.
- README: describe the serializer candidate ladder (verbatim, text splice, link splice, textblock splice, re-serialize), the gates, the tools in `tools/`, and the Yjs codec in `src/yjs.ts`.

## Definition of done

- `npm test` green with new tests for textblock splice (a bold toggle in a nested list item changes only that item's line; a bold toggle in a blockquote paragraph keeps the `>` prefixes), for hard break hints, and for semantic line breaks if done.
- `npm run gates` passes all thresholds as before (A, A3b, B, C, D, E must not regress), with the B2 row present; `results/gates.md` and `results/gates.json` committed from a full run.
- Your log records B2 before and after, and gate E's byte-identical rate before and after.

## Constraints

- Model: Sonnet. Budget: one session of up to about two and a half hours. Stop and hand back with a clear state if you run over.
- Every serializer candidate must stay verified; never return unverified output from a splice.
- The Bash sandbox is off; network and git work normally. npm only.
- Commit on the current branch as you go; do not push. One git command per Bash call. Never commit `corpus/fetched/` or `node_modules/`.
- Do not launch further agents.
- Log at `context/logs/2026-09-27-builder-spike-1-structural.md` per AGENTS.md.

## Handback, under 300 words

The results table; B2 before and after; gate E byte-identical rate before and after; what you did not get to; every `src/` change; commit SHA; log path.
