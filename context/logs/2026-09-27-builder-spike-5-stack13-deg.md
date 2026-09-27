# Log: builder, spike 5, brief 03 (stack 13 gates D, E, G + B3 + C addendum)

Status: done (handback)
Author: builder (Sonnet 5)
Updated: 2026-09-27
Plan: [spike 5 plan](../plans/2026-09-27-spike-5-plan.md)
Brief: [brief 03](../plans/2026-09-27-spike-5-brief-03-stack13-deg.md)

Local timezone: CEST (machine local time; confirmed via `date` at session start: `Sun Sep 27 09:44:28 CEST 2026`).

## 09:45 -- task received

Read AGENTS.md, brief 03, plan, charter "Rules for every agent" section, and
the previous builder's log (brief 01, stack13-core). Read the existing
package: README.md, package.json, src/relay.ts, src/client.ts, src/harness.ts,
src/workarounds/{rootAttrs,leafMarks}.ts, src/yjs.ts, src/schema.ts,
src/compare.ts, gates/{gateA,gateB,gateC}.ts, gates/lib/{edits,equality}.ts,
scripts/gates.ts, scratch/probe-atom-mark-change.ts, results/gates.md.

Confirmed via `git log` that gate C is already at 266/266 on both paths
(orchestrator's commit 39a8f10, "fix root-attrs plugin clobbering synced
lead"), and `results/gates.md` already reflects 266/266 -- but README.md's
prose ("Known limitations", gate C section, workaround-costs paragraph)
still describes the old 265/266 npm-bull-readme.md finding as unresolved.
Confirmed npm registry access works and `@tiptap/core@3.31.3` exists
(`npm view` succeeded). node_modules already has @tiptap/y-tiptap,
@hocuspocus/{server,provider,extension-sqlite} from brief 01; no
@tiptap/core, extension-collaboration, extension-collaboration-caret, or
@tiptap/pm yet -- brief 03 task 4 adds them.

Plan for ordered tasks 1-6 as in the brief. Starting with task 1 (gate B3).

## 10:02 -- task 1 done: gate B3

gates/gateB3.ts, five cases (initial + 4 edits) through the real relay +
two live editors + workaround plugins, no new fixture file needed (used
gates/lib/edits.ts's replaceWholeDoc, same trick gateC.ts's path (b)
already uses, to reset to a pristine linked-image doc between cases 3 and
4, which each rewrite the image wholesale). Smoke-tested standalone
(scripts/smoke-gateB3.ts, deleted after passing): all 5 cases pass.
`lsof -nP -iTCP:4210-4239 -sTCP:LISTEN` empty afterward. Not yet wired into
scripts/gates.ts (task 6).

## 10:02 -- task 3 in progress: gate E design + attribution.ts

Read @hocuspocus/server's type defs directly (node_modules/@hocuspocus/server/dist/index.d.ts)
for onChange/onAuthenticate/onLoadDocument payload shapes, and its .cjs
source for two load-bearing facts confirmed by reading code, not
assumed: (1) `Document`'s constructor binds a raw Y.Doc 'update' listener
immediately, but Hocuspocus's own onChange plumbing (`document.onUpdate(...)`)
is wired only *after* onLoadDocument's hooks return -- so a seed write
inside onLoadDocument never reaches onChange; worked around by calling
recordAttribution manually right after the seed write, using
`Y.encodeStateAsUpdate(document)` (valid because the document was empty
before that hook ran, so it's exactly that seed's own update). (2) onChange
fires for *every* Y.Doc update including ones the server's own
`document.transact()` calls make (handleDocumentUpdate is bound to the raw
'update' event with no source filtering) -- so recordAttribution's own
write needed a sentinel transaction origin (ATTRIBUTION_ORIGIN) that
relay.ts's onChange hook checks and skips, or it would recurse forever.

Design: src/attribution.ts. Mapping lives in a Y.Map inside the document
(`phraise-attribution`, client id -> {user, ranges: [from,to,serverReceivedAtMs][]}),
not a relay-side SQLite table -- justified in the file's header comment
(zero extra persistence wiring, replicates to clients for free, directly
comparable to encodeStateAsUpdate for the size measurement; real named cost:
ranges never compact/GC). Conflicts (a client ID already mapped to a
different user) are flagged into a second Y.Map
(`phraise-attribution-conflicts`) rather than overwriting the original
mapping. `listAttributedRanges` walks the XmlFragment tree, and for each
Y.XmlText follows its own internal item linked list (`_start`/`.right`,
same one ySyncPlugin itself walks) to find visible (non-deleted)
ContentString runs, looks up who wrote each one, and merges adjacent runs
by the same (user, time). Verified this linked-list approach directly with
a throwaway exploration script (scripts/explore-items.ts, deleted after
confirming id/length/deleted/content.str all read correctly) before relying
on it.

Wired into src/relay.ts: onAuthenticate already set context.user (brief 01
placeholder, now used for real); added onChange (guarded against
ATTRIBUTION_ORIGIN recursion, defaults to 'seed' when context.user is
absent -- i.e. only for the server-internal seed transact); the seed's own
recordAttribution call in onLoadDocument (see above); a graceful SIGTERM
handler calling the inner `Hocuspocus` instance's `flushPendingStores()`
before exit (gate G1); `--debounce`/`--maxDebounce`/`--no-attribution` CLI
args (the last one only to isolate attribution's byte cost for gate E's
size measurement, by diffing two otherwise-identical runs). Found
Hocuspocus's actual debounce defaults by reading
@hocuspocus/server/dist/hocuspocus-server.cjs directly: debounce 2000ms,
maxDebounce 10000ms (defaultConfiguration literal in the source, not
documentation).

Exposed `websocketProvider` on `LiveClient` (src/client.ts) and an optional
`clientId` override on `createLiveClient`, needed for gate G/E's
disconnect/reconnect and (attempted, see below) collision tests.

**Finding, confirmed by testing (not assumed): a second client forced to
another user's real clientID cannot be used to test server-side collision
detection**, because Yjs's own client-side defense (yjs.cjs's
transactionCleanup: "Changed the client-id because another client seems to
be using it") reassigns a doc's OWN clientID the moment it *receives* a
remote update under that same ID -- which happens automatically during
that second client's very first sync, before it ever gets to send an edit
under the forged ID. Worked around, and arguably more realistic anyway: an
already-synced, already-authenticated client (mallory) applies a raw update
crafted with someone else's clientID directly onto her own live Y.Doc via
`Y.applyUpdate` (bypassing any polite client library's own sync dance
entirely, which is what an actual attacker forging protocol bytes would
do); HocuspocusProvider forwards any update whose origin isn't its own
internal marker (confirmed by reading `documentUpdateHandler` in
@hocuspocus/provider's source: `if (origin === this) return;`), so this
reaches the relay over mallory's authenticated connection. Confirmed this
now correctly gets flagged (gates/gateE.ts's collision check).

**Second finding, also confirmed live**: applying that forged update
doesn't only affect the relay -- alice's own real, already-connected
client, upon *receiving* the rebroadcast of an update asserting her own
clientID from elsewhere, triggers that same Yjs self-defense and silently
reassigns her OWN clientID mid-session (no error, no event exposed for it).
Gate E's collision check captures alice's clientID *before* the forgery and
uses that captured value throughout, and separately reports whether the
self-heal fired (it does, every time tested).

gates/gateE.ts written: listing (seed+alice+bob), collision (above),
reconnect (same Y.Doc/clientID, ranges accumulate), reload (new Y.Doc/
clientID, same user, no conflict), a restart-survival check, and a size
measurement (diffing an attribution-enabled run against a --no-attribution
run of the identical edit script). Smoke-tested standalone
(scripts/smoke-gateE.ts): listing, collision, reconnect, and reload checks
all pass. Restart-survival check currently FAILS -- see next entry;
pausing gate E's restart check to debug gate G first (same underlying
mechanism, more foundational, budgeted as its own task next), then
revisiting gate E with whatever gate G's debugging finds.

## 10:05 -- task 2 done: gate G, plus the fix for gate E's restart check

Isolated the restart-survival bug with a throwaway script
(scripts/smoke-restart.ts, deleted after confirming): the relay's own GET
/state/<docName> endpoint (src/relay.ts's onRequest) reads
`instance.documents.get(documentName)`, which is only populated for
documents already resident in the process's memory -- right after a fresh
restart, before any client reconnects, nothing is loaded yet, so a bare
fetchState reads back 0 bytes even though SQLite already has the row.
Confirmed directly: a plain restart + immediate fetchState gave 0 bytes,
but a client reconnecting first (which triggers onLoadDocument -> SQLite
restore, same as any real client) then fetchState gave the correct byte
count and content. This is a real, reportable constraint of this harness's
debug endpoint, not a persistence bug -- fixed gate E's restart check (and
built gate G around this from the start) to always reconnect a client
before reading `/state` post-restart.

gates/gateG.ts, G1-G4 as the brief specifies, all against a shortened
debounce/maxDebounce (200ms/500ms; found Hocuspocus's real defaults --
2000ms/10000ms -- by reading defaultConfiguration directly in
@hocuspocus/server/dist/hocuspocus-server.cjs, not documentation).
- G1 (SIGTERM): wait past the debounce, stop both editors and the relay,
  start a new relay on the same port+db, both reconnect on their own,
  content intact, a new edit propagates.
- G2 (SIGKILL), both before and after the debounce: kills the relay child
  process directly via `relay.proc.kill('SIGKILL')` (bypassing relay.ts's
  own SIGTERM handler entirely, unlike G1). Reports sqlite file size
  before/after the kill for both timings. In both cases the client that
  stayed alive through the kill still had the edit in memory (Yjs docs
  never depend on the relay for their own local state) and a *second*,
  fresh client proves the relay has it too once the surviving client's
  provider auto-reconnects and resyncs its full state to the new (possibly
  empty) relay process -- i.e. nothing is actually lost end-to-end as long
  as one client stayed connected across the outage, regardless of what the
  debounce had or hadn't flushed to disk yet.
- G3: both editors edit locally while the relay is fully stopped (no live
  connection needed for a Y.Doc/EditorView to accept transactions), relay
  restarts, both auto-reconnect, editor1/editor2/relay converge
  (gates/lib/equality.ts's full check, reused from gate B).
- G4: bob disconnects only his provider (websocketProvider.disconnect()),
  both sides edit -- including overlapping inserts into the same paragraph,
  and, more deliberately, BOTH sides concurrently changing the link on the
  SAME image (badge.svg) to different hrefs, specifically to observe and
  report the CRDT resolution rather than assume one. Bob reconnects; all
  three converge. Findings, both concurrent text insertions survive
  (Yjs interleaves rather than drops concurrent inserts at different
  positions in the same text); the same-node link conflict resolves
  deterministically to exactly one of the two concurrent hrefs (observed:
  bob's write won in this run) -- that is what "nothing is lost except what
  CRDT semantics define" means concretely here: last-write-wins on a single
  node's attribute is the one real, by-design "loss" (the losing side's
  href), not corruption or data loss elsewhere.

Smoke-tested standalone (scripts/smoke-gateG.ts, deleted after passing):
all 5 checks (G1, G2 x2, G3, G4) pass. Re-ran gate E's restart check with
the fix above: now passes too. `lsof -nP -iTCP:4210-4239 -sTCP:LISTEN`
empty after both. Cleaned up all scratch/smoke-*.ts and
scripts/explore-items.ts once folded into code comments and this log,
matching brief 01's convention.

Not yet wired into scripts/gates.ts (task 6) -- next: task 5 (gate C
corpus-size addendum), then task 4 (gate D, Tiptap), then the runner/README
(task 6).

## 10:27 -- task 5 done: gate C corpus-size addendum

gates/gateC.ts's path A now also sums `relay.fetchState(...).length` per
file into a new `encodedStateBytesTotal` (same measure stack 14 reports:
`encodeStateAsUpdate` bytes on the relay). scripts/gates.ts reports it next
to stack 14's own number. Quick run (5 files): 342.1KB. Full-corpus number
left for the orchestrator's full `npm run gates` run (brief: "long
verification runs belong to the orchestrator").

## 10:27 -- task 4 done: gate D, Tiptap 3.31.3

Installed exact versions: @tiptap/core, @tiptap/extension-collaboration,
@tiptap/extension-collaboration-caret, @tiptap/pm, all 3.31.3 (verified
available via `npm view` before installing); @tiptap/y-tiptap 3.0.9 already
present from brief 01. `npm ls prosemirror-model prosemirror-state`: single
version each (1.25.12 / 1.4.4) throughout, including under @tiptap/pm --
no dedupe needed, confirmed by reading @tiptap/core's and
@tiptap/extension-collaboration's own package.json (neither has any direct
prosemirror-* dependency at all, only a peerDependency on @tiptap/pm, which
itself resolves to the same already-installed prosemirror-* packages).
gates/gateD.ts's own "Dedupe" check re-verifies this by parsing `npm ls
--json` at gate-run time, not just trusting this one-time manual check.

src/tiptapExtensions.ts: a generic converter reading spike 1's schema's own
`schema.spec.nodes`/`.spec.marks` (name, content, group, inline, atom,
marks, code, attrs-with-defaults, parseDOM, toDOM) into Tiptap `Node`/`Mark`
extension configs; per-attribute Tiptap HTML (de)serialization is disabled
(`renderHTML: () => ({}), parseHTML: () => null` per attr) so the node/
mark-level parseHTML/renderHTML -- which just calls this schema's own
toDOM/parseDOM directly -- is the only DOM logic in play, matching spike
1's DOM rules exactly rather than Tiptap's own generated data-* attributes.
`checkSchemaEquivalence()` compares content/group/inline/atom/marks/code
and attrs-with-defaults (not toDOM/parseDOM by function identity, which
would always differ since Tiptap wraps them in new closures -- DOM
behavior is instead proven by rendering through both, see the debugging
below): all 17 nodes and 5 marks match.

src/tiptapWorkaroundsExtension.ts wraps the two workaround plugins
(src/workarounds/{rootAttrs,leafMarks}.ts) completely unchanged in a
Tiptap `Extension.create({addProseMirrorPlugins() {...}})` -- a Tiptap
Extension's addProseMirrorPlugins() has the exact same contract as raw
ProseMirror (return some prosemirror-state Plugins), so no rewrite was
needed, just a thin wrapper. Same plugin-order constraint as brief 01
(leafMarksPlugin before rootAttrsPlugin) still applies and is preserved.

src/tiptapClient.ts: a Tiptap twin of src/client.ts, same
Y.Doc/HocuspocusProvider wiring (same manageSocket/attach/await-sync-first
ordering requirements apply identically), building a Tiptap `Editor` from
buildTiptapExtensions() + `@tiptap/extension-collaboration`
(`Collaboration.configure({document, field: FRAGMENT_NAME})`, reusing the
SAME `@tiptap/y-tiptap` ySyncPlugin under the hood -- one binding, as the
plan requires) + `@tiptap/extension-collaboration-caret` + the wrapped
workarounds Extension.

Debugging (each confirmed by testing before fixing, not assumed):
1. **jsdom gap**: `editor.commands.focus()` (needed for the caret test)
   crashed with `target.getClientRects is not a function` --
   prosemirror-view's scrollToSelection always calls this on focus/selection
   change, and jsdom implements neither Range nor Element's
   getClientRects/getBoundingClientRect at all (confirmed directly: `'get
   ClientRects' in Range.prototype` is false). Fixed with a narrow,
   documented shim in src/tiptapClient.ts (same class of gap as brief 01's
   dummy-ClipboardEvent shim for pasteHTML) returning empty/zeroed rects --
   scoped to this file since only gate D ever focuses an editor.
2. **A schema-instance-identity bug, found in two layers**:
   (a) src/compare.ts's `semanticEq`/`markSemanticEq` compared
   `a.type !== b.type` -- a NodeType/MarkType object reference check. A
   live Tiptap editor's doc uses Tiptap's OWN Schema instance
   (`getSchema()` always builds a fresh one from the extensions array, per
   @tiptap/core's ExtensionManager source -- confirmed by reading it, no
   override hook exists to reuse an external Schema object), structurally
   equivalent to src/schema.ts's canonical `schema` (checkSchemaEquivalence
   proves that) but never the same object -- so every single node compared
   unequal purely by identity, regardless of real content. Fixed: compare
   by `.type.name`/`.type.name` instead (documented in place; strictly more
   permissive only in exactly the case that used to be a false positive,
   identical everywhere every other gate already shares one schema
   instance).
   (b) That fix alone wasn't enough: src/serialize.ts's splice-candidate
   ladder (tryTextSplice/tryLinkSplice/tryTextblockSplice) also leans on
   ProseMirror's OWN native `Fragment.findDiffStart`/`findDiffEnd` and
   `Node.eq()`, which are reference-based internally and are
   prosemirror-model library code, not ours to patch. Confirmed directly:
   even with fix (a), `serializeDoc` still failed immediately on an
   UNTOUCHED heading, from the very first pre-edit check. Fixed at the
   call site instead (gates/gateD.ts's `canonicalize()`): convert a
   Tiptap-schema doc to the canonical schema via a JSON round-trip
   (`schema.nodeFromJSON(doc.toJSON())`) before handing it to
   serializeDoc/semanticEq/linkedImages -- JSON is exactly the
   schema-agnostic wire format Tiptap's own sync mechanism already uses,
   and task 4's own schema-equivalence check is what makes this round-trip
   lossless. Both fixes are documented in place with the reasoning above,
   since either one alone left a real, reproducible failure.
3. **A false alarm, root-caused before concluding anything**: gate D's
   convergence check appeared to badly corrupt an untouched paragraph
   (block count jumping 11 -> 13, an unrelated block's text going empty)
   on the very first edit, but ONLY when driven through `runGateD`/the
   smoke script and NEVER in several minimal hand-written repros (single
   client; two clients without workarounds; two clients with workarounds)
   -- eventually traced to gates/gateD.ts simply never deleting its own
   sqlite db file between runs (unlike gateE.ts/gateG.ts, which do), so
   repeated manual test runs kept reloading and compounding an
   already-corrupted document PERSISTED from an earlier (pre-fix) run,
   rather than seeding fresh each time. Fixed with the same `fs.rmSync(dbPath,
   {force:true})` convention gateE.ts/gateG.ts already use. Logged as a
   lesson: an intermittent-seeming bug that vanishes in every isolated
   repro is worth checking for stale persisted state before suspecting the
   thing actually under test.
4. **caret rendering needs real DOM focus, which needs one thing per
   client**: `@tiptap/y-tiptap`'s yCursorPlugin only broadcasts a cursor
   into awareness when `editorView.hasFocus()` (confirmed by reading
   y-tiptap.cjs directly) -- and jsdom only honors `.focus()` on an element
   actually attached to a document, so src/tiptapClient.ts now appends its
   mount element to `document.body` (and removes it on destroy). Since
   every gate in this package shares ONE process-wide jsdom
   window/document (global-jsdom/register, established since brief 01),
   only one element can hold focus at a time -- focusing bob blurs alice,
   which *clears* her broadcast cursor (yCursorPlugin's own blur handler).
   Gate D's caret check is therefore sequential (focus alice, confirm bob's
   DOM shows her caret; then focus bob, confirm alice's DOM shows his),
   documented as a genuine harness constraint (one shared jsdom document,
   not a Tiptap/y-tiptap limitation -- a real deployment is one browser tab
   per user).

gates/gateD.ts: dedupe check, schema-equivalence check, gate B's own script
run through two Tiptap editors (converge via canonicalize() + the plan's
equality check, including every linked image's mark), caret/awareness
(both directions), undo isolation (alice's undo removes only her own
change; bob's survives on both sides). All 6 checks pass, confirmed stable
across repeated runs from a clean db. `npm run gates:quick` (gates A/B/C)
re-run after the compare.ts change: still all PASS, no regression.
`lsof -nP -iTCP:4210-4239 -sTCP:LISTEN` empty after every run. Cleaned up
all debug-gateD-*.ts / smoke-tiptap-*.ts scripts once folded into this log
and code comments.

**Nothing had to be replaced by a custom extension** beyond
PhraiseWorkarounds itself (which the brief already asks for) -- Tiptap 3's
Collaboration and CollaborationCaret extensions worked against
@tiptap/y-tiptap unmodified, on a schema built entirely from spike 1's own
definitions via a generic converter.

Next: task 6 (wire B3/D/E/G into scripts/gates.ts, gates:quick shortened
versions, README).

## 10:34 -- task 6 done: runner, README

Wired gates B3, D, E, G into scripts/gates.ts (ports 4214 B3; 4215-4216 D;
4217-4221 E; 4222-4226 G, all within the 4210-4239 range). Added a `quick`
option to runGateD/runGateE/runGateG: quick skips D's caret/undo round, E's
reconnect/reload/restart/size rounds (keeps listing+collision, its
headline demonstration), and G's G2/G3/G4 (keeps G1). Found and fixed the
same "never deletes its own sqlite db between runs" gap in gateE.ts that
gateD.ts had (see the 10:27 entry) -- gateE.ts's four sub-scenarios now
`fs.rmSync` their db paths the same way gateG.ts already did.

`npm ci && npm run gates:quick`: PASS (~10s). `npx tsc --noEmit`: clean.
`npm run gates` (full): PASS end to end, all gates green, 266/266 corpus
files both paths, in two of three full-pipeline runs (see below for the
third). `lsof -nP -iTCP:4210-4239 -sTCP:LISTEN`: empty after every run,
including quick, full, and every standalone smoke test run while
debugging today.

**A rare, honestly-reported flake, not swept under anything**: one full
`npm run gates` run showed gate C's path A at 265/266 (the same symptom
brief 01 originally found and the orchestrator's commit `39a8f10` fixed).
Investigated per the charter's "two genuinely different attempts" rule:
(1) three standalone reruns of gate C alone (not through the full
gates.ts pipeline) all showed 266/266; (2) a second full-pipeline rerun
also showed 266/266. Candidate mechanism (not confirmed): brief 03's
`onChange` hook now fires -- and writes an extra, separate transaction --
for every document in every gate, including gate A/B/B2's relays, which
didn't happen before this brief; this plausibly shifts Hocuspocus's own
update-batching/observer-notification timing just enough to occasionally
reopen the exact race the orchestrator's fix targeted. Not chased further
within budget; documented in README's "Known limitations" for the
orchestrator's own full run to watch for.

README.md updated: corrected the stale 265/266 claim per the brief's
instruction (task 6), explaining the orchestrator's actual fix rather than
leaving it as an open question; added B3/D/E/G to the goal, origin, layout,
running and gates sections; a new "Attribution design" section (where the
mapping lives, why, its measured byte cost, the listing walk, the
collision test and why the obvious approach doesn't work, reconnect/
reload/restart); and five new "Known limitations" entries (the jsdom
getClientRects gap, the Tiptap schema-instance-identity issue and its two-
layer fix, the sequential-caret harness constraint, G4's CRDT last-write-
wins finding, and this flake).

Deleted every throwaway debug/repro script once its finding was folded
into code comments, this log, or the README (debug-gateD-*.ts,
smoke-tiptap-*.ts, smoke-gateB3/D/E/G.ts, explore-items.ts,
smoke-restart.ts, repro-gatec-flake.ts) -- matching brief 01's convention.
Kept scratch/probe-atom-mark-change.ts (the brief explicitly says to).

Stopping point reached (brief: task 6 done is the stopping point).
Committing next, then handing back.
