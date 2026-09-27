# src/relay

Brief 04. Hocuspocus 4.7 as a library (`startRelay(opts) -> RelayHandle`,
in-process), `cli.ts` for a child-process run. Auth stub, open-and-seed,
forged-identity rejection, per-update attribution, the draft flusher, and
commit. Milestone 2's head poller and rebase are not implemented here
(`POST /poll` exists as a documented stub; see plan section 6 and the
charter's gate F).

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
  gitStore})`: a no-op if `getBase(doc)` is already set (SQLite already
  restored this document); otherwise reads the draft ref -- if its `base`
  equals the current branch head and its sidecar's `docId`/`generation`
  match, restores from the sidecar's `.ydoc` bytes; otherwise seeds
  deterministically from the branch head's blob via
  `engine.seedFromCommit`. Deliberately does **not** record seed
  attribution (unlike spike 5's relay, which attributed seeded content to a
  `'seed'` pseudo-user): gate A requires the freshly seeded state to be
  byte-for-byte identical to an independent `engine.seedFromCommit` call
  with the same inputs, which any extra write here would break.
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
- **`commit.ts`** -- `POST /commit`: `engine.prepareCommit`,
  `git.commit` with `expectedHead` = the document's own `base.commit`,
  author = the user, co-authors = `editorsSinceCommit` minus the
  committer, `engine.recordCommit`, then `flushBranch` (which itself
  deletes the draft when its composed file set ends up empty, i.e.
  nothing is left uncommitted).
- **`http.ts`** -- the control API (below).
- **`server.ts`** -- `startRelay(opts) -> RelayHandle`: wires the Hocuspocus
  extension hooks (`onAuthenticate`, `onLoadDocument`/`afterLoadDocument`/
  `afterUnloadDocument`, `beforeSync`, `onChange`, `onRequest`) to the
  modules above.
- **`cli.ts`** -- child-process wrapper (`--port --dataDir --remote
  [--flushDebounceMs --flushMaxIntervalMs]`), prints `relay-ready ...` on
  stdout once listening (the harness waits for this line), flushes every
  open branch on `SIGTERM`/`SIGINT` before exiting.

## HTTP control API

All JSON except `/state/<docName>` (raw Yjs update bytes). Bound to
`127.0.0.1` only.

| Route | Purpose |
|---|---|
| `GET /health` | `{ok, documents, counters}`. |
| `GET /resolve?branch=&path=` | Opens the document (generation 0, milestone 1) if needed; returns `{docName, generation}`. |
| `POST /flush {branch}` | Flushes that branch's draft now; returns the flush outcome. |
| `POST /commit {branch, path, user, message?}` | Commits; `409 {ok:false, reason:'stale', actual}` on a lease rejection. |
| `GET /state/<docName>` | Raw `Y.encodeStateAsUpdate`, for tests that want to inspect a document without a WebSocket client. |
| `GET /markdown/<docName>` | `crdt.render`'s `{text, degraded, ...}`. |
| `POST /poll` | Stub: head polling + rebase land in a later brief (gate F); returns `{polled: [], note: ...}` rather than 404, since plan section 6 names the route. |
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

Only `type === SYNC_UPDATE` (2, an ordinary incremental update) is checked
strictly: a client id already mapped (in `phraise-attribution`) to a
*different* user, or already registered in `phraise-authors` as a
seed/git/import/generation peer, is rejected. `type === SYNC_STEP2` (1, a
client's full local state -- sent on first connect, or after this relay
lost its state and is seeing the reconnecting client's state for the first
time) is accepted without the "mapped to a different user" check: it
legitimately contains structs under other users' client ids this replica
already received directly from them at some point in the past, and
rejecting on that basis would make an ordinary reconnect-after-relay-loss
indistinguishable from an attack. This leaves a real, intentional gap -- a
forged `syncStep2` is not caught here -- documented as a residual in
`forgery.ts`'s header comment and the findings doc, not silently assumed
away. `type === SYNC_STEP1` (0, a bare state-vector query) is never a
forgery vector and is never checked.

`editorsSinceCommit` ("whose updates changed document content, not
comment-only or ack-only"): a `WeakMap<Document, string>` cache of
`JSON.stringify(read(document).toJSON())`, compared on each genuine
connection-origin `onChange` call. This also skips the relay's own internal
writes (attribution recording, draft-merge, commit bookkeeping) for free,
since none of those are connection-origin transactions. Simpler than a
per-update Yjs struct inspection; acceptable at milestone-1 sizes, flagged
as a cost to revisit at gate M's scale.

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
