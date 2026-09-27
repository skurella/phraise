# Plan: spike 1, block-preserving Markdown round trip

Status: done
Author: spike orchestrator (Opus 5.5)
Updated: 2026-09-27
Charter: [spike 1 charter](2026-09-27-spike-1-charter-markdown-round-trip.md)
Log: [orchestrator log](../logs/2026-09-27-orchestrator-spike-1.md)

## Approach: remark positions, top-level `src`, verified splice

Spike directory: `spikes/2026-09-27-markdown-core-remark-splice/`.

1. **Parse** with unified + remark-parse + remark-gfm + remark-frontmatter + remark-math, positions on. Convert mdast to a real ProseMirror document. Every top-level block carries `src` (its exact bytes) and `gap` (the whitespace bytes after it up to the next block). The document carries `lead` (bytes before the first block) and style info.
2. **Serialize** each top-level block by trying candidates in order, each verified by re-parsing and comparing semantically with the current node:
   1. verbatim `src` if `parse(src)` equals the node (this is D4's write-time compare);
   2. **splice**: diff the old node (`parse(src)`) against the new node with ProseMirror's `findDiffStart`/`findDiffEnd`; if the change is text inside literal text runs, map PM positions to source offsets and splice the new text into `src`;
   3. full re-serialization of the block via mdast-util-to-markdown in the file's detected style (per-node syntax hints first, then file conventions, then defaults).
3. **Isolation parse context.** `parse(src)` of one block prepends the document's link-reference and footnote definitions so that `[x][y]` and `[^1]` resolve as they did in the whole document.
4. **Opaque blocks** for html, front matter, math, footnote definitions, link reference definitions and any unknown mdast node: an atom-like block whose text is its source.

Why this and not a CST parser first: remark gives offsets for every block and every text leaf, the splice step only needs text-leaf offsets, and every candidate is verified, so an imperfect serializer cannot silently corrupt a file. If gate B misses 98 percent because offsets are insufficient, the second approach is a Rust CST (comrak `sourcepos`) in a second directory.

## Tasks and dispatch order

| # | Brief | Worker | Output |
|---|---|---|---|
| 1 | [corpus](2026-09-27-spike-1-brief-01-corpus.md) | Haiku | manifest, fetch script, hand-written edge cases |
| 2 | [core](2026-09-27-spike-1-brief-02-core.md) | Sonnet | schema, parser, serializer, style detection, unit tests |
| 3 | [gates harness](2026-09-27-spike-1-brief-03-gates.md) | Sonnet | `npm run gates`, results table for A to E |
| 4 | fixes from gate failures | Sonnet or self | as needed |
| 5 | review | Sonnet, fresh context | findings by severity |
| 6 | fixes from review | Sonnet or self | as needed |

Budget: eight dispatches. Findings doc, register rows and handback are mine.

## Gate measurement definitions

- A: `serialize(parse(x)) === x` for every file, bytes compared, plus the same after a Yjs round trip through y-prosemirror.
- B: seeded random word (letters only, 3+ chars, not in inline code) in any paragraph at any depth, replaced with a fixed word by `tr.insertText`. Pass when (1) `parse(output)` equals the edited document semantically, and (2) every diff hunk lies inside the edited paragraph's source line range. Also reported: single-line diffs and within-top-level-block rates.
- C: A and B pass rates restricted to files containing each construct, from an mdast scan.
- D: schema is `prosemirror-model` `Schema`; every document passes `node.check()`; edits are `Transaction`s; Yjs round trip.
- E: forced re-serialization of every block with node hints off uses the detected file conventions; at least ten files with non-default conventions.
