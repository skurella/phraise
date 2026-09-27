Status: in progress
Author: builder (Sonnet 5)
Updated: 2026-09-27
Plan: [spike 6 plan](../plans/2026-09-27-spike-6-plan.md)
Brief: [brief 04](../plans/2026-09-27-spike-6-brief-04-relay-gates-a-e.md)

Timezone: local machine time (CEST), from `date` at time of writing.

## 17:31 — task received

Read AGENTS.md, brief 04, charter (milestone 1 table, rules for every
agent), plan sections 4-9. Surveyed the existing package
(`spikes/2026-09-27-integration-engine/`): `src/markdown`, `src/crdt`,
`src/engine`, `src/git`, `src/testkit` (partial) already built by earlier
briefs, with unit tests and `test/import-boundary.test.ts`. Read every
engine/crdt/git public function signature I will call from the relay
(seedFromCommit, prepareCommit/recordCommit, editorsSinceCommit/markEditor,
attachIntegration, comments, listAttribution, GitStore's writeDraft/
readDraft/deleteDraft/commit/fetch/remoteHead, testkit's remote.ts/hub.ts/
ports.ts/corpus.ts).

Read the reference sources named in the brief under `$REF`: spike 5's
`src/relay.ts`, `src/harness.ts`, `src/client.ts`, `gates/gateA.ts`,
`gates/gateE.ts`, `gates/lib/edits.ts`; spike 1's `gates/lib/diffHunks.ts`,
`topSpans.ts`, `words.ts`, `prng.ts`.

Read `node_modules/@hocuspocus/server`'s own source (the .cjs bundle) to
find the right hook for forged-identity rejection: `beforeSync(connection,
{type, payload})` runs inside `readSyncMessage`, before the
`syncStep1/syncStep2/update` switch executes, with `payload` already the
raw Yjs bytes (`message.peekVarUint8Array()`, non-consuming). Throwing
inside this hook lands in `processMessages`'s catch block, which closes the
connection and drops the whole message (the `MessageReceiver.apply`
switch that would call `readUpdate`/`readSyncStep2` never runs) --
resolves the "drop, close, count" requirement in one exception, no need to
touch `beforeHandleMessage` (which only gets the *entire* framed message,
undecoded). `y-protocols/sync`'s `messageYjsSyncStep1/2/update` = 0/1/2.
Decision: only check forgery for `type === 2` (update) strictly (mapped
attribution + `phraise-authors` peer collision); `type === 1` (syncStep2)
is accepted without the "mapped to another user" check per the brief's
"residual" note (full-state uploads legitimately carry other users'
already-known structs); `type === 0` (state-vector-only) is never checked.
Also found `Hocuspocus.openDirectConnection(docName, context)` for
HTTP-route access to a document without a live WS connection (drives
`onLoadDocument` the same as a real connection would).

Added `authorOf(doc, clientId)` to `src/crdt/attribution.ts` (named in plan
section 3 point 3 but not yet implemented) and exported it from
`src/crdt/index.ts`, since the relay's forgery check needs it. Installed
`prosemirror-commands` (needed by the ported edit helpers' `splitBlock`/
`joinBackward`).

Starting implementation: `src/relay/`, `src/testkit/editor.ts` +
`edits.ts` + `relayHarness.ts`, unit/integration tests, gates A-E, the gate
runner.

## 17:49 — src/relay/ built; gates A and B pass

Built `src/relay/`: `docName.ts` (`<branch>:g<generation>:<path>`, `docId`
= `<branch>:<path>`), `identity.ts` (auth stub), `forgery.ts`
(forged-identity check), `seeding.ts` (seed-or-restore-on-open),
`state.ts`/`keyedQueue.ts` (per-branch registry + serialization),
`flush.ts`/`debounce.ts` (draft flush, lease-rejection merge-and-retry),
`commit.ts`, `http.ts` (the control API), `server.ts` (`startRelay`),
`cli.ts` (child-process wrapper), `index.ts`, `README.md`.

Small additions to earlier briefs' files (allowed per this brief's
constraints -- "except files inside the spike package created by earlier
briefs"): `crdt/attribution.ts` gained `authorOf(doc, clientId)` (named in
plan section 3 point 3, not yet implemented); `crdt/editorPlugins.ts`
gained `initEditorDoc(doc)` (wraps `initProseMirrorDoc` behind the opaque
`CrdtDoc` interface, needed because `src/testkit/editor.ts` must not import
`yjs`/`@tiptap/y-tiptap` itself -- the import-boundary test scans every
file outside `src/crdt/`, testkit included); `crdt/index.ts` now also
exports `FRAGMENT_NAME`. Extended `test/import-boundary.test.ts` with the
brief's required check (src/relay may import `@hocuspocus/server`/
`/extension-sqlite`, never `yjs` itself).

Design decision found by reading `node_modules/@hocuspocus/server`'s own
source: forged-identity rejection is implemented in the `beforeSync`
extension hook, not `beforeHandleMessage` (see `src/relay/forgery.ts`'s own
header comment for the full reasoning: `beforeSync` already hands over the
decoded message type + raw Yjs bytes, and throwing there is caught by
`Connection.processMessages`'s own try/catch, which drops the message,
closes the connection, and never broadcasts -- one exception covers all
three of the brief's requirements). Only `type === 2` (an ordinary
incremental update) is checked strictly; `type === 1` (syncStep2, a
client's full state) is accepted without the "mapped to a different user"
check, per the brief's own "residual" note -- documented in `src/relay/`'s
README and `forgery.ts`'s header comment, not silently assumed.

Content-change detection for `editorsSinceCommit` (plan section 6: "marks
editorsSinceCommit for users whose updates changed document content, not
comment-only or ack-only updates"): a `WeakMap<Document, string>` cache of
`JSON.stringify(read(document).toJSON())`, compared on each `onChange`
call restricted to genuine connection-origin transactions (`{source:
'connection', ...}` -- Hocuspocus's own `TransactionOrigin` shape); this
also skips the relay's own internal writes (attribution, draft-merge,
direct-connection commits) for free, since none of those are
connection-origin. Logged as a deviation from a literal per-update Yjs
struct inspection, traded for simplicity; acceptable at milestone-1 sizes,
flagged as a milestone-4 (gate M) cost to revisit.

Per-document operation queue (plan section 6) is implemented as a
per-BRANCH `KeyedQueue` (`src/relay/keyedQueue.ts`), a strict superset of
"serialized per document" (draft flush is inherently branch-scoped: one
draft ref per branch, covering every open document of it at once) --
logged as a deviation in `keyedQueue.ts`'s own header comment.

Verified gate A (`gates/a.ts`) and gate B (`gates/b.ts`) directly with
`npx tsx gates/<x>.ts`: both pass. Gate A's independent-seed byte-equality
check required NOT recording seed attribution (unlike spike 5's relay,
which attributes the seed content to a `'seed'` pseudo-user) -- confirmed
this was necessary for the byte-for-byte requirement and is the design as
built (attribution starts only once live editors touch the document).

Gate B's "the forger's connection is closed" check needed a build-and-fix
cycle: the official `@hocuspocus/provider` client does not expose a
reliable "my connection was closed" signal to a test from the outside (its
document-level `onClose` is a no-op stub by default, and its own
reconnect logic opens a fresh, unblocked connection quickly) -- switched to
a small test-only introspection route, `GET /connections?docName=`
(`document.getConnectionsCount()`), checked immediately (well before
reconnect) before/after the forgery. Logged in `gates/b.ts` and
`src/relay/http.ts`'s own comment; this route is not part of plan section
6's named HTTP surface, added only for this observability need.

lsof confirms no listener remains on 4300-4399 after each gate run.

Next: gate C (comments), gate D (drafts/restore/lease), gate E (commit +
corpus containment), unit tests, the gate runner.

## 18:02 — gates C, D, E; unit tests; gate runner; definition of done met

Ported gate E2's containment helpers into `gates/lib/`: `diffHunks.ts`
(verbatim), `topSpans.ts`/`words.ts` (retargeted `BlockPos` import to this
spike's `src/markdown/index.js`, otherwise verbatim from spike 1). Reused
`src/testkit/prng.ts` already in the package instead of re-porting spike
1's own `gates/lib/prng.ts` (same mulberry32 construction).

Wrote `gates/c.ts` (comments: create/reply/resolve/list; edits before,
inside and after the quoted range; a deleted-quote comment orphans with
its quote intact), `gates/d.ts` (flush -> plain-clone diff/show/first-parent
check; restart with data dir deleted -> restore with identical text/
comments/attribution; a competing writer's draft push -> stale rejection,
counted, merge-and-retry reported), `gates/e.ts` (E1: trailers, parent,
stale-head refusal; E2: 50 seeded-choice `corpus/fetched/real` files
[10 for `--quick`], 1-3 random word edits each through a real editor
transaction, committed, containment checked via `computeLcsHunks` against
the edited paragraphs' own original line spans -- multi-hunk aware, so
edits in different paragraphs of the same file are checked independently
rather than folded into one overlong envelope).

All five gates pass, run directly (`npx tsx gates/<x>.ts`) and through
`gates/index.ts` (built this session: runs A-E, prints a table, writes
`results/gates.{md,json}`, checks port freedom in 4300-4399 via
`testkit/ports.ts`'s `isPortFree`, exits non-zero on any gate failure or
leaked port). Ran gate E's full (non-quick) 50-file corpus pass once
directly: 50 files, 94 edits, 0 containment violations, ~30s.

Added the four required `test/relay.*.test.ts` files (open+seed/converge,
forgery, draft flush+restore+lease, commit+trailers) -- short versions of
the gate scenarios, per the brief ("keep each test short; the gates do the
heavy measurement"). `npm test`: 18 files, 53 tests, all pass, ~14s.

Verified directly, in this order, all green: `npm run typecheck` (clean),
`npm test` (53/53), `npm run gates:quick` (A-E all PASS, "No ports still
listening in 4300-4399"). Did **not** run the full `npm run gates` as a
suite (charter rule: "long verification runs belong to the orchestrator");
gate E's own full-size run was checked once in isolation above as the one
exception explicitly worth the cost (it is the slow one, and the brief's
task list calls for reporting it).

Updated `README.md` (top-level and `src/testkit/README.md`,
`src/crdt/README.md`) to reflect brief 04's additions and origins; wrote
`src/relay/README.md` (module shape, HTTP routes, the `beforeSync` hook
choice and its documented residual, the `editorsSinceCommit`
content-diffing design, origin notes).

## Handback

`npm test`, `npm run typecheck` and `npm run gates:quick` all pass. Gates
A-E each report pass in the quick run. No deviations left the brief's
scope unmet; logged deviations (all recorded above and in the relay
README): seed content is never attributed (needed for gate A's byte-equality
requirement); the per-document operation queue is implemented per-branch
(a safe superset); `editorsSinceCommit`'s "changed document content" check
is a whole-document JSON diff, not a per-update Yjs struct inspection;
`GET /connections` and `POST /poll` are relay routes beyond plan section
6's named list (the first for gate B's own observability need, the second
a documented stub since milestone 2's head-poll/rebase is out of scope
here). Nothing was committed (per the brief); no server was left running
(`lsof` checked after every gate run and at the end of this session).
