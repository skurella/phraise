# Brief 02: Yjs replica integration, comments, attribution, gates A to G

Status: active
Author: spike orchestrator (Opus 5.5)
Updated: 2026-09-27
Related: [plan and algorithm spec](2026-09-27-spike-2-plan.md), [charter](2026-09-27-spike-2-charter-crdt-rebase.md), [brief 01](2026-09-27-spike-2-brief-01-yjs-core.md)
Assignee: builder (Sonnet)

## Goal

On top of the core in `spikes/2026-09-27-crdt-rebase-yjs-fork/`, build the replica integration layer (needs-review, resurrection, acks), comments with CRDT plus selector anchoring, attribution, and re-seed, then prove charter gates A to G with a `npm run gates` command. Serves D1, D3, D6.

## Scope

Implement plan sections 5 to 8. Suggested files: `src/replica.ts`, `src/integrate.ts`, `src/comments.ts`, `src/attribution.ts`, `src/reseed.ts`, `src/gates/*.ts`, `scripts/gates.ts`. Existing core files may be extended where needed (they are your spike's own new files), but do not change the rebase semantics.

### Replica harness (`src/replica.ts`)

- `Replica` wraps a `Y.Doc` (gc off) with a name and a human user; registers `authors[clientID] = { kind: "human", userId, name }` on creation. Deterministic client IDs from a test seed.
- Links between replicas carry an explicit queue of updates; `online`/`offline`; `deliver(from, to, order?)` so tests can deliver queued updates in any order, including shuffled. Offline replicas queue outgoing updates.
- `replica.receive(updates)`: take `P = Y.snapshot(doc)`, apply the updates, then run `integrate(doc, P, myClientId)` from plan section 5.
- Helpers to edit: insert or delete text at a global plain-text offset, insert or delete a block. Text edits go straight to the block's `Y.XmlText`, as y-prosemirror would for typing.
- `runRebase(replica, targetMarkdown, commit, author)`: compute the update with `computeRebaseUpdate`, feed it through the replica's own `receive` so integration runs, and queue it to peers.

### Integration (`src/integrate.ts`), plan section 5

Needs-review flags, resurrection of blocks deleted upstream but edited locally, `ack:<rebaseId>:<clientID>` entries. Content at a snapshot: `XmlText.toDelta(snapshot)` and `Y.isVisible`. `needsReview(doc)` lists flagged blocks with their current text.

### Comments (`src/comments.ts`), plan section 6

`addComment(doc, fromOffset, toOffset, body, author)`, `resolveComment(doc, id)`, `resolveAll`. Use `approx-string-match`. Quote selectors per plan: exact, 32-char prefix and suffix, offsets, max errors `min(64, ceil(0.25 * len))`, accept at quote similarity >= 0.75.

### Attribution (`src/attribution.ts`), plan section 7

### Re-seed (`src/reseed.ts`), plan section 6

## Gate scenarios (each a vitest test and a row in `npm run gates`)

Use a realistic document of 6 to 10 blocks including a list and a heading. Replicas: `server` (runs rebases, human-less or a user "srv"), `alice` online, `bob` who goes offline.

- **A** comment on a range in a paragraph neither side changed resolves via `crdt` to the identical text after the rebase.
- **B** comment in a paragraph commit B rewrote (words around the quote change, the quote survives) resolves to the quote text. Report method (`crdt` or `fuzzy`) for each granularity `word`, `char`, `block`; `block` must still pass through `fuzzy`.
- **C** comment in a paragraph commit B deleted resolves `orphaned` and keeps its quote. Also a negative control: a paragraph with similar but different text elsewhere must not capture it.
- **D** bob offline edits paragraph P; alice online edits paragraph Q; B changes P and Q; server rebases; bob reconnects. Run every delivery order of the pending update sets across server, alice and bob (at least all permutations of the three batches, plus 50 shuffled per-update orders). All replicas converge (identical PM JSON and identical `review` map), bob's and alice's inserted text and B's changes are present, P and Q are flagged, no other block is flagged. Variant D2: B deletes P while bob edited it offline: P is resurrected with bob's text once, flagged `deleted-upstream-edited-locally`, all replicas converge.
- **E** `listAttribution` shows ranges by alice, bob, the seed git author and the synthetic rebase peer named after the git author of B.
- **F** every block not concurrently edited equals B's version: map each B textblock to the live element (via identity: elements whose Y item was created in the fork or at seed and survive) and compare to B, excluding flagged blocks and blocks with human items. Also check the live doc minus human-touched blocks equals B.
- **G** re-seed: with unchanged text, 100 percent of comments (at least 50 random comments across the corpus in `fixtures/corpus/`) re-anchor to the identical text. With 1, 3 and 10 random small word edits applied to the Markdown before re-seeding, report correct, orphaned and mis-anchored rates, where ground truth comes from mapping the original range through the edits and "correct" means overlap with the ground-truth range at IoU >= 0.5 (an orphan is correct when the ground-truth range was fully deleted). Pass criterion: 100 percent unchanged, zero mis-anchored under 1 edit; report the rest as numbers.

`npm run gates` prints a Markdown table: gate, pass/fail, key numbers. Exit code non-zero if any gate fails. Also add a gate row for "rebase idempotent on two replicas".

## Non-scope

Fuzz (gate H), Loro, UI, networking.

## Definition of done

From the spike directory: `npm install && npm test && npm run gates` all succeed, `npx tsc --noEmit` clean, README updated with the gates command and what each gate proves. Commit on the branch.

## Constraints

- Model Sonnet. Effort budget about 3 hours. If exceeded, stop, log, hand back partial with a clear state.
- Working directory `/Users/skk/code/phraise/.claude/worktrees/agent-afb20bfe01387fcb2`, absolute paths. No agents. Only add new files outside your spike directory; inside it you may edit files from brief 01. Stage explicitly. Do not push.
- Log: `context/logs/2026-09-27-builder-spike-2-yjs-gates.md`, entries at every milestone and at least every 15 minutes. If the spec in plan section 5 or 6 turns out wrong or ambiguous, choose the simplest sound fix, log it as a finding, and tell me in the handback.

## Handback

Under 300 words: gate table as printed, deviations and findings, known issues, commit hash.
