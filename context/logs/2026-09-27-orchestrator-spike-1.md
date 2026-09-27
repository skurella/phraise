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

## 04:02 — brief 03 (gates harness) written
