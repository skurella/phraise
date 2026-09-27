# src/relay

Brief 04 (open-and-seed, forged-identity rejection, per-update attribution,
the draft flusher, commit) and brief 06 (milestone 2: the head poller,
rebase-on-commit, and the forgery fix that closes the milestone-1 review's
blocker). Hocuspocus 4.7 as a library (`startRelay(opts) -> RelayHandle`,
in-process), `cli.ts` for a child-process run.

The relay calls only `engine`, `git` and the opaque `crdt` handles it is
handed -- it never calls a Yjs API itself. A Hocuspocus `Document` (which
`extends Y.Doc`) IS the `CrdtDoc` every `engine`/`crdt` function expects, so
it is passed straight through; nothing here imports `yjs`, `y-protocols` or
`@tiptap/y-tiptap` (enforced by `test/import-boundary.test.ts`'s dedicated
check for this directory, added by this brief). It may import
`@hocuspocus/server` and `@hocuspocus/extension-sqlite` only.

## Modules

- **`docName.ts`** -- `<branch>:g<generation>:<path>` naming, and `docId`
  (`<branch>:<path>`, stable across generations -- the input to every
  seed/rebase peer hash).
- **`identity.ts`** -- `identityFor(user) -> {name: user, email:
  "<user>@users.phraise.test"}` (plan section 5's stub).
- **`forgery.ts`** -- forged-identity rejection (plan section 6, gate B).
  See "Which Hocuspocus hook, and why" below.
- **`seeding.ts`** -- `seedOrRestore(doc, {branch, path, generation,
  gitStore})`: returns `{kind:'already-open'}` (a no-op) if `getBase(doc)`
  is already set (SQLite already restored this document -- distinguished
  from `'seeded'`/`'restored'` specifically so the recovery window below
  only opens on a GENUINE fresh load, not on this idempotent re-check).
  Otherwise reads the draft ref: if a matching sidecar (`docId`/`generation`
  agree) exists, restores from its `.ydoc` bytes -- **brief 06 task 4**:
  unconditionally, even when the draft's `base` is behind the current
  branch head, in which case `rebaseHead.ts`'s `rebaseToHead` runs
  immediately afterward, in the same open, so the draft is never silently
  dropped in favor of a fresh reseed. With no matching draft, seeds
  deterministically from the branch head's blob via
  `engine.seedFromCommit`. Deliberately does **not** record seed
  attribution (unlike spike 5's relay, which attributed seeded content to a
  `'seed'` pseudo-user): gate A requires the freshly seeded state to be
  byte-for-byte identical to an independent `engine.seedFromCommit` call
  with the same inputs, which any extra write here would break.
- **`rebaseHead.ts`** (brief 06) -- `rebaseToHead({gitStore, doc, docId,
  path, head})`: reads `path` at `head` plus `head`'s commit info,
  `engine.rebase`s `doc` to it (author = the head commit's git author),
  and, if applied, `engine.ackOwnRebase`s the result immediately (S5-5).
  The one rebase-to-head primitive shared by `seeding.ts`'s
  restore-behind-head path, `poller.ts`'s per-branch pass, and
  `commit.ts`'s post-head-move path -- so "the git author from
  `commitInfo` as the rebase author, then `ackOwnRebase`" is written
  exactly once.
- **`poller.ts`** (brief 06 task 2) -- `HeadPoller`: one `setInterval`
  timer per branch, started the moment a document of that branch first
  loads (`ensureBranch`, idempotent) and stopped in `relay.stop()`; never
  polls a branch with no open documents. Each tick (or `POST /poll`, which
  calls `pollAll()` -- every branch with an open document, right now)
  compares `remoteHead` against the branch's own `lastPolledHead`; on a
  change, fetches once and calls `rebaseToHead` for every open document of
  that branch, serialized through the branch's own `state.queue` (the same
  queue flush/commit already use, so a poll never races them). A document
  whose own file did not change in the commit that moved the head is still
  rebased (a no-op diff, but a real rebase record advancing its base
  pointer) -- `rebaseToHead`/`engine.rebase` handle this uniformly; the
  poller does not special-case it. Counters: `rebasesApplied`,
  `lastRebaseDurationMs` (wall-clock time of the most recent per-branch
  rebase pass across every open document of that branch).
- **`state.ts`**/**`keyedQueue.ts`** -- `RelayState`: the registry of
  currently-open documents per branch (so the flusher can enumerate "every
  open document of the branch"), per-branch draft bookkeeping (the lease
  value, and the previous draft's files/sidecar for carry-over), counters
  the gates read back (`GET /health`), and a per-BRANCH `KeyedQueue` --
  logged as a deviation from the brief's literal "serialized per document"
  (a superset: a draft flush is inherently branch-scoped, one ref per
  branch, covering every open document of it at once; see
  `keyedQueue.ts`'s own header comment).
- **`flush.ts`**/**`debounce.ts`** -- the draft flush (plan sections 5-6):
  builds `files`/`sidecar` from every open document plus carried-over
  entries for documents not currently open, writes under
  `--force-with-lease`; on a lease rejection, fetches the remote draft and,
  for every open document whose remote sidecar entry names the SAME
  `docId`/`generation`, merges its CRDT state in (`applyUpdate`, a safe
  Yjs-level union) and retries once; any document with a
  mismatched/missing remote sidecar entry is reported as a conflict without
  overwriting. `TrailingDebounce`: per-branch trailing debounce plus a
  maximum interval, plus `flushNow()` for `POST /flush`.
- **`commit.ts`** -- `POST /commit`: a bounded retry loop (brief 06 task 3,
  `MAX_ATTEMPTS = 3`). Each attempt: compares `remoteHead` against the
  document's own base; if it moved, `rebaseHead.ts`'s `rebaseToHead` runs
  first (this is what makes "a commit attempted after the head moved
  rebases first and then succeeds" -- charter gate F's last bullet -- true
  regardless of whether the background poller has ticked yet). Then
  `engine.prepareCommit`, `git.commit` with `expectedHead` = the
  (possibly just-rebased) base commit, author = the user, co-authors =
  `editorsSinceCommit` minus the committer. On success: `engine.recordCommit`,
  then `flushBranch` (which itself deletes the draft when its composed
  file set ends up empty). On a lease rejection (someone else's push
  landed in the narrow window between the head check and this push): loop
  around -- the next attempt's own `remoteHead` check picks up exactly
  that new commit and rebases onto it. After `MAX_ATTEMPTS` rejected
  pushes: `409 {ok:false, reason:'stale', actual}`. The result's own
  `rebased` boolean says whether any attempt had to rebase, so a caller (or
  gate) can tell "committed cleanly" apart from "committed after
  absorbing an external commit" without re-deriving it.
- **`http.ts`** -- the control API (below).
- **`server.ts`** -- `startRelay(opts) -> RelayHandle`: wires the Hocuspocus
  extension hooks (`onAuthenticate`, `onLoadDocument`/`afterLoadDocument`/
  `afterUnloadDocument`, `beforeSync`, `onChange`, `onRequest`) to the
  modules above.
- **`cli.ts`** -- child-process wrapper (`--port --dataDir --remote
  [--flushDebounceMs --flushMaxIntervalMs]`; brief 06 adds `[--pollMs
  --recoveryWindowMs]`), prints `relay-ready ...` on stdout once listening
  (the harness waits for this line), flushes every open branch on
  `SIGTERM`/`SIGINT` before exiting.

## Options (`RelayOptions.timings`, all optional)

| Option | Default | Purpose |
|---|---|---|
| `flushDebounceMs` | 2000 | Draft flusher's trailing debounce. |
| `flushMaxIntervalMs` | 60000 | Draft flusher's maximum interval under continuous edits. |
| `pollMs` (brief 06) | 1000 | Head poller's per-branch interval; gates use 100-250ms, and a relay that only ever wants on-demand polling (e.g. a gate testing the commit route's OWN rebase-first logic in isolation, not racing a background tick) can set this very large. |
| `recoveryWindowMs` (brief 06) | 60000 | How long a document's recovery window (see the forgery section below) stays open after it is freshly seeded or restored from having no local base. |

## HTTP control API

All JSON except `/state/<docName>` (raw Yjs update bytes). Bound to
`127.0.0.1` only.

| Route | Purpose |
|---|---|
| `GET /health` | `{ok, documents, counters}` (see `state.ts`'s `RelayCounters` for the full list: `forgedRejections`, `relayedDuringRecovery`, `staleFlushes`, `mergedFlushRetries`, `flushConflicts`, `staleCommits`, `rebasesApplied`, `lastRebaseDurationMs`, `commitRebaseRetries`). |
| `GET /resolve?branch=&path=` | Opens the document (generation 0, milestone 1) if needed; returns `{docName, generation}`. |
| `POST /flush {branch}` | Flushes that branch's draft now; returns the flush outcome. |
| `POST /commit {branch, path, user, message?}` | Commits, rebasing first if the head moved (see `commit.ts` above); `409 {ok:false, reason:'stale', actual}` after `MAX_ATTEMPTS` rejected pushes. |
| `GET /state/<docName>` | Raw `Y.encodeStateAsUpdate`, for tests that want to inspect a document without a WebSocket client. |
| `GET /markdown/<docName>` | `crdt.render`'s `{text, degraded, ...}`. |
| `POST /poll` (brief 06 task 2) | Polls every branch with at least one open document, right now (`HeadPoller.pollAll()`); returns `{polled: PollBranchResult[]}` (`{branch, moved, head, rebasedPaths}` per branch). |
| `GET /connections?docName=` | Test/gate-only introspection (not in plan section 6's list): `document.getConnectionsCount()`, added because gate B needs an externally-observable, timing-reliable signal that a rejected forger's connection was actually removed (see `forgery.ts` note below). |

## Which Hocuspocus hook, and why (forged-identity rejection, gate B)

Found by reading `node_modules/@hocuspocus/server`'s own source
(`packages/server/src/MessageReceiver.ts`'s `readSyncMessage`):
`beforeSync(connection, {type, payload})` runs synchronously *before* the
`syncStep1`/`syncStep2`/`update` switch that would call `y-protocols/sync`'s
`readSyncStep2`/`readUpdate` (the calls that mutate the document and queue
a broadcast), and `payload` is already `message.peekVarUint8Array()` -- a
non-consuming peek of the raw Yjs bytes, so this hook needs no protocol
parsing of its own. Throwing inside it propagates through
`MessageReceiver.apply` into `Connection.processMessages`'s own try/catch,
which closes the connection and drops the rest of that connection's queued
messages -- one exception gives "not applied" (the switch branch never
runs), "not broadcast" (nothing was ever written, so there is nothing to
broadcast), and "connection closed", together.

`beforeHandleMessage` was the other candidate: it only hands over the
entire still-undecoded framed message (document name + everything), so
using it would mean re-implementing `readSyncMessage`'s own parsing here
just to get at the same bytes `beforeSync` already provides pre-decoded.

**Brief 06 task 1 (closes the milestone-1 review's blocker):** the
milestone-1 version of this file only ran the identity check for
`type === SYNC_UPDATE` (2), reasoning that `SYNC_STEP2` (1, a client's full
local state) legitimately contains structs under other users' client ids
after this relay lost its state. The review
(`context/logs/2026-09-27-reviewer-spike-6-m1.md`) found the live bypass
this opens: `@hocuspocus/server`/`y-protocols/sync` route `SYNC_STEP2` and
`SYNC_UPDATE` through the exact same `Y.applyUpdate` + broadcast path
(`readUpdate` IS `readSyncStep2`), and nothing stops an already-
authenticated connection from sending a `SYNC_STEP2`-tagged message at any
time, not just as a first message -- so a forger only had to lie about the
message type to bypass the whole check.

Fixed: `checkForgery` now runs the SAME per-client-range check for both
`SYNC_STEP2` and `SYNC_UPDATE` (`SYNC_STEP1`, a bare state-vector query
with no structs, is still never a forgery vector). A range whose client id
is already mapped to a *different* user, or already registered as a
seed/git/import/generation peer, is a forgery **unless**:
1. **the relay already holds every clock in that range**
   (`crdt.knownClock(doc, clientId) >= range.to`): applying it again would
   be a genuine Yjs no-op (it introduces nothing new), so it is harmless
   regardless of who is replaying it or why. This is what makes an honest
   reconnect's `SYNC_STEP2` (full local state, including other users'
   structs this replica already has) pass without needing the message type
   at all -- and it is exactly what a forged, genuinely NEW range fails,
   whichever type it is tagged as.
2. **the document is in a recovery window**
   (`RelayState.markRecoveryWindow`/`inRecoveryWindow`, keyed by document
   name, default 60s, `recoveryWindowMs`): opened whenever a document is
   freshly seeded or restored because this relay process had no local base
   for it (first-ever open, or local state lost -- `seeding.ts`'s
   `'seeded'`/`'restored'` results, never its idempotent `'already-open'`
   one). During the window, a range that fails escape 1 (truly new data
   under someone else's mapped id) is still accepted -- not re-attributed,
   counted separately (`relayedDuringRecovery`, never `forgedRejections`)
   -- because a client reconnecting while the relay has no memory of a
   document legitimately carries other users' structs that are NEW to this
   fresh relay state; rejecting those would make an ordinary
   reconnect-after-relay-restart indistinguishable from an attack. This is
   the file's one remaining, intentional, TIME-BOUNDED residual: a forgery
   timed to land inside the same 60s window, against the same freshly
   (re)loaded document, is not caught here. `test/relay.forgery.test.ts`
   has a dedicated test for exactly this acceptance path, and gate B
   extends its own attack with the reviewer's own technique (a raw,
   hand-built `SyncStep2` wire message over a fresh connection, carrying a
   genuine clock CONTINUATION of the victim's id cloned from her own
   current state -- not a colliding brand-new-`Y.Doc` range at clock 0,
   which Yjs's own dedup silently no-ops before this file's check ever
   runs and would make the test meaningless either way).

`editorsSinceCommit` ("whose updates changed document content, not
comment-only or ack-only"): brief 09 defect 1 replaced the original
`WeakMap<Document, string>` cache of `JSON.stringify(read(document).toJSON())`
(compared on each genuine connection-origin `onChange` call -- an O(document
size) full decode+serialize per keystroke, exactly the cost this README used
to flag "as a cost to revisit at gate M's scale") with `crdt.onContentChange`
(`src/crdt/onContentChange.ts`): a listener registered directly on the Yjs
`Doc`'s native `'update'` event (which carries the `Y.Transaction`, unlike
Hocuspocus's own `onChangePayload`), computing "did this transaction touch
the `prosemirror` fragment or anything under it" by walking each changed
type's `_item.parent` chain to the root -- no document read at all. The
result is stashed in a `WeakMap<object, boolean>` keyed by the exact
`transactionOrigin` object reference (a fresh object per inbound message,
per `@hocuspocus/server`'s own `MessageReceiver.ts`), which `onChange` reads
back for that same update; race-freedom (the write always happens before the
read, regardless of what any OTHER extension's hook awaits in between) is
argued from Hocuspocus's own hook dispatch (`hooks()` always defers even the
FIRST extension's call to a microtask via `Promise.resolve().then(...)`) --
see `onContentChange.ts`'s header comment for the full argument. This still
skips the relay's own internal writes (attribution recording, draft-merge,
commit bookkeeping) for free, since none of those are connection-origin
transactions and `onChange` only acts on `isConnectionOrigin(transactionOrigin)`.

`markEditor`/`editorsSinceCommit` also gained a sequence number
(`phraise.commitSeq`, brief 09 defect 1) instead of a plain boolean: see
`engine/README.md`'s note on `recordCommit` for why -- a concurrent edit
landing during a commit's own git push (the async gap in
`commitDocument` between `prepareCommit` and `gitStore.commit`) must not be
silently folded into that commit's stored base snapshot, and must keep its
author's co-author credit for the NEXT commit. `commit.ts`'s
`commitDocument` also gained an optional `testHooks.afterPrepareCommit`
(awaited in exactly that gap), test-only, for
`test/relay.commit-concurrent-during-push.test.ts`.

## Origin of copied code

Nothing here is a direct line-for-line port: spike 5's `src/relay.ts`
(collab-stack-yjs13-hocuspocus, branch spike/2026-09-27-collab-stack,
commit eeb3fe2) seeds from files and runs spike 2's rebase on request, with
no git/drafts/commit concept at all (this spike's git layer, drafts and
commit mechanics are new, per plan sections 5-6); its `onRequest`
neutering-the-default-response technique and general "HTTP control API
alongside the WebSocket server" shape are reused (see `http.ts`'s own
header comment). `identity.ts`'s stub and `docName.ts`'s naming scheme are
new for this spike (plan sections 5-6, stated directly rather than derived
from an earlier spike).
