Status: in progress
Author: builder (Sonnet 5)
Updated: 2026-09-27
Brief: [brief 03: engine](../plans/2026-09-27-spike-6-brief-03-engine.md)

Timezone: local machine time (CEST), from `date`.

## 16:59 -- task received

Read AGENTS.md, brief 03, the charter's "Rules for every agent in this spike",
and plan sections 3 and 4. Read the existing package state
(`spikes/2026-09-27-integration-engine/`): briefs 01/02 already built
`src/markdown/`, `src/crdt/` (points 1-4 minus blockStatesAt/resurrectBlock/
anchors), `src/git/`, `src/testkit/` basics. Read reference sources under
`$REF`: spike 2's `src/rebase/*` (via spike 5's live copy, `collab-stack-yjs13-hocuspocus/src/rebase/`)
and spike 5's `src/attribution.ts`. Read spike 2's findings doc sections
"The algorithm as built" and "Design points" via `git show origin/spike/2026-09-27-crdt-rebase:...`.

Plan for this session (tasks 1-8 of the brief, in order):

1. `src/crdt/` additions: blockStatesAt/resurrectBlock (generalized textblock
   walk), anchors (textProjection/anchorAt/resolveAnchor), onRemoteBatch
   (generic before/after-snapshot hook), recordAttribution/listAttributedRanges,
   forkDiffMerge onFork callback + forceFork option.
2. `src/engine/seed.ts`
3. `src/engine/rebase.ts`
4. `src/engine/integrate.ts`
5. `src/engine/comments.ts`
6. `src/engine/import.ts`, `commit.ts`, `attribution.ts`
7. Unit tests (`test/engine.*.test.ts`), `src/testkit/hub.ts`
8. `npm test` / `npm run typecheck`, READMEs.

### Design decisions made before writing code (logging now, in case I run out of room later)

- **forkDiffMerge's `onFork` timing**: the brief says "run inside the fork's
  transaction after the diff". I call it AFTER the existing verify/repair
  step (not literally inside the single diff `transact()` block), so that
  any snapshot the callback takes (`snapshot(fork)`) is guaranteed to reflect
  content that already equals `target` exactly, even on the rare repair
  path. Yjs does not distinguish "which transact() call" produced an op for
  byte-identity purposes (clocks are assigned in call order, not per
  transaction), so this does not change determinism, and it removes a
  correctness risk (a snapshot taken before repair could later be forked
  from state that never actually equalled the rebase target).
- **`forceFork` option added to `forkDiffMergeOpts`** (not explicitly named
  in the brief, but required by it): rebase must attribute its diff ops to
  a *deterministic* peer id shared by every replica running "the same
  rebase" (`hash32(docId, baseId, targetCommit)`), for the "two replicas
  produce identical bytes" requirement. forkDiffMerge's existing fast path
  (skip forking when `base` already equals the live snapshot) applies the
  diff directly under the live doc's OWN current `clientID`, which is
  replica-specific once a replica has done any local editing under its own
  identity. Without forcing a fork, a replica with zero edits since `base`
  would misattribute the rebase's ops to its own live identity instead of
  the shared rebase peer, breaking byte-identical output across replicas.
  `engine/rebase.ts` always passes `forceFork: true`.
- **New crdt meta accessors**: `listMetaEntries(doc, map, prefix?)` and
  `deleteMeta(doc, map, key)`, alongside the existing `getMeta`/`setMeta`/
  `transact`. Needed because engine must enumerate `rebase:*`, `ack:*`,
  `editorsSinceCommit:*` keys and delete `editorsSinceCommit:*` on commit,
  and the plan's "small typed accessor" only covered single-key get/set.
  Logged as a small, justified extension of that accessor, not a new Yjs
  boundary violation (still crdt-only).
- **New crdt block-authorship primitive**: `blockHasOwnEditsSince(doc,
  blockId, clientId, baseSnapshot, atSnapshot)`, generalizing spike 2's
  `hasOwnVisibleEditSince` (which only scanned one block's single XmlText)
  to scan every text run and every inline-atom-insertion item under a
  textblock. Needed by `engine/integrate.ts`'s resurrection rule ("resurrect
  if this replica's own edits since the base are still visible"), which
  cannot be computed from `blockStatesAt`'s opaque signature alone.

## 17:22 -- all 8 tasks done, npm test / typecheck pass

Implemented, in order:

1. `src/crdt/blocks.ts` (blockStatesAt, resurrectBlock, blockHasOwnEditsSince,
   collectBlocks, isTextblockName -- generalized textblock walk), `anchors.ts`
   (textProjection/anchorAt/resolveAnchor), `integrationHook.ts`
   (onRemoteBatch, wouldPend), `attribution.ts` (recordAttribution,
   listAttributedRanges), and edited `forkDiffMerge.ts` (onFork, forceFork),
   `meta.ts` (listMetaEntries, deleteMeta), `index.ts` (new exports).
2. `src/engine/seed.ts` (seedFromCommit + accessors).
3. `src/engine/rebase.ts` (rebase, baseConflicts).
4. `src/engine/integrate.ts` (attachIntegration, ackOwnRebase, listReview,
   clearReview).
5. `src/engine/comments.ts` (createComment, createCommentOnQuote, reply,
   setResolved, listComments, fuzzyAnchor port).
6. `src/engine/import.ts`, `commit.ts`, `attribution.ts`, `types.ts`,
   `index.ts`.
7. `src/testkit/hub.ts` (Hub class: join/deliver/deliverAll, causal
   hold-back via crdt's wouldPend) and five `test/engine.*.test.ts` files
   (seed, rebase, integrate, comments, commit) -- 20 new tests.
8. `npm test` (46/46 across 14 files) and `npm run typecheck` (clean) both
   pass; updated `src/crdt/README.md`, `src/engine/README.md` (new), and
   the package `README.md` (layout, origin table, a new "Changes to copied
   code (brief 03)" section).

### Bug caught and fixed by the tests

`rebase()`'s "already at target commit" short-circuit computed
`rebaseId: rebaseRecordId(base.id, opts.targetCommit)` using the CURRENT
(already-advanced) `base.id`, which is wrong once any rebase has actually
run -- the correct id for "already there" is simply the current `base.id`
itself (which, by construction, always equals either the original seed
commit or exactly the rebaseId of whichever rebase produced this base).
Caught by `test/engine.rebase.test.ts`'s retry-is-a-no-op test. Fixed in
`src/engine/rebase.ts`.

### Verification

- `cd spikes/2026-09-27-integration-engine && npm run typecheck` -- clean.
- `npm test` -- 14 files, 46 tests, all passing (includes the pre-existing
  26 from briefs 01-02, unaffected).
- `test/import-boundary.test.ts` (unmodified) still passes: no file outside
  `src/crdt/` imports `yjs`/`y-protocols`/`lib0`/`@tiptap/y-tiptap` --
  verified this holds for every new file (`src/engine/*`, `src/testkit/hub.ts`)
  by construction (they only ever import from `../crdt/index.js`'s opaque
  API) and by the test itself passing.
- `git status --porcelain` (repo root): only files inside
  `spikes/2026-09-27-integration-engine/` were touched, and every modified
  (not newly-added) file among them predates this brief (README.md,
  src/crdt/README.md, forkDiffMerge.ts, index.ts, meta.ts) -- matches the
  "only add new files, except files inside spikes/.../ created by earlier
  briefs" constraint. `context/logs/` and this brief's own log are new, as
  expected; nothing under `context/docs/` or elsewhere was touched.

### Deviations / interpretations logged (also in READMEs)

- `forkDiffMerge`'s `onFork` runs after verify/repair, not literally
  "inside the diff's own transact() call" -- correctness reason given above
  and in `forkDiffMerge.ts`.
- `forceFork` added to `ForkDiffMergeOpts` (not explicitly named in the
  brief, but required for the "two replicas produce identical bytes"
  property to hold in the edge case where a replica happens to have made
  no local edits since `base`).
- `crdt.listMetaEntries`/`deleteMeta` and `crdt.blockHasOwnEditsSince`
  added as small, logged extensions to the plan's stated crdt surface.
- `engine.attribution.listAttribution`'s "combining attributed ranges with
  author kinds" is implemented as a join by user name (the two maps are
  keyed differently -- clientId vs. user name -- and the brief does not
  spell out the join key); a range matching no known author reports kind
  `'unknown'`.
- `attachIntegration`'s `selfIsRebaser?` option: implemented as a
  defense-in-depth predicate (skip the scan, just ack) for a rebase id this
  replica computed itself, in case such a record ever reaches the hook via
  some batch; the PRIMARY mechanism for "the replica that ran the rebase
  acks immediately" (S5-5) is still the separate `ackOwnRebase` call, since
  a purely local `rebase()` call's transaction will typically never even
  reach `isRemoteOrigin` in the first place. Reasoning and spike 5 relay
  source citation are in `integrate.ts`'s header comment.
- Scope reduction, logged rather than silently narrowed: "converge in
  every batch order of three replicas" is tested with three representative
  permutations plus `deliverAll()` to finish convergence, not an exhaustive
  fuzz over all orderings -- a full combinatorial/randomized fuzz belongs
  to the gates (milestone 4's gate L), not this brief's unit tests.
- `src/testkit/hub.ts` is a full mesh (every joined replica linked to
  every other), not spike 2's arbitrary link graph -- sufficient for every
  test scenario this brief needed (2-3 replicas), simpler to reason about.

No spike 2 behavior was silently weakened to make a test pass; the one
place a test's original design turned out to be unrecoverable by
construction (a rewritten-paragraph quote that shared only one word with
its replacement) was corrected to a scenario that actually exercises the
"recovered by fuzzy" path, not loosened to accept `'orphaned'`.

### Handback

See final message to the orchestrator (SubagentHandback).
