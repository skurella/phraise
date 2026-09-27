# Brief 03: Yjs fuzz (gate H), granularity comparison, targeted re-seed measurement

Status: active
Author: spike orchestrator (Opus 5.5)
Updated: 2026-09-27
Related: [plan](2026-09-27-spike-2-plan.md), [charter](2026-09-27-spike-2-charter-crdt-rebase.md), [brief 02](2026-09-27-spike-2-brief-02-yjs-integration-gates.md)
Assignee: builder (Sonnet)

## Goal

Stress the fork rebase in `spikes/2026-09-27-crdt-rebase-yjs-fork/` with at least 500 randomized trials of upstream edits against concurrent local edits on realistic documents, categorize every failure, and produce numbers that compare diff granularities. Also replace gate G's weak measurement with a targeted one. Serves D5, D6, D3.

## Scope

### 1. Fuzz harness `src/fuzz/` and `npm run fuzz`

Seeded PRNG; every trial reproducible from `(seed, trialIndex)`; a failing trial prints its seed and a one-line repro command.

Per trial:

1. **Document A**: a random window of 8 to 25 consecutive top-level blocks from a random file in `fixtures/corpus/`, serialized back to Markdown and re-parsed so A is canonical.
2. **Replicas**: `server` (no human edits), `alice` online, `bob` offline, and in half the trials `carol` offline. All start synced at A.
3. **Local edits**, 1 to 6 per human, each chosen from: insert a unique token word (for example `tok_<replica>_<n>`) at a random word boundary; delete a random run of 1 to 4 base words (never delete another user's token); insert a new paragraph containing a token; delete a whole block; split a paragraph the way y-prosemirror does (delete the tail from the XmlText, insert a new paragraph element holding the tail); change a heading level. Alice's edits are delivered to the server before the rebase in most trials and partially in some.
4. **Upstream B**: 1 to 6 random mutations of pmA: replace, insert or delete words in a textblock; rewrite a paragraph; insert or delete a paragraph; delete a list item; add a list item; toggle a mark on a word; change a heading level; change a code block line. Serialize and re-parse, so B is canonical. Some mutations must hit blocks humans also edit; bias about half toward those.
5. **Rebase**: usually run on `server`; in 20 percent of trials run on two replicas independently (idempotence under fuzz); in 20 percent follow with a second chained rebase B to C before bob reconnects.
6. **Delivery**: shuffled per-update delivery among all links until quiescent, then a final full sync.
7. **Comments**: 5 comments on random word ranges of A, added before any edit.

Checks per trial, each failure counted under a category:

- `exception`: anything thrown.
- `diverged`: replicas differ in PM JSON or in the `review` map after final sync.
- `local-text-lost`: a token inserted by a human, and not deleted by that same human, is missing from the final doc text.
- `F-violation`: a textblock element visible at the latest base snapshot and not touched by any human (track touched element IDs in the trial log) is missing or differs from its base-snapshot content, compared as PM node JSON so marks count.
- `upstream-change-lost`: a block B changed whose final content shows none of B's change and which is not flagged. Record, do not fail the gate, but report the rate and the local edit kinds involved.
- `missing-flag`: a block edited by a human concurrently and changed upstream is not flagged. `spurious-flag`: a flagged block that fits neither. Report both rates.
- `schema-drop`: the Y tree has an element that `yXmlFragmentToProseMirrorRootNode` silently drops (compare counts of textblock elements with visible content).

Comment metrics per trial: method counts (`crdt`, `fuzzy`, `orphaned`); `mis-anchored` = anchored to a range whose text similarity to the quote is below 0.5 while the quote, or a version of it with at most 25 percent edits, exists elsewhere in the doc. Report rates.

Output a Markdown table per granularity: trials, failures by category, comment method rates, flag precision and recall, runtime.

### 2. Granularity comparison

Run at least 500 trials with `word` (this is gate H) and at least 200 each with `char`, `block` and `yprosemirror` on the same seeds. Compare comment CRDT survival in blocks B modified, upstream-change-lost rate and flag rates. Add a short interpretation to the README.

### 3. Gates

- Add row **H** to `npm run gates`: 500 `word` trials with a fixed seed; pass when `exception`, `diverged`, `local-text-lost` and `F-violation` are all zero. Keep total gates runtime under 3 minutes.
- Add row **G2** (targeted re-seed): for 200 comments across the corpus, apply 1 small edit (word insert, delete or replace) inside the quote or within 20 characters of it, then re-seed; report correct, orphaned and mis-anchored rates using the existing ground-truth mapping. Pass when mis-anchored is at most 2 percent. Also report 3 targeted edits. Leave the existing G row as is.

### 4. Fixing what the fuzz finds

If a category of real bugs appears in the core (not the harness), fix it when the fix is small and within the plan's semantics, with a regression test. If it needs a design change, do not redesign: record it with a minimal repro in the log and the handback.

## Definition of done

`npm install && npm test && npm run gates && npm run fuzz` succeed from the spike directory; `npx tsc --noEmit` clean; README documents the fuzz command, categories and the latest numbers. Commit.

## Constraints

- Model Sonnet. Effort budget about 3 hours; if exceeded, stop, log, hand back partial.
- Working directory `/Users/skk/code/phraise/.claude/worktrees/agent-afb20bfe01387fcb2`, absolute paths. No agents. Inside the spike directory you may edit existing files; outside it only add new files. Stage explicitly. Do not push.
- Log: `context/logs/2026-09-27-builder-spike-2-yjs-fuzz.md`, entries at every milestone and at least every 15 minutes.

## Handback

Under 300 words: the per-granularity tables (condensed), failure categories with counts and root causes, fixes made, open issues with repro seeds, commit hash.
