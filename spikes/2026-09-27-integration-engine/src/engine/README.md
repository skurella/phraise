# src/engine

Brief 03. The headless engine: rebase, import of a saved text, needs-review
flags and resurrection on every replica, comments with the D3 anchor record,
attribution listing, and commit preparation -- all on spike 1's full schema.
The relay (brief 04) and the daemon (later) call only this module (plus
`src/git` directly for the actual git I/O); neither touches `src/crdt`.
Depends on `src/crdt` and `src/markdown` only (plan section 2's dependency
direction); never imports `yjs`/`y-protocols`/`@tiptap/y-tiptap` itself
(enforced by `test/import-boundary.test.ts`, which scans every file outside
`src/crdt/`).

## Modules

- **`ids.ts`** -- `hash32(...parts)`: deterministic 32-bit FNV-1a hashing for
  peer ids (variadic; spike 2's `hash32(docId, commit)` grows an extra
  `generation` component here). `seedPeerId`, `rebasePeerId`,
  `rebaseRecordId` (the S2-11 fix: `hash(baseId, targetCommit)`, not
  `targetCommit` alone).
- **`seed.ts`** -- `seedFromCommit(doc, {docId, markdown, commit, author,
  generation?})`: deterministic seeding (two replicas seeding the same
  inputs produce byte-identical `Y.Doc`s). `getBase`/`getDocId`/
  `getGeneration`/`getSnapshotFor`, `base64FromSnapshot`/`snapshotFromBase64`
  (shared with `rebase.ts`/`commit.ts`).
- **`rebase.ts`** -- `rebase(doc, {docId, targetMarkdown, targetCommit,
  author}) -> {applied, rebaseId}`: fork-at-base rebase built on
  `crdt.forkDiffMerge`'s `onFork` callback (writes the new `base`, the
  `rebase:<id>` record, the author entry and the new `snapshot:<id>`, all on
  the fork, so they ride along in the merge back into `doc`) and
  `forceFork: true` (a replica with no local edits since `base` must still
  attribute the rebase's ops to the shared deterministic rebase peer, not
  its own live identity -- see `forkDiffMerge.ts`'s own doc comment).
  No-op if already at `targetCommit`, or if this exact rebase (by id) is
  already recorded (idempotent retry from anywhere). `baseConflicts(doc)`
  detects sibling rebases from the same base to different targets.
- **`integrate.ts`** -- `attachIntegration(doc, {isRemoteOrigin,
  selfIsRebaser?})`: on each remote batch (via `crdt.onRemoteBatch`), for
  every rebase record this replica has not acked, flags textblocks changed
  both upstream and locally as `concurrent-edit`
  (`crdt.blockStatesAt` at the base/target/pre-batch snapshots), and
  resurrects (`crdt.resurrectBlock`) a block deleted upstream that still
  holds this replica's own edits (`crdt.blockHasOwnEditsSince`), flagged
  `deleted-upstream-edited-locally`. `ackOwnRebase(doc, rebaseId)`: for the
  replica that computed a rebase itself (S5-5) -- ack immediately, skipping
  the scan, since that replica's own local rebase() call is typically not a
  "remote origin" transaction in the first place and would never reach this
  hook's `isRemoteOrigin` check. `listReview`/`clearReview`.
- **`comments.ts`** -- comment store in the `comments` map:
  `createComment(doc, {from, to, body, author}) -> id` (offsets into
  `crdt.textProjection(doc)`), `createCommentOnQuote` (tests/tools, by
  quote text + occurrence), `reply`, `setResolved` (named to avoid clashing
  with crdt's anchor `resolveAnchor`), `listComments(doc)`. The anchor
  record and S2-9's fuzzy-match acceptance rule (`fuzzyAnchor`) are ported
  near-verbatim from spike 2 -- plain string code, already schema-agnostic;
  what changed is anchor creation/resolution now goes through crdt's
  `anchorAt`/`resolveAnchor` (opaque, base64-encoded `RelativePosition`s)
  instead of spike 2's own `Y.RelativePosition` plumbing.
- **`import.ts`** -- `importText(doc, {base, text, clientId?, author}) ->
  result`: parse, `forkDiffMerge`, register the peer as author kind
  `import`. The daemon's entry point later (gate J's reported-base save).
- **`renderForSave.ts`** (brief 07 task 4) -- `renderForSave(doc) -> {text,
  degraded}`: `crdt.render` plus review-flag bookkeeping. Every
  currently-degraded block (mapped from `crdt.render`'s top-level
  `degraded` indices to textblock ids via `crdt.textblockIdsAtTopLevel` --
  a degraded index can name a whole container, blockquote/list/table, with
  no blockId of its own) that has no existing `review` entry gets one with
  `reason: 'serialization-best-effort'` (never overwrites a DIFFERENT
  existing reason, e.g. `concurrent-edit`); every block previously flagged
  that way but no longer degraded has the entry removed. Used by
  `commit.ts`'s `prepareCommit` and the relay's draft flush
  (`relay/flush.ts`) instead of calling `crdt.render` directly, so a
  save's own best-effort blocks are always flagged, not just reported in
  the return value.
- **`commit.ts`** -- `markEditor(doc, user)` sets
  `editorsSinceCommit:<user>` = the current `phraise.commitSeq` (brief 09
  defect 1; was a plain boolean), written only if absent or smaller, so a
  user costs at most one map write per commit cycle plus one more if she
  edits again during a commit's own push window. `prepareCommit(doc) ->
  {text, degraded, snapshot, coAuthors, preparedSeq}` (render via
  `renderForSave`, snapshot taken in the same synchronous step -- nothing
  else can mutate `doc` in between, in a single-threaded runtime -- and
  `commitSeq` bumped, `preparedSeq` = its pre-bump value).
  `recordCommit(doc, {commit, snapshot, preparedSeq})` sets `base` to the
  new commit, sets `lastCommit`, and clears only `editorsSinceCommit`
  entries whose value is `<= preparedSeq` -- no re-seed (D1 as amended) --
  all inside `crdt.transactExtendingSnapshot(doc, opts.snapshot, fn)`
  (brief 09 defect 1's fix; see `crdt/README.md`'s note on it), then
  stores the RESULT under `snapshot:<commit>`.

  History: brief 06 fixed a real tie-break bug here by taking a wholly
  FRESH `snapshot(doc)` after these meta writes, instead of storing the
  `snapshot` this function is handed (`prepareCommit`'s, taken BEFORE the
  meta writes) -- a rebase forking from the OLD snapshot would see `base`'s
  PRE-commit value and its `onFork` override would race this function's
  own later write for the same `Y.Map` key, and Yjs's tie-break decided
  the winner non-deterministically, silently reverting the rebase's base
  pointer roughly half the time. That fix assumed "content does not change
  between `prepareCommit` and `recordCommit`" -- true when nothing else can
  touch `doc` in between, false at the relay, where `relay/commit.ts`
  `await`s a real git push between the two calls, during which a
  concurrent editor's real edit can land on the SAME shared `doc`. A fully
  fresh snapshot baked that not-yet-committed edit into what a later
  rebase treats as "the committed base", so the rebase saw no local change
  and silently dropped the edit, with no review flag (milestone-2 review
  log's blocker). `transactExtendingSnapshot` fixes both bugs together:
  the stored snapshot carries this function's OWN meta writes (fixing the
  tie-break) while its CONTENT stays exactly `opts.snapshot`'s -- the
  actual pre-push bytes, never anything that landed afterward (fixing the
  concurrent-edit bug).
- **`attribution.ts`** -- `listAttribution(doc)`: crdt's
  `listAttributedRanges` (keyed by connection user name) joined with
  `phraise-authors`' per-clientId `kind`, matched by name (logged
  interpretation: the brief does not spell out the join key since the two
  maps are keyed differently; a range whose user matches no known author's
  name reports kind `'unknown'`).
- **`types.ts`** -- `Author` ({name, email}; structurally identical to
  `src/git`'s `Identity` but declared independently -- engine must not
  import git), `Base`, `AuthorKind`/`AuthorEntry`, `RebaseRecord`,
  `ReviewEntry`.

## The `phraise`-family maps this module owns (plan section 4)

`phraise`: `docId`, `generation`, `base` = `{id, commit}`,
`snapshot:<baseId>` (base64), `rebase:<id>` (keyed by
`hash(baseId, target)`, the S2-11 fix), `ack:<rebaseId>:<clientId>`,
`lastCommit`, `commitSeq` (integer, brief 09 defect 1; bumped by
`prepareCommit`), `editorsSinceCommit:<user>` = the `commitSeq` value at
the time `user` was marked (was a plain boolean; one key per user either
way, so concurrent editors never clobber each other's `Y.Map` LWW register
the way a single shared array-valued key would -- the reason
`crdt.listMetaEntries` exists). `phraise-authors`: clientId -> `{kind,
name, email?, commit?}`.
`review`: blockId -> `{rebaseId, reason}`, `cleared:<blockId>`. `comments`:
commentId -> record (anchor pair, quote selectors, author, body, replies,
resolved).

## New crdt primitives this module's design required (brief 03 task 1)

Beyond what the brief names outright, two small additions to `src/crdt`
turned out to be necessary and are logged here (also in
`context/logs/2026-09-27-builder-spike-6-engine.md`):

- `crdt.listMetaEntries`/`crdt.deleteMeta`: engine must enumerate namespaced
  keys (`rebase:*`, `ack:*`, `editorsSinceCommit:*`) and delete some
  (`editorsSinceCommit:*` on commit) -- the plan's "small typed accessor"
  only covered single-key get/set.
- `crdt.blockHasOwnEditsSince`: `integrate.ts`'s resurrection rule ("only
  the author of the edits resurrects") needs to know whether a SPECIFIC
  replica's own edits are present in a block since a given base snapshot,
  which cannot be recovered from `blockStatesAt`'s opaque signature string.
- `forkDiffMerge` gained `forceFork` (not explicitly named in the brief; see
  `rebase.ts`'s own doc comment for why it is required, not optional, for
  correctness).
- `crdt.wouldPend` (spike 2's causal-delivery finding) and `crdt.onRemoteBatch`
  are used by `src/testkit/hub.ts`, not by this module directly, but are
  documented here too since they exist for this brief's test harness.

## Origin of copied code

`ids.ts` -- spike 2's `ids.ts` (collab-stack-yjs13-hocuspocus, branch
spike/2026-09-27-collab-stack, commit eeb3fe2, src/rebase/ids.ts, itself
spike 2's), generalized to variadic parts. `seed.ts` -- spike 2's
`seed.ts` (same location), rebuilt on this spike's crdt interface.
`rebase.ts` -- spike 2's `rebase.ts` (same location), rebuilt on
`forkDiffMerge`'s `onFork`/`forceFork` instead of spike 2's own hand-rolled
fork/diff/merge. `integrate.ts` -- spike 2's `integrate.ts` (same
location), rebuilt on `blockStatesAt`/`resurrectBlock`/
`blockHasOwnEditsSince` and the generic `onRemoteBatch` hook; S5-5's
`ackOwnRebase` behavior ported from spike 5's `src/relay.ts` rebase route.
`comments.ts` -- spike 2's `comments.ts` (same location); the
scoring/acceptance logic is copied close to verbatim (plain string code).
`attribution.ts` (engine) is new for this spike; `import.ts`/`commit.ts`
are new for this spike (no equivalent file existed in the four source
spikes in this shape -- spike 3's `DocSync.importText` and
`renderDetailed` are the nearest analogues, already split up in briefs
01-02 between `crdt/forkDiffMerge.ts` and `markdown/render.ts`).
