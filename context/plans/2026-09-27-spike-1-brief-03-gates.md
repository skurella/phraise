# Brief 03: gates harness, one command for gates A to E

Status: done
Author: spike orchestrator (Opus 5.5)
Updated: 2026-09-27
Plan: [spike 1 plan](2026-09-27-spike-1-plan-markdown-round-trip.md)
Worker: builder (Sonnet)

## Goal

Build the executable evidence for decision D4: a single command, `npm run gates`, that runs success gates A to E of the [charter](2026-09-27-spike-1-charter-markdown-round-trip.md) over the whole corpus and prints a results table. Measure honestly; do not change `src/` behaviour to make numbers look better. If you find a real bug in `src/`, you may fix it, test it, and log it; list every `src/` change in your handback.

## Working directory

`/Users/skk/code/phraise/.claude/worktrees/agent-af7320636299cd0d4/spikes/2026-09-27-markdown-core-remark-splice/`. The core exists (`src/`, `test/`, `npm test` green). Read `README.md` there and skim `src/index.ts`, `src/parse.ts` (`parseMarkdown`, `parseBlock`, positions side table), `src/serialize.ts` (`serializeDoc`, `trace`), `src/style.ts`. `tools/quick-roundtrip.ts` is a crude gate A loop you can replace.

## Inputs to read

`AGENTS.md`; D4 in `context/docs/2026-09-27-architecture-decisions.md`; the charter's gate table; the spike code. Nothing else.

## What to build

`gates/` directory with TypeScript run by tsx, and package scripts:
- `npm run fetch` → `node scripts/fetch-corpus.mjs`.
- `npm run gates` → fetches the corpus if `corpus/fetched/` is missing, then runs all gates, prints a Markdown results table to stdout, writes `results/gates.md` (the table plus per-gate detail and failure lists) and `results/gates.json`, and exits non-zero if any gate misses its threshold. `results/` is committed (numbers and file ids only, never third-party content beyond short excerpts).
- `npm run gates -- --quick` runs a deterministic subset (every 10th file) for fast iteration.

Corpus sets, reported separately: `handwritten` (28), `real` (266), `commonmark` (655), `gfm` (672). The charter's thresholds apply to **real + handwritten** combined ("corpus files"); spec examples are reported alongside as stress tests with their own numbers, not thresholds.

### Gate A, no-edit round trip (threshold 100 percent)

For each file: `serializeDoc(parseMarkdown(md).doc) === md`. Also count top-level blocks that became opaque via the self-description check (`raw_block` with `kind` starting `unstable:`), and the trace path distribution. A2: the same round trip after `doc.toJSON()` → `Node.fromJSON(schema, json)`. A3: the same after a Yjs round trip with y-prosemirror (`prosemirrorToYXmlFragment` / `yXmlFragmentToProseMirrorRootNode`, or the `prosemirrorJSONToYDoc` / `yDocToProsemirrorJSON` helpers). Add `yjs` and `y-prosemirror` as dependencies. If y-prosemirror loses attrs such as `src`, `gap`, `lead` or `eol`, report it as a finding; do not paper over it.

### Gate B, single-word edit (threshold 98 percent of corpus files)

For each file, and for several seeds per file (5):
1. Parse with `positions: true`. **Fix the positions side table first**: it currently records the enclosing top-level span for every node. Gate B needs each paragraph's own source line range. Record, for every PM block node at any depth, its own mdast `position` (start and end line and offset). Nodes inside top-level blocks that became opaque have no entries.
2. Eligible words: maximal `/[A-Za-z]{3,}/` matches inside text nodes of `paragraph` nodes at any depth (inside lists and blockquotes too), where the text node has no `code` mark and the characters immediately before and after the match in the paragraph's `textContent` are not letters, digits or `_`. Choose one with a seeded PRNG (seed from file id and seed number). Files with no eligible word count as "n/a" and are excluded from the denominator; report how many.
3. Replace it with `zebra` (or `quokka` if the word is `zebra`) via `EditorState.create({ doc }).tr.insertText(word, from, to)` (a real ProseMirror transaction).
4. `out = serializeDoc(newDoc, { trace })`.
5. Pass requires **both**: (a) semantic correctness: `parseMarkdown(out).doc` has the same number of top-level blocks as `newDoc` and each is `semanticEq`; (b) containment: a line diff of `md` against `out` (use the `diff` npm package or your own LCS; split on `\n`) has every hunk inside the edited paragraph's own source line range.
6. Also record: whether exactly one line changed; whether the change stayed inside the enclosing top-level block; which serializer path the edited block took (`splice`, `re-serialize`, `unverified`).
7. Categorize failures: `semantic-mismatch`, `diff-outside-paragraph-but-inside-block`, `diff-outside-block`, `exception`, with file id, seed, word, path, and a 200-character excerpt of the first differing hunk in `results/gates.md`.

Report per set: files pass rate (a file passes if all its seeds pass), edits pass rate, single-line rate, path distribution, failure categories.

### Gate C, opaque and special constructs (threshold: every file containing the construct passes A, and B's containment holds for all edits in those files)

Scan each file's mdast for: front matter (yaml, toml), raw HTML blocks, MDX/JSX (html blocks whose first tag starts with an uppercase letter, or paragraphs starting with `import ` or `export `), math (block and inline), footnote definitions, link reference definitions, Mermaid fences, other fenced code, tables. Report per construct: files containing it, block count, A pass, B file pass rate. Additionally, for every B edit, check explicitly that each top-level block of those kinds outside the edited top-level block appears byte-identical in `out` (its `src` is a substring at the expected place; simplest is to compare `out` line ranges outside the edited block against the original, block by block). Report the count checked and preserved.

### Gate D, editor-model fidelity (threshold 100 percent)

Report: the schema is a `prosemirror-model` `Schema` instance; `doc.check()` passes for every parsed document and every edited document; edits are `Transaction`s (by construction); A2 and A3 results above.

### Gate E, style detection (threshold: at least 10 files with non-default conventions pass)

For each corpus file (real + handwritten): `style = detectStyle(md, mdast)`. A file is "non-default" if any convention differs from the defaults in `src/style.ts`. For each file, `forced = serializeDoc(doc, { forceReserialize: true, useHints: false })`, then `detectStyle(forced, parse(forced))`; the file passes if every convention that actually appears in `forced` (it has a bullet list, emphasis, a fence, a level 1 or 2 heading, a thematic break, more than one line) equals the input's detected convention. List passing non-default files with their conventions. Also report, as information: the fraction of top-level blocks whose forced re-serialization is byte-identical to `src`, with hints on and with hints off; and the fraction whose forced re-serialization is semantically equal (verification rate).

### Results table

Print one table like:

| Gate | Threshold | Result | Pass |
|---|---|---|---|
| A no-edit round trip, corpus files | 100% | 294/294 | yes |
| ... | | | |

followed by per-set detail.

## Definition of done

- `npm test` still green; add a small test for the positions side table fix.
- `npm run gates -- --quick` and `npm run gates` both run to completion; full run under about 15 minutes on this laptop (report the time). If it is slower, profile and fix the hot spot (probably `parseBlock` with a large definitions context) or report why not.
- `results/gates.md` and `results/gates.json` committed from a full run.
- README updated: how to run the gates, what each gate measures.
- Numbers you report in the handback match `results/gates.md`.

## Constraints

- Model: Sonnet. Budget: one session of up to about two and a half hours.
- The Bash sandbox is off; network and git work normally. npm only.
- Commit on the current branch as you go; do not push. One git command per Bash call. Never commit `corpus/fetched/` or `node_modules/`.
- Do not launch further agents.
- Log at `context/logs/2026-09-27-builder-spike-1-gates.md` per AGENTS.md.

## Handback, under 300 words

The results table; the top failure categories with counts and one example each; every `src/` change and why; run time; commit SHA; log path.
