# Brief 03: engine — rebase, import, integration, comments, attribution, commit preparation

Status: dispatched
Author: spike 6 orchestrator (Opus 5.5)
Updated: 2026-09-27
Plan: [spike 6 plan](2026-09-27-spike-6-plan.md), sections 3 and 4 are the spec.
Charter: [spike 6 charter](2026-09-27-spike-6-charter-integration-engine.md), section "Rules for every agent in this spike" applies to you in full.

## Goal

Build `src/engine/` and the remaining CRDT interface points in `src/crdt/`, so that one headless code path does rebase onto an external commit, import of a saved text, needs-review flags and resurrection on every replica, comments with the D3 anchor record, attribution listing, and commit preparation, all on spike 1's full schema. The relay (brief 04) and the daemon (later) only call the engine. Serves D3 (as fixed after spike 2), D6 (fork, diff, merge; idempotent; serialized; needs-review; resurrection), D1 as amended (a commit records a new base and does not re-seed).

## Inputs to read

- `AGENTS.md`, this brief, plan sections 3 and 4.
- The package `spikes/2026-09-27-integration-engine/`: `README.md`, `src/crdt/` (its README and `index.ts`), `src/markdown/index.ts`.
- Source to port (under `$REF`, plan section 1): `2026-09-27-collab-stack-yjs13-hocuspocus/src/rebase/` (`rebase.ts`, `seed.ts`, `ids.ts`, `integrate.ts`, `comments.ts`, `liveIntegration.ts`, `text.ts`, and `gates/` for the scenarios), `src/attribution.ts`. `context/docs/2026-09-27-spike-2-findings-crdt-rebase.md` sections "The algorithm as built" and "Design points" only, read with `git show origin/spike/2026-09-27-crdt-rebase:context/docs/2026-09-27-spike-2-findings-crdt-rebase.md`.

## The main difficulty

Spike 2's integration and comment code assumes spike 2's schema: fragment `pm`, textblocks `paragraph`/`heading`/`code_block`, each with exactly one `XmlText`. Spike 1's schema has textblocks with several text runs and inline atoms (`image`, `hard_break`, `raw_inline`, footnote references), tables with cells, task items, and opaque `raw_block`s. Generalize, do not special-case: a textblock is any element whose ProseMirror node type `isTextblock`; its signature at a snapshot covers its attributes (semantic ones; exclude meta attrs `src`, `gap`, which the markdown module's `isMetaAttrName` identifies), and, in child order, each text run's formatted delta at the snapshot and each inline atom's name and semantic attributes including `leafMarks`. The plain-text projection for anchors must be defined once in `src/crdt/` and used consistently by anchor creation, fuzzy matching and resolution.

## Tasks, in order. Stop when task 8 is done.

1. **`src/crdt/` additions** (only `src/crdt` may touch Yjs):
   - `blockStatesAt(doc, snapshot?) -> Map<blockId, {signature, path}>` over every textblock ever created (walk including deleted subtrees, as spike 2's `collectBlocks` does), where blockId is the element's item id;
   - `resurrectBlock(doc, blockId, atSnapshot)` re-inserting a deleted textblock's content as of a snapshot under its nearest live ancestor (port spike 2's logic);
   - anchors (plan section 3 point 5): `textProjection(doc) -> string`, `anchorAt(doc, offset, assoc)`, `resolveAnchor(doc, anchor) -> offset | null`, with anchors as opaque serializable values (base64 of an encoded `RelativePosition`);
   - `onRemoteBatch(doc, isRemoteOrigin, handler(beforeSnapshot))`: spike 5's `attachIntegrationHook` mechanics (snapshot before a remote transaction, callback after), without the integration logic;
   - `inspectUpdate` exists; add `recordAttribution(doc, update, user, at)` and `listAttributedRanges(doc)` from spike 5's `attribution.ts`;
   - `forkDiffMerge` gains an optional `onFork(fork)` callback run inside the fork's transaction after the diff, so the engine can write records on the fork with `setMeta` (the fork is a `CrdtDoc`), and an option to run the diff under a given deterministic client id.
2. **`src/engine/seed.ts`:** `seedFromCommit(doc, {docId, markdown, commit, author, generation})`: deterministic seed peer `hash32(docId, commit, generation)`, content via crdt `seed`, `phraise` map entries per plan section 4 (`docId`, `generation`, `base`, `snapshot:<baseId>` written in a second transaction after the snapshot is taken, as spike 2 does), author registered. Two replicas seeding the same inputs produce byte-identical state.
3. **`src/engine/rebase.ts`:** `rebase(doc, {docId, targetMarkdown, targetCommit, author}) -> {applied, rebaseId}`: no-op if `base.commit === targetCommit`; else fork at the base snapshot with peer `hash32(docId, baseId, targetCommit)`, diff to the parsed target, write on the fork the record `rebase:<id>` with id `hash(baseId, targetCommit)` (fixes S2-11), the new `base`, the git author, then the new snapshot in a second transaction, and merge. Also `baseConflicts(doc)`. Applying the same rebase on two replicas yields identical bytes.
4. **`src/engine/integrate.ts`:** `attachIntegration(doc, {isRemoteOrigin, selfIsRebaser?})`: on each remote batch, for each rebase record this replica has not acked: flag textblocks changed upstream (base snapshot vs target snapshot) and also locally (base snapshot vs the pre-batch snapshot) as `concurrent-edit`; resurrect blocks deleted upstream that hold this replica's own edits, once, flagged `deleted-upstream-edited-locally`; write the ack. `ackOwnRebase(doc, rebaseId)` for the replica that ran the rebase (spike 5 S5-5). `listReview(doc)`, `clearReview(doc, blockId, user)`.
5. **`src/engine/comments.ts`:** comment store in the `comments` map: `createComment(doc, {from, to, body, author}) -> id` (offsets in the text projection), `createCommentOnQuote(doc, quote, occurrence?, ...)` for tests and tools, `reply(doc, id, {body, author})`, `resolveComment(doc, id, user)` (the resolved/unresolved status; name it `setResolved` to avoid clashing with anchor resolution), `listComments(doc) -> [{id, body, author, replies, resolved, anchor: {method: crdt | fuzzy | orphaned, from, to, quote}}]`. Anchor record and acceptance rule exactly as S2-9 (port spike 2's `fuzzyAnchor`).
6. **`src/engine/import.ts`, `commit.ts`, `attribution.ts`:**
   - `importText(doc, {base, text, clientId, author}) -> result` (parse, forkDiffMerge, register author kind `import`), the daemon's entry point later;
   - `markEditor(doc, user)` sets `editorsSinceCommit:<user>`; `prepareCommit(doc) -> {text, degraded, snapshot, coAuthors}` (render via crdt, snapshot taken in the same synchronous step); `recordCommit(doc, {commit, snapshot})` sets `base` to the commit with that snapshot stored as `snapshot:<commit>`, sets `lastCommit`, clears `editorsSinceCommit`; no re-seed;
   - `listAttribution(doc)` combining attributed ranges with author kinds.
7. **Unit tests** (`test/engine.*.test.ts`), headless, replicas as separate `CrdtDoc`s exchanging updates in causal order through a tiny in-test hub (see spike 2's `replica.ts` for the idea; keep it in `src/testkit/hub.ts`). Port spike 2's scenario gates to spike 1's schema with a document that includes a table, a list, a paragraph with a linked image and a hard break, and a heading:
   - A untouched comment resolves by CRDT; B rewritten paragraph comment recovered (CRDT or fuzzy); C deleted paragraph comment orphaned with quote kept, negative control not captured;
   - D offline edit and upstream edit to the same paragraph both survive and the block is flagged on every replica; converge in every batch order of three replicas; D2 deleted upstream plus edited offline resurrected once and flagged;
   - rebase idempotent (two replicas, identical bytes) and a retry is a no-op; `baseConflicts` detects sibling rebases;
   - comments: reply, resolve, survive another user's edits inside and around the quote; a comment inside a table cell and one spanning two paragraphs (report its method; do not require CRDT);
   - a rebase where the target changes a linked image's URL and link keeps both changes (spike 5's B3 concern for the rebase path);
   - `prepareCommit` after edits lists the editors; `recordCommit` then an external rebase from that commit works (the base snapshot taken at commit time is forkable);
   - `importText` at an old snapshot keeps a concurrent edit.
8. `npm test` and `npm run typecheck` pass. Module `README.md` for `src/engine`; update `src/crdt/README.md` and the package README layout and origin sections.

## Definition of done

`npm test` passes with the engine tests; `npm run typecheck` clean; no file outside `src/crdt` imports Yjs (the boundary test).

## Constraints

- Only add new files, except files inside `spikes/2026-09-27-integration-engine/` created by earlier briefs, which you may edit.
- Log: `context/logs/2026-09-27-builder-spike-6-engine.md`. Do not commit.
- Bash in this environment refuses commands that mention `git` inside pipes, loops, `cd &&` chains or heredocs. Run git commands as single plain commands. Prefer the Write tool for files.
- If a spike 2 behaviour cannot be carried to the full schema, say exactly which and why in your log and handback rather than weakening a test silently.
- Handback under 300 words.
