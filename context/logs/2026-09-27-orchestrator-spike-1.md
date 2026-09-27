# Log: spike 1 orchestrator, block-preserving Markdown round trip

Status: active
Author: spike orchestrator (Opus 5.5)
Updated: 2026-09-27
Charter: [spike 1 charter](../plans/2026-09-27-spike-1-charter-markdown-round-trip.md)
Plan: [spike 1 plan](../plans/2026-09-27-spike-1-plan-markdown-round-trip.md)
Time zone: CEST (UTC+2)

## 03:06 — task received
Launched by the lead. Checked out `spike/2026-09-27-markdown-round-trip` in worktree `agent-af7320636299cd0d4`. First `git fetch` failed in the sandbox, retried unsandboxed; branch up to date at 659d3c0 (charter commit).

## 03:08 — read bootstrap docs
AGENTS.md, architecture decisions, agent workflow, charter, technology assessment section B, spikes plan section 1.

## 03:09 — network probe
npm registry, raw.githubusercontent.com and api.github.com (unauthenticated, 60 requests per hour) are reachable. The corpus can pin commit SHAs through the API.

## 03:10 — lead message
Lead: the Bash sandbox is off for this session; git push and fetch work normally. Workers are told the same in their briefs.

## 03:15 — plan and brief 01 written, grinder dispatched (dispatch 1 of ~8)
Approach: remark positions, `src` and `gap` on top-level blocks, write-time compare, verified splice of text edits, style-aware re-serialization as last resort. See the plan.

## 03:28 — grinder handback, verified
Claimed 280 entries "all permissive"; that was wrong: 25 entries had Unknown, NOASSERTION, CC-BY-4.0 or AGPL-3.0 licenses. Fixed myself: Node.js docs relabelled MIT (Node's LICENSE is MIT; GitHub reports NOASSERTION because of bundled deps); dropped the other 14 (all emberjs/rfcs, pm2, serverless, cli-table, caniuse-lite). Corpus is now 266 real files (179 npm READMEs, 87 design docs). CommonMark spec was pinned to `master`; pinned to SHA 3da9394 (655 examples on current master, three more than 0.31.2). GFM spec: 672 examples; its text license is CC-BY-SA, acceptable because it is fetched, not committed. Clean fetch from an empty directory: 266 fetched, hashes verified.

## 03:35 — brief 02 (core) written
Decision: nested blocks carry only style hints, not `src`; only top-level blocks carry `src` and `gap`. The splice step gives list-item and table-cell precision for text edits without nested `src`, and fewer meta attrs means less CRDT churn. Revisit if gate B fails on nested content.

## 03:36 — core builder dispatched (dispatch 2)

## 03:50 — core builder handback, verified
`npm test` 8 of 9 as claimed. The one failure: a kubernetes KEP where a `<br>` line lazily follows a paragraph inside a three-deep list. Diagnosed myself: micromark parses that list differently at document start than in context (in context the `<br>` is an html node inside the list item; in isolation it becomes a second top-level node). Builder's claim that isolation "drops" it was imprecise; the diagnosis of context-dependence was right.

## 03:55 — my fixes to core (small, done myself rather than dispatching)
1. **Self-description check at parse time**: every modeled top-level block must re-parse in isolation to one node, semantically equal. Blocks that fail become opaque `raw_block` with `kind: unstable:<type>`. Gate A is now exact by construction; the metric that matters is how many blocks go opaque (1 block in 1593 files).
2. Verification of every candidate now also requires the re-parse to yield exactly one top-level block (before, a candidate that split into two blocks could pass if the first matched).
3. Opaque block text is now the construct's full source, including `---` and `$$` delimiters. Before, yaml and math used mdast `value`, so an edited front matter would have lost its fences.
4. Opaque top-level blocks emit their text directly; no parse compare.
Quick full check: gate A 28/28 handwritten, 266/266 real, 655/655 CommonMark, 672/672 GFM. 76 s for all 1621 files. `npm test` 9/9. Committed 473a978, pushed.
Found in reading: the positions side table records the top-level span for nested nodes; brief 03 asks for per-node spans.

## 04:02 — brief 03 (gates harness) written, builder dispatched (dispatch 3)

## 04:38 — gates builder handback, verified
The builder ran out of session before the full run finished; harness and quick results committed (565050e, bfda9b4), README edit uncommitted. Its `src/` changes: ctx skip-count caching and skipping ctx for blocks without `[` (82 s to 20 s on the real set), per-node positions side table. Quick run: B at 67 percent of files. I ran the full gates myself: A 100 percent, B 94.5 percent of corpus files, A3 (Yjs) 90.9 percent.

## 04:40 to 04:58 — my diagnosis and fixes (done myself: small, and needed judgement)
1. **Splice bug, nested blocks**: `trySplice` cut the top-level block's fragment at nested positions and got the wrapping list item back, so every edit inside a list or blockquote fell through to full re-serialization. Fixed by resolving both ends to the same textblock.
2. **Splice bug, run alignment**: text-run records were matched to PM text nodes by index, but adjacent mdast text leaves with equal marks merge into one PM node, and code-block text was never recorded. Runs were silently misattributed (wrong marks). Fixed by concatenating runs until they add up to the PM node's text, and skipping code text.
3. **End offset**: splice end now sits one past the last replaced character's source offset, so an escaping backslash of the following character is kept.
4. **Harness diff ambiguity**: the LCS line diff attributed a correct one-line change in a list of three identical lines to a neighbouring line. Containment now uses the prefix/suffix envelope, which is stricter and unambiguous.
5. **Link-level splice**: edits inside link text that is also syntax (shortcut references `[label]`, bare URLs) re-serialize just that link and splice it over the link's source span; shortcut and collapsed references become full references. Decision: `refType` is a syntax attr (meta), the identifier is the semantic target.
6. **Yjs**: plain y-prosemirror 1.3.7 (and `@tiptap/y-tiptap` 3.0.9, checked) drops root-node attrs and marks on inline leaf nodes; linked badge images lose their link in 140 of 1621 files. Added `src/yjs.ts`: root attrs in a Y.Map, leaf marks encoded in a meta attr `leafMarks`. A3b (codec plus binary update into a second Y.Doc) is 100 percent. The live ySyncPlugin path is not covered; flagged for spike 2.
Result, full run: A 294/294, A3b 1621/1621, B 293/293 files and 1465/1465 edits, C and D pass, E 149 files. Spec sets: B edits 99.8 percent. Committed ff237f9, pushed.

## 05:05 — brief 04 (structural edits) written
Word replacement is solved; structural edits (bold a word) still re-serialize whole top-level blocks. Brief 04 adds a B2 measurement, a textblock-level splice, re-serializer fidelity from hints, and semantic line breaks if time allows.

## 05:07 — structural builder dispatched (dispatch 4)

## 05:48 — structural builder handback, verified
All five tasks done (textblock splice, B2, hard-break and literal-link fidelity, semantic line breaks, harness fixes); 20/20 tests. Again the final full run was not committed. My full run: all gates pass; B2 98.6 percent of corpus files, 7 failing edits.

## 05:50 to 06:00 — my fixes from B2 failures
Traced all 7: (1) mdast-util-to-markdown peeks at `<` for inline html nodes and turned a soft line break before a bare URL or inline HTML into a space; the literal-link fix emitted an html node. Fixed with custom node types whose peek is their first character (inline HTML peeks `<` only for block start conditions 1 to 6). (2) Mark nesting closed and reopened marks in schema order; now keeps the longest still-carried prefix of open marks open. B2: 293/293 corpus files.

## 06:02 — reviewer dispatched (dispatch 5)

## 06:12 — reviewer handback
Major: unverified serialization was silently returned; gate E could pass vacuously on conventions it never re-checks (not inflated today). Minor: replacement words never exercise escaping; README stale; B only edits paragraphs. Verified sound: meta/semantic attr split, opaque escape hatch, no third-party content committed.
Actions (mine): `onUnverified` option, default throw with `UnverifiedSerializationError`, gates pass `emit` to measure; test added. Gate E now counts only conventions it re-checks and also checks strong, ordered delimiter, fence length, per-level heading style: 145 of 148 non-default files pass; the 3 failures are real re-serializer limits (fence length above 3, mixed setext and ATX), reported. README rewritten. Minor findings 3 and 5 accepted as documented limits, not fixed.

## 06:15 — clean checkout test found a real reproducibility bug
From a fresh clone, `npm test` failed because two tests read the fetched corpus. Added `pretest` that runs the idempotent fetch (1.5 s when present). Re-running the clean-clone check.

## 06:20 — findings doc and decision register rows S1-1 to S1-8 written
Timing (tools/timing.ts): median 22 ms parse, 22 ms serialize per README; worst 2 s each for a 240 KB file. Recorded as a risk.
