# Log: builder, spike 5, stack 13 rebase (gate F)

Status: in-progress
Author: builder (Sonnet 5)
Updated: 2026-09-27
Plan: [spike 5 plan](../plans/2026-09-27-spike-5-plan.md)
Brief: [brief 05](../plans/2026-09-27-spike-5-brief-05-stack13-rebase.md)

Time zone: local machine time (CEST), from `date`.

## 11:43 — task received, read AGENTS.md, brief 05, plan, charter
## 11:50 — task 1 done: ported spike 2 into src/rebase/

Copied spike 2's src/{schema,ids,text,markdown,diff,seed,rebase,integrate,comments,replica}.ts
and src/gates/{scenario,gate-a-c,gate-b,gate-d,gate-d2,gate-idempotent,convergence,types}.ts
(origin: branch spike/2026-09-27-crdt-rebase, commit 88bd85c) into this package's
src/rebase/ and src/rebase/gates/, from the scratchpad ref checkout.

Only two files needed a change (per the brief's own schema/converter instruction --
everything else is verbatim): src/rebase/seed.ts and src/rebase/diff.ts each imported
`y-prosemirror`; retargeted both to `@tiptap/y-tiptap` (this package's existing binding
choice, confirmed to re-export prosemirrorToYXmlFragment/yXmlFragmentToProseMirrorRootNode/
updateYFragment with identical names/signatures -- checked directly against
node_modules/@tiptap/y-tiptap's exports before relying on it).

Added 3 runtime deps spike 2's code needs that this package didn't have:
markdown-it@^14.1.0, prosemirror-markdown@^1.13.1, approx-string-match@^2.0.0, plus
@types/markdown-it as a devDependency (prosemirror-markdown ships its own types;
approx-string-match ships build/src/index.d.ts next to its "main" entry with no
"types" field in package.json, which TS's classic resolution still finds -- confirmed
tsc sees it with no shim needed).

`npx tsc --noEmit`: clean.

Wrote scripts/rebase-baseline.ts (not part of `npm run gates`): runs spike 2's own
gates A/B/C/D + D2 + idempotent (its own lettering, distinct from stack 13's gate
A-G table) headlessly via the copied src/rebase/replica.ts in-memory harness. All
six pass, matching spike 2's own results:
- A (untouched-paragraph comment resolves via crdt): PASS
- B (word/char via crdt, block via fuzzy): PASS
- C (deleted-paragraph comment orphans, negative control holds): PASS
- D (6 permutations + 50 shuffles all converge): PASS
- D2 (resurrection of deleted-but-locally-edited block): PASS
- idempotent (byte-identical rebase update from two replicas, no duplication on reapply): PASS

Task 1 done. Moving to task 2 (relay: rebase: seeding, gc off, rebase route,
relay-side integration).

## 12:05 — task 2 done: relay rebase seeding, gc off, /rebase route, relay-side integration hook

Added src/rebase/liveIntegration.ts: attachIntegrationHook(doc, {isRemoteOrigin})
using the Y.Doc's own beforeTransaction/afterTransaction events (per the
brief's own instruction) -- snapshots P before a qualifying transaction, runs
integrate(doc, P, doc.clientID) after. Confirmed by reading source (not
assumed) what "remote" looks like on each side:
- live client: @hocuspocus/provider's applySyncMessage calls
  readSyncMessage(..., provider.document, provider) -- transactionOrigin
  is the HocuspocusProvider instance itself.
- relay: @hocuspocus/server's readSyncMessage passes
  {source:'connection', connection} for a client-sourced message,
  {source:'local'} otherwise -- isConnectionOrigin checks
  origin.source === 'connection'.
Both sides skip origin === 'integrate' (integrate.ts's own transaction tag)
to avoid recursion; this exclusion is automatic for the relay's own
rebase-apply transaction too (tagged 'rebase', not connection-shaped).

relay.ts changes (task 2):
- yDocOptions: {gc:false, gcFilter:()=>false} on the Server config -- found
  by reading @hocuspocus/server's defaultConfiguration/Document constructor
  (yDocOptions spreads into `new Document(name, yDocOptions, ...)`, which
  does `super(yDocOptions)` against Y.Doc). TS required gcFilter alongside
  gc in the option type, satisfied with a filter that never protects
  anything (irrelevant when gc itself is false).
- rebase: prefix added to splitDocName; onLoadDocument seeds it from
  <seeds>/rebase/<name>.md via spike 2's own seedDoc (commit "A",
  REBASE_SEED_AUTHOR) -- checks emptiness of spike 2's own "pm" fragment,
  not spike 1's "prosemirror" one, since the two schemas never share a doc.
- attachIntegrationHook(document, {isRemoteOrigin: isConnectionOrigin})
  called once per document (WeakSet-guarded) in onLoadDocument, for every
  doc kind -- "the relay itself also integrates (it is a replica)".
- POST /rebase/<docName> {targetMarkdown, targetCommit, authorName?,
  authorEmail?, granularity?}: 404 if the document isn't loaded yet (no
  client has connected -- computeRebaseUpdate needs the seeded base/
  snapshot that only onLoadDocument writes); else reads the doc's own
  PHRAISE_MAP 'base' pointer first and short-circuits with
  {applied:false, reason:'already at target'} when it already equals
  targetCommit (idempotence point -- see the file's own comment for why
  this has to be checked at the route rather than relying on
  computeRebaseUpdate to converge to a true no-op on a repeat call);
  otherwise calls computeRebaseUpdate(document, ...) and
  Y.applyUpdate(document, update, 'rebase'), which reaches Hocuspocus's
  normal broadcast path (same as any client edit) with no extra plumbing.

Smoke-tested directly (raw Y.Doc + HocuspocusProvider, no ProseMirror editor
yet -- deleted after, per this package's convention): POST before any
client connects -> 404 as expected; connecting seeds correctly (doc text
and PHRAISE_MAP 'base' == {id:'A',commit:'A'} match the source .md); POST
targetCommit B -> 200 {applied:true}, and the already-connected raw client
receives the rebased content within one poll (base becomes {id:'B',
commit:'B'}, text matches the rewritten paragraph); retrying the identical
POST -> 200 {applied:false, reason:'already at target'} -- confirms
idempotence end-to-end, not just by reading the code. lsof -nP
-iTCP:4210-4239 -sTCP:LISTEN empty afterward.

`npx tsc --noEmit`: clean.

Task 2 done. Moving to task 3 (live clients for spike 2's schema).
