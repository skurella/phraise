Status: in progress
Author: builder (Sonnet 5)
Updated: 2026-09-27
Plan: [spike 6 plan](../plans/2026-09-27-spike-6-plan.md), sections 3-6.
Brief: [brief 09](../plans/2026-09-27-spike-6-brief-09-fixes-m2.md)

Timezone: local machine time (CEST), from `date`.

## 20:48 -- task received

Read AGENTS.md, brief 09, charter's "Rules for every agent in this spike", plan sections 3-6, and the milestone-2 review log (`2026-09-27-reviewer-spike-6-m2.md`) naming the blocker: `src/engine/commit.ts`'s `recordCommit` takes a fresh snapshot after its own meta writes, so a concurrent editor's edit during the git push await window gets silently baked into the stored base snapshot -- losing co-author credit and, worse, causing a later rebase to silently drop the edit with no review flag.

Also reviewing: gate H space-boundary numeric-character-reference bug in mark nesting (`markdown/render.ts` or serialize), and relay attribution map growth (`src/relay/server.ts`'s `recordAttribution` / `src/crdt/attribution.ts`).

## 21:08 -- defect 1 fixed and unit-tested

Design (matches the brief exactly): `src/crdt/snapshotExtend.ts` (new) exports `transactExtendingSnapshot(doc, baseSnapshot, fn, origin)`: runs `fn` in one `doc.transact`, captures that transaction object, and returns `baseSnapshot` extended by the transaction's own `afterState` (only `doc.clientID`'s clock, per the brief -- meta writes are always local) merged with `Y.mergeDeleteSets([base.ds, transaction.deleteSet])` (deletions CAN be of another client's item, e.g. overwriting a rebase fork's own `base` write, so the full delete set is carried, not just the local client's). Verified nested `doc.transact` calls (what `setMeta`/`deleteMeta` do internally) reuse the SAME transaction (read `node_modules/yjs/src/utils/Transaction.js`'s `transact()`: `doc._transaction === null` gate), so `recordCommit`'s `fn` can freely call the ordinary crdt accessors.

`src/engine/commit.ts`: `editorsSinceCommit:<user>` is now `phraise.commitSeq` at write time (was boolean). `prepareCommit` bumps `commitSeq` and returns `preparedSeq` (the pre-bump value). `markEditor` writes only if absent or smaller (idempotent within a cycle). `recordCommit(doc, {commit, snapshot, preparedSeq})` uses `transactExtendingSnapshot(doc, opts.snapshot, fn)` for the meta writes (base, lastCommit, deleting only editor keys `<= preparedSeq`), then stores the extended result under `snapshot:<commit>`.

`src/relay/commit.ts`: threads `preparedSeq` through; added `CommitTestHooks.afterPrepareCommit` (awaited between `prepareCommit` and the git push) for the relay-level test. Threaded through `relay/http.ts`'s `handleHttpRequest` and `relay/server.ts`'s `RelayOptions.testHooks` / `testkit/relayHarness.ts`.

Cheap content detection: `src/crdt/onContentChange.ts` (new) exports `onContentChange(doc, fn(origin, changed))`, listening directly on the Yjs `Doc`'s native `'update'` event (carries the `Transaction`, unlike Hocuspocus's `onChangePayload`) and `transactionChangedContent` (walks `transaction.changed`'s keys' `_item.parent` chain up to the `prosemirror` fragment -- no document serialization). `relay/server.ts` registers it per-document in `onLoadDocument`, storing `changed` in a `WeakMap` keyed by the exact `transactionOrigin` object reference; `onChange` reads it back. Verified race-freedom by reading Hocuspocus 4.7 source directly (`@hocuspocus/server/src/Hocuspocus.ts`'s `hooks()`: `let chain = Promise.resolve(); chain = chain.then(() => extension.onChange(payload))` -- always defers even the FIRST extension to a microtask, so the synchronous `onContentChange` listener registered on the same `doc.emit('update', ...)` call always writes before any `onChange` body reads) and confirming each inbound message gets a FRESH origin object literal (`@hocuspocus/server/src/MessageReceiver.ts`: `{ source: 'connection', connection }` constructed per message, not per connection). This removes the old `contentKey`/`contentCache` (`JSON.stringify(read(document).toJSON())` per update).

Tests: `test/crdt-snapshot-extend.test.ts` (2 tests, crdt-level, uses `yjs` directly per test/import-boundary.test.ts's own scope of `src/**` only) and `test/engine.commit-concurrent-during-push.test.ts` (2 tests: the concurrent-edit-during-push scenario with rebase+flag+co-author-credit check, and the tie-break scenario x50). Verified BOTH new engine-level tests fail on the pre-fix `commit.ts` (temporarily restored `git show HEAD:.../commit.ts`, ran, saw `expected [] to deeply equal ['bob']`, restored the fix) -- confirms failing-first per the brief. Updated `test/engine.commit.test.ts`'s existing `recordCommit` call site for the new `preparedSeq` field.

All defect-1 tests green: `npx vitest run test/crdt-snapshot-extend.test.ts test/engine.commit-concurrent-during-push.test.ts test/engine.commit.test.ts` -> 7/7 pass.

## 21:11 -- defect 1 relay-level test done

`test/relay.commit-concurrent-during-push.test.ts`: real relay + two live jsdom editors (alice, bob) + real git remote. `testHooks.afterPrepareCommit` makes bob insert text into the Beta paragraph and waits (via the relay's own in-process `state`) for it to land on the shared doc before the hook resolves, guaranteeing it lands between `prepareCommit` and the push. Verified: (1) the committed blob excludes bob's token; (2) `editorsSinceCommit` still lists bob after the commit; (3) an external clone pushes a commit rewriting the SAME paragraph; (4) `POST /poll` triggers the rebase; bob's edit survives (checked directly on the relay's own doc, immediate) and the block gets flagged `concurrent-edit` (checked with a `waitUntil` -- this flag is written by alice/bob's OWN live-editor replicas, which treat the relayed rebase as remote and scan it, per S5-5's relay-side `ackOwnRebase`; it round-trips back to the relay over the real WebSocket, so needed a wait, not an immediate check -- first attempt without the wait failed correctly, confirming the round trip is real); (5) a second commit contains bob's token and a `Co-authored-by: bob` trailer. Verified failing pre-fix the same way as the engine-level test (swapped `commit.ts` back to `git show HEAD:...`, got `expected [] to deeply equal ['bob']`, restored).

Defect 1 fully done: fix + 4 test files (crdt-level unit test, engine-level scenario + 50x tie-break repeat, relay-level end-to-end), all verified failing before / passing after.

## 21:11 -- starting defect 2 (mark-nesting numeric character reference, gate H)

Root cause confirmed in `src/markdown/serialize.ts`'s `pmInlineToMdast`: newly-opened marks at a position were nested in ProseMirror's own mark (schema) order, regardless of which mark's run actually extended further. A narrower mark landing OUTSIDE a wider one forces the wider one to close/reopen when the narrower one's run ends, and the reopened continuation can start exactly on a space -- CommonMark can only express that with `&#x20;` etc.

Fix: added `runExtentFrom(nodes, idx, m)` (how far `m`'s own contiguous run extends forward from `idx`; factored out of the existing intraword `forceStar` check, which computed the identical thing inline) and, at the point `pmInlineToMdast` decides which marks to newly open, sort them by DESCENDING extent (ties keep schema order) before opening -- the furthest-extending mark becomes outermost and stays open, unsplit, across a shorter nested mark's whole lifetime.

Verified: existing `test/serializer-fixes.test.ts` (11 tests) and `test/markdown-roundtrip.test.ts` still pass unchanged (no regression). Removed the space-boundary `continue` skip in the 200-seed concurrent-formatting test and bumped it to 500 seeds per the brief -- passes, 0/500 entities including space boundaries. `npx tsx gates/h.ts --quick`: all 12 checks pass now (was failing on `1/21 with a mark boundary on a space`; now `0/21`). Updated `src/markdown/README.md`'s residual note: replaced the "known residual, not fixed" paragraph with a 4th numbered fix describing the nesting-order change, stating no known residual remains.

## 21:14 -- starting defect 3 (relay attribution map growth)

Fix in `src/crdt/attribution.ts`'s `recordAttribution`: when the new `[fromClock, toClock, at]` is contiguous with the client's LAST stored range (`last[1] === fromClock`, guaranteed same-client since `ranges` is already keyed per client id) and within `coalesceBucketMs` (new optional 5th param, default 5000) of that range's own `at`, extend it in place (`entry.ranges[last] = [last[0], toClock, at]`, `at` updated to the newest) instead of appending. Kept `listAttributedRanges` unchanged -- coalescing only helps it (a typing burst that used to fragment into N tiny same-user runs, since each used to carry a slightly different `at` from its own `Date.now()`, now naturally merges into one).

Test `test/crdt-attribution-coalesce.test.ts` (3 tests): measured 2,000 single-character updates from one client, WITH the fix vs a naive always-append reimplementation kept only in the test (for the "without" comparison the brief asks for): **naive encoded size 33,814,899 bytes vs coalesced 77,994 bytes (433.6x smaller)**, ranges array 2000 -> <=2 entries. A second test does the same measurement through a real prosemirror-shaped document (not a bare `Y.Text`) so `listAttributedRanges`'s own walk has something to find, confirming the reported text/user is unchanged in meaning. A third test confirms NO coalescing across the bucket boundary (10s gap with a 5s bucket stays 2 separate ranges). Verified failing pre-fix (`git show HEAD:.../attribution.ts`, ranges.length 2000/20 instead of <=2, restored the fix afterward).

Defect 3 done.

## 21:16 -- README updates and full verification pass

Updated `src/crdt/README.md` (new `transactExtendingSnapshot`/`onContentChange` section, `recordAttribution` coalescing note), `src/engine/README.md` (`commit.ts` entry rewritten: `commitSeq`/`preparedSeq`, the tie-break-bug-vs-concurrent-edit-bug history, the `phraise` map table row), `src/relay/README.md` (`editorsSinceCommit` section rewritten for `onContentChange`, new `CommitTestHooks` note), `src/markdown/README.md` (residual note replaced, see 21:11 entry), `src/testkit/README.md` (`relayHarness.ts`'s `testHooks` field).

## 21:19 -- full verification (task 5)

- `npm run typecheck`: clean, no errors.
- `npm test`: **26 test files, 77 tests, all pass** (up from the reviewer's confirmed 22 files/69 tests -- 4 new files, 8 new tests, plus 2 tests updated in place: `test/engine.commit.test.ts`'s `recordCommit` call site, `test/serializer-fixes.test.ts`'s 200->500-seed check with the space-boundary skip removed).
- `npm run gates:quick`: **A-H all PASS** (was: A-G pass, H fail per the review log). Numbers: gate H `formattingEntities: 0, formattingSpaceBoundaryEntities: 0` (was `1/21` on the space-boundary count). Did not run the full `npm run gates` (brief: "long verification runs belong to the orchestrator; a builder is done when the quick subset passes").
- `lsof -nP -iTCP:4300-4399 -sTCP:LISTEN`: empty, both before and after every run (gates:quick's own runner also reports "No ports still listening in 4300-4399").
- Nothing weakened: gate H's own checks are unchanged (I did not touch `gates/h.ts`); the unit test's seed count went UP (200 -> 500) and a skip was REMOVED, not added.

## 21:19 -- handback

All three defects fixed, each with a test verified failing before the fix and passing after (commit.ts/attribution.ts/serializer.ts were each temporarily reverted to `git show HEAD:...`, the new test(s) re-run to confirm failure, then restored -- diffed against the fixed version to confirm exact restoration). Full suite green. No files touched outside the spike package plus this log. Stopping per brief's task list (task 5 done); not committing per brief's constraint.
