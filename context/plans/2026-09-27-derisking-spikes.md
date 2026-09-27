# Plan: Phase 0 derisking spikes

Status: proposed, awaiting owner go-ahead. No code has been written.
Author: lead agent (Fable 5.1)
Updated: 2026-09-27
Serves: [architecture decisions](../docs/2026-09-27-architecture-decisions.md) D4, D5, D6, D7, D10

Three timeboxed spikes, run sequentially, each owned by one Opus orchestrator that delegates to Sonnet and Haiku workers as it sees fit. The steps below are a starting point for the orchestrator, not a prescription; each spike gets its own charter file. Spike code lives in `spikes/<date>-<component>-<approach>/`, self-contained with its own README and tests. A second approach to the same spike gets its own directory; the findings doc compares them. Each spike ends with a findings doc in `context/docs/` and a log in `context/logs/`. If all three pass, nothing downstream requires a rewrite.

## Spike 1: block-preserving round trip

Goal: prove D4. Parse Markdown with source positions, edit one block in a ProseMirror document, serialize, and get a one-block diff. Untouched files come back byte-identical.

Inputs: decisions doc D4; technology assessment section B; BlockMD and Loxel PR 261 as prior art to read, not copy.

Steps:
1. Grinder (Haiku) collects a corpus: 200 to 300 real README and design-doc Markdown files from permissively licensed public repos, plus the 652 CommonMark examples, plus hand-written edge cases: front matter, raw HTML, MDX, tables with alignment, footnotes, math, Mermaid fences, nested lists with mixed markers, reference links, hard line breaks, CRLF.
2. Builder implements in TypeScript: remark parse with positions, a ProseMirror schema where every block node has a `src` attribute, a serializer that re-parses `src` and structurally compares before deciding to emit verbatim or re-serialize, style detection for bullets, emphasis markers, fence style, and opaque source blocks for unrecognized constructs.
3. Test A: load and serialize every corpus file with no edits. Must be byte-identical for 100 percent.
4. Test B: for each file, programmatically change one word in one paragraph, serialize, and diff. Must be a single-hunk diff touching only that block for at least 98 percent, with the failures explained.
5. Test C: a paragraph edit under the semantic line break option reformats only that paragraph.

Definition of done: tests A to C pass at the stated thresholds; findings doc states whether remark positions sufficed or a CST parser such as comrak or markdown.mbt is needed; a list of constructs that had to become opaque blocks.

Effort budget: two builder sessions. Escalate to Opus if the structural compare is not converging.

## Spike 2: rebase a live doc onto an upstream commit

Goal: prove D5 and D6. A Yjs document with three open comments and one unsynced concurrent edit is rebased onto a commit that rewrites two paragraphs and deletes one, with no user dialog, and the comments survive or are explicitly orphaned.

Inputs: decisions doc D3, D5, D6; technology assessment sections A and C; spike 1 code for parsing.

Steps:
1. Build a Node harness: seed a Y.Doc from commit A's Markdown through the spike 1 schema; attach three comments as Yjs relative positions plus quote selectors.
2. Simulate a second client with an offline edit in a paragraph that commit B also changes.
3. Implement the rebase: block diff A to B, word-level diff inside changed blocks via diff-match-patch, apply as Yjs transactions with an origin marking the synthetic git peer.
4. Merge the offline client's update after the rebase.
5. Re-resolve comments: CRDT position first, quote selector fuzzy fallback, orphan past the budget.
6. Serialize and confirm untouched blocks are byte-identical to commit B.

Definition of done: an automated test where the comment in an untouched paragraph keeps its CRDT anchor, the comment in a rewritten paragraph re-anchors by quote, the comment in the deleted paragraph is orphaned with its quote preserved, the offline edit and commit B's edit to the same paragraph both survive and the block is flagged "needs review", and the serialized output matches commit B outside the concurrently edited paragraph. Findings doc states whether Yjs expressed this cleanly or whether Loro's fork and applyDiff would be materially simpler.

Effort budget: two builder sessions. Escalate to Opus after the first if the harness is not running end to end.

## Spike 3: daemon file materialization

Goal: prove D7. A live Yjs doc served by Hocuspocus is materialized as a real file in a git working tree; edits in VS Code and in a browser Tiptap tab converge; a `git commit` from the CLI in between is absorbed as an external commit.

Inputs: decisions doc D2, D6, D7; technology assessment section D; spike 1 and 2 code.

Steps:
1. Run Hocuspocus locally with the spike 1 schema and a minimal Tiptap page.
2. Write a Node daemon: connect as a Yjs client, write the serialized doc to `<worktree>/<path>` on change with a write-guard to ignore its own writes, watch the file with chokidar, and on external change compute a diff and apply it as Yjs ops attributed to the local user.
3. Exercise: type in the browser, see the file change; type in VS Code, see the browser change; run `git commit -am` in the worktree and then edit again in the browser; confirm no conflict copy is produced and the CRDT's base commit advanced.
4. Force divergence by editing the file while the daemon is stopped and the browser edits the same paragraph; confirm a conflict copy is written and nothing is overwritten.

Definition of done: a scripted demo with the four exercises above and timing numbers for file-change to browser-update latency; findings doc on debounce values, write-guard approach, and whether a Node daemon is adequate or a Rust daemon is warranted.

Effort budget: two builder sessions.

## Update 2026-09-27, 04:05

Spike 2 has been reframed to run independently of spike 1 and in parallel, see decision P10 and its own charter. A fourth spike on GitHub storage mechanics was added, see P11 and its charter. Spike 3, the daemon, still depends on the results of spikes 1 and 2 and will be chartered after they hand back. The charters are authoritative where they differ from the text above.

## Order and gates

Spike 1 gates spike 2 gates spike 3. After each spike the lead reads the findings doc and the reviewer handback, updates the decisions doc (default to locked, or revised), and writes the next brief. The owner is consulted only if a default decision needs revising.
