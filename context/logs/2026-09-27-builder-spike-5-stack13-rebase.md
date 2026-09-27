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

## 13:05 — task 3: live clients built; found and fixed a real relay-side integrate() bug

Added src/rebase/liveClient.ts (createRebaseLiveClient): a Y.Doc(gc:false),
HocuspocusProvider over `ws`, real ProseMirror EditorView with ySyncPlugin
on spike 2's PM_FRAGMENT ("pm") and schema -- no workaround plugins, since
spike 2's schema has neither of stack 13's two known losses (no root
`doc` attrs at all, no inline atom leaf nodes -- only `text` is inline, so
marks are plain Y.XmlText formatting, never lost). The integration hook
attaches to `ydoc` *before* awaiting the provider's first sync, so a client
that connects after a rebase already happened still runs integrate() over
the very first batch it receives.

Also changed src/rebase/schema.ts (a copied file, changed only where the
live setting requires it, per the brief): added toDOM/parseDOM to every
node and mark. Spike 2 never rendered a real EditorView (headless only), so
this was missing entirely; a real EditorView threw
`node.type.spec.toDOM is not a function` immediately without it. Standard
prosemirror-schema-basic/-list-shaped rules; no change to content model,
attrs, or marks. Confirmed the headless baseline (scripts/rebase-baseline.ts)
still passes unchanged after this.

Smoke-tested two live editors (alice, bob) typing into different
paragraphs on a `rebase:` doc, converging, then a rebase applied via POST
while both stayed connected (deleted the throwaway scripts after, per this
package's convention, except smoke-live-client.ts kept a little longer for
task 4 reference then removed).

**Real bug found and fixed** (not from reading the code -- from running it):
the very first live run showed the rebase's *untouched* heading block
flagged `concurrent-edit` in `needsReview()` on both alice's and bob's
docs, even though neither of them (nor anyone) had touched it. Traced with
five throwaway instrumented variants (temporary env-gated console.error in
integrate.ts/liveIntegration.ts, reverted after) to the relay's own copy of
the integration hook, not the clients':

The relay applies a rebase to itself directly (`computeRebaseUpdate` +
`Y.applyUpdate`, tagged origin `'rebase'`, deliberately excluded from
triggering the relay's own `attachIntegrationHook` since `isConnectionOrigin`
requires a connection-shaped origin -- correct, the relay authored this
change, there's nothing to integrate against for itself *at that moment*).
But the relay's own clientID was then left un-acked for that record. The
relay's hook next fires on whatever *unrelated* connection-sourced
transaction happens to arrive afterward (observed case: a client's own
`ack:<id>:<theirClientId>` write syncing back to the relay) -- by which
time the relay's live document has *already* moved past the rebase, so the
snapshot P taken just before that unrelated transaction reflects
post-rebase state, not pre-rebase state. Every upstream-changed block then
looks "locally changed" too (aContent, from the base snapshot, differs from
this stale pContent), so integrate() flags it `concurrent-edit` -- a false
positive for every block the rebase touched, not just genuinely
human-conflicting ones, and replicated to every client since `review` is an
ordinary shared Y.Map entry once set.

Fix (src/relay.ts's `/rebase` route): immediately ack the record under the
relay's own clientID, in a separate but immediately-following (still
synchronous, nothing can interleave) transaction right after applying the
rebase. This is not a workaround: the relay Document's own clientID never
authors anything inside a block's content (seed/rebase peers use their own
deterministic clientIDs; the relay's own clientID only ever appears on
metadata like the attribution map), so it never has a genuine "local edit"
to compare against for any record, and marking it acked immediately is
simply correct. Re-ran the smoke scenario after the fix: review map is
correctly empty (this scenario's alice/bob edits don't touch the rebased
heading, so nothing should be flagged) -- confirms the fix, not just the
absence of the old symptom. Gate F (next) verifies genuine P/Q conflicts
(spike 2's own scenario, where alice/bob's edits *do* land on blocks the
rebase also changes) still get flagged correctly by alice's and bob's own,
unaffected, per-client integrate() calls.

This is exactly the kind of thing brief 05 asked to report ("whether the
needs-review writes and resurrections then flow back through the relay
correctly") -- logged here in full since it changes a design assumption
(that the relay's copy of attachIntegrationHook needed no special handling
beyond the origin filter) that the "Decisions" table in the findings doc
should carry forward.

`npx tsc --noEmit`: clean. No relay left running after any smoke test
(checked with `lsof -nP -iTCP:4210-4239 -sTCP:LISTEN`).

Task 3 done (live clients + the relay-side integration fix). Moving to
task 4 (gate F proper).
