Status: done
Author: reviewer (Sonnet 5)
Updated: 2026-09-27
Plan: [spike 6 plan](../plans/2026-09-27-spike-6-plan.md)
Brief: [brief 08](../plans/2026-09-27-spike-6-brief-08-review-m2.md)

Timezone: local machine time (CEST), from `date`.

## 20:33 -- task received

Read AGENTS.md, brief 08, the charter's "Rules for every agent" section, briefs 06/07, and the milestone-1 review log (gate B forgery blocker, now addressed per brief 06). Read the builder logs for the rebase brief and the serializer brief.

## Task 1: fresh clone

`git clone --branch spike/2026-09-27-integration-engine <worktree> /tmp/spike6-m2-review-clone`. `npm ci` clean (257 packages). `npm run fetch`: 266 corpus files + 655/672 spec examples. `npm test`: **69/69 tests pass, 22 files**. `npm run typecheck`: clean. `npm run gates:quick`: **A-G all PASS; gate H FAILS** (`concurrent-formatting check: ... 1/21 with a mark boundary on a space ... produced &#...`), exit code 1. This matches exactly the pre-existing, already-known issue the brief names (charter's orchestrator amendment: gate H's space-boundary count, "will be fixed separately") -- confirmed by `git log` showing commit `c7c9fcc` ("gate H counts formatting cases with a mark boundary on a space") as the tip, i.e. this is the known state, not a new regression. **Reporting it as failing per the rules regardless**: `npm run gates:quick` currently exits 1.

## Task 2: mutation testing (all in the temp clone, reverted after each)

| # | Mutation | Gate/test | Result |
|---|---|---|---|
| 1 | Forgery: restore old `if (type !== SYNC_UPDATE) return` exemption | gate B | **Caught.** Reviewer's SyncStep2 attack goes through again: `forgedRejections` doesn't increment, relay unaffected check fails. |
| 2 | Skip `ackOwnRebase` in `rebaseHead.ts` | gate F | **Caught.** Own rebase record never acked -> the "exactly BothEdited flagged" check fails (an extra block gets spuriously flagged `concurrent-edit`, since the un-acked record is later processed with a meaningless "before" state). |
| 3 | `integrate.ts`: force `upstreamChanged && localChanged` to never fire | gate F | **Caught.** "exactly the BothEdited block is flagged" check fails with an empty flag list. |
| 4 | `integrate.ts`: force resurrection condition false (drop resurrection) | gate G | **Caught.** Times out (`waitUntil` never converges) waiting for bob's deleted-and-locally-edited token to reappear -- ports stayed clean after. |
| 5 | `commit.ts`: skip the rebase-first step before pushing | gate F | **Caught.** "commit attempted right after the head moved again... rebases first and succeeds" check fails; commit returns `{ok:false, reason:'stale'}` instead. |
| 6 | `parse.ts`: revert `buildDefsContextFromDoc` to use `node.textContent` instead of `node.attrs.src` | `test/serializer-fixes.test.ts` | **Caught.** Both footnote-continuation regression tests fail (fenced re-serialization instead of verbatim). |

All 6 mutations restored; `diff` against originals confirmed clean before moving on.

## Task 3: correctness review

### BLOCKER -- `recordCommit`'s post-await fresh snapshot silently discards a concurrent editor's edit on the next rebase, with no review flag

`src/engine/commit.ts`'s `recordCommit` (the brief-06 fix for the base-pointer tie-break bug) takes `snapshot(doc)` **fresh, after its own meta writes**, instead of storing `prepareCommit`'s snapshot (taken before the commit's git push). `src/relay/commit.ts`'s `commitDocument` calls `prepareCommit(doc)`, then `await gitStore.commit(...)` (a real async git push -- several subprocess round trips), and only then `recordCommit(doc, ...)`. During that await, any other already-connected live editor's real Yjs update lands directly on the same shared `doc` (exactly what the relay's `onChange` hook processes for any other connection) -- `recordCommit`'s comment explicitly claims "the document's actual CONTENT ... does not change between prepareCommit and recordCommit (this function never touches it)"; this is false whenever a concurrent editor is present during the git push's latency window.

Reproduced directly at the engine level (`prepareCommit` -> simulate a concurrent editor's edit via `importText` on the same `doc`, exactly as the relay's `onChange` would apply it -> `recordCommit`, mirroring the exact call sequence `relay/commit.ts` uses):
- The git push's own content (`prepared.text`) never contained the concurrent edit (as expected -- it was rendered before the edit landed).
- `editorsSinceCommit` was cleared for the concurrent editor even though her edit was never actually part of the commit that clears it -- silent loss of co-author attribution.
- **The real damage**: a later external commit that touches the SAME block the concurrent editor edited triggers a rebase (`engine.rebase`) that **silently discards her edit entirely** -- final doc content shows only the upstream fix, not her token -- **and `listReview()` shows no flag at all**. This is because `recordCommit`'s fresh snapshot baked her not-yet-committed edit into what future rebases treat as "the base" (`snapshot:<commit>`), so the algorithm sees `localChanged = false` (live doc == "base") for that block and treats the external commit's change as a safe take-upstream overwrite rather than a concurrent edit needing to preserve/flag.

This directly violates D6 ("one mechanism; never silently loses data; needs-review flags") and is exactly the kind of gap gates F/G's own scenarios don't exercise (their live-typing bursts and offline-editor windows are timed around rebase/poll, not around a commit's own git-push latency). The fix that closed the tie-break bug (taking a fresh post-meta-write snapshot) reintroduced this content-fidelity bug; a correct fix needs to decouple "which bytes are the committed content" (must stay `prepared.snapshot`, taken synchronously with what was actually pushed) from "meta-write ordering" (needed to avoid the tie-break race) -- e.g. detect whether `doc`'s content changed between `prepareCommit` and the push's resolution (compare state vectors) and route any edit that arrived in that window through the same concurrent-edit-flagging path integration already has, rather than silently folding it into the anchor.

File: `src/engine/commit.ts:98-106` (`recordCommit`), `src/relay/commit.ts:57-75` (the await gap this exploits).

### Watch / minor items

- **Forgery recovery window**: confirmed by reading `server.ts`/`seeding.ts`/`state.ts` that a client cannot cheaply re-trigger a recovery window on a live document -- `seedOrRestore` only opens one when `getBase(doc) === undefined` on the freshly-loaded in-memory `Document`, and the SQLite extension (ordered before the relay's own hook in `extensions: [...]`) already hydrates persisted `base` before that check runs, so an ordinary unload/reload cycle never reopens the window; only genuine state loss (draft restore or first-ever seed) does. The documented residual (forgery timed inside another user's first 60s window on the same fresh document) is real but exactly as scoped/documented in `forgery.ts`'s header comment -- not a new finding.
- **Poller/commit/flush races**: all three go through the same per-branch `KeyedQueue` (`state.queue`), which is a genuine serialized promise chain (verified by reading `keyedQueue.ts`) -- "commit + poll-triggered rebase on the same doc", "two heads in quick succession", "rebase while a flush is in flight" are all correctly serialized. One gap: `onLoadDocument`'s `seedOrRestore` (including its own restore-then-rebase call) runs **outside** `state.queue`, but this is safe in practice because the poller only iterates `branchState.open`, which the loading document isn't part of until `state.register` runs after `seedOrRestore` returns -- no other in-flight operation can reach the same `doc` object before it's registered.
- **Commit retry loop** (`commit.ts` `MAX_ATTEMPTS = 3`): correctly re-checks `remoteHead` and rebases on every attempt, including after a lease rejection; gives up cleanly with `409`/`stale` after 3 pushes. Not exercised: `remoteHead()` returning `null` mid-loop (transient network blip) -- falls through to committing against the stale base without rebasing; likely rare/low-impact, not chased further given the recordCommit finding above is more consequential.
- **Look-ahead to milestones 3-4**: the milestone-1 review's "repeated whole-document block walks" concern (`blockStatesAt` called 3x per pending rebase record, `O(pending records x blocks-ever-created)`) is now triggered automatically on **every** poll tick that observes a moved head, for **every** open document of the branch, serialized through one queue -- with many open documents on one branch (milestone 3's daemon) this could make one slow poll tick block commits/flushes on the whole branch for its duration. Worth measuring in gate M rather than assuming it stays small. The recordCommit finding above should be fixed before milestone 3's fuzz (300 trials mixing editors/saves/commits/restarts) makes it much harder to isolate -- a fuzz failure showing "content silently missing after a commit+rebase interleaving" will otherwise be very expensive to root-cause blind.

## 20:45 -- cleanup and handback

Reverted/removed all scratch files from the temp clone before finishing (verified via `diff` against originals; no mutation left applied). `lsof -nP -iTCP:4300-4399 -sTCP:LISTEN` empty. Removing `/tmp/spike6-m2-review-clone` after this log is written. No files in the worktree touched other than this log.
