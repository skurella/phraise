# Log: builder, spike 5, stack 14 gates D/E/G (brief 04)

Status: done
Author: builder (Sonnet), model claude-sonnet-5
Updated: 2026-09-27
Brief: [brief 04](../plans/2026-09-27-spike-5-brief-04-stack14-deg.md)
Plan: [spike 5 plan](../plans/2026-09-27-spike-5-plan.md)
Charter: [spike 5 charter](../plans/2026-09-27-spike-5-charter-collab-stack.md)

Time zone: local machine time, per `date`.

## 09:00 -- task received

Read AGENTS.md, brief 04, the plan, and the charter's "Rules for every agent
in this spike" section. Read stack 14's existing README and the previous
builder's log (brief 02: custom relay works, Hocuspocus attempt (a) failed
on a lib0 major-version split). Read stack 13's D/E/G implementations
(src/attribution.ts, src/tiptapClient.ts, src/tiptapExtensions.ts,
src/tiptapWorkaroundsExtension.ts, gates/gateB3.ts, gates/gateD.ts,
gates/gateE.ts, gates/gateG.ts, scripts/gates.ts, package.json) as
templates. Read the orchestrator's reference docs the brief names
(yjs-attributing.md, yp-ATTRIBUTION.md, yp-CAVEATS.md, and the upstream
Tiptap 3 demo's main.js/extensions.js/schema.js) before writing anything.

## 10:52 -- task 1: Hocuspocus dedupe -- the fix that was missing

Confirmed the postinstall-symlink idea directly before committing to it:
wrote `scripts/postinstall-dedupe.mjs` (replaces `node_modules/yjs` and
`node_modules/y-protocols` with symlinks to `node_modules/@y/y` and
`@y/protocols` after every install; asserts `(await
import('yjs')).Doc === (await import('@y/y')).Doc`), added `"postinstall"`
to `package.json` and a `"lib0": "$lib0"` override (forces every
dependent's `lib0` range, including Hocuspocus's own, onto the project's
single `lib0@1.0.0-rc.33`). `npm install` from scratch: dedupe assertion
passed, and `find node_modules -name lib0` showed exactly ONE directory
anywhere in the tree.

Then tested the actual thing that matters: started brief 02's
`relay-attempt-a-hocuspocus.ts` as a background child process and ran a
real client (`createLiveClient` from `client-attempt-a-hocuspocus.ts`)
against it (`scratch/tmp-hp-dedupe-test.ts`, removed after logging this).
**It worked** -- two clients synced, exchanged an edit, both linked images
kept their marks, relay-stored state matched. This is the opposite of brief
02's crash. Root cause confirmed by the fix, not just theorized: npm
`overrides` alone installs the aliased package under the OVERRIDDEN name's
own directory (physically separate on disk from the real scoped package
despite identical content), so Yjs's cross-import guard still fires and
the two `lib0` majors never dedupe; the symlink step is what actually
collapses them to one copy.

Promoted the file pair for real: `git mv`-equivalent rename (this
directory is mine to extend per the charter) --
`relay-attempt-a-hocuspocus.ts` -> `relay-hocuspocus.ts`,
`client-attempt-a-hocuspocus.ts` -> `client-hocuspocus.ts`; brief 02's
working custom relay/client renamed `relay.ts`/`client.ts` ->
`relay-custom.ts`/`client-custom.ts` (kept, unchanged in substance, as the
`relay: 'custom'` alternative). Extended `relay-hocuspocus.ts` with
`onChange` -> `recordAttribution` wiring, `--debounce`/`--maxDebounce`/
`--no-attribution` args, and a SIGTERM handler (`flushPendingStores`) for
gate G. Extended `harness.ts`'s `startRelay()` with a `relay` flavor param
selecting which script to spawn. Updated every import across
gates/gateA.ts, gateB.ts, gateC.ts, gates/lib/edits.ts accordingly; gateA.ts
takes a `relay` param and is run on both flavors per the brief; gateB.ts/
gateC.ts default to Hocuspocus.

Ran gate A on both flavors, then gate B and gate C (full 266-file corpus)
against Hocuspocus: gate A both PASS (~22-23ms median either way, no
material difference); gate B PASS; gate C path A 266/266, path B 234/266 --
**identical to brief 02's custom-relay numbers**, confirming the relay
switch changed nothing about the underlying binding bug (see task 2 below).
Encoded state size (task 6): 18.73-18.74MB across runs, matching brief 02's
18.70MB (small run-to-run variance, not a relay difference).

## 11:05 -- task 2: gate B3

Ran the orchestrator's probe (`scratch/probe-atom-mark-change.ts`, already
present) directly: `npx tsx scratch/probe-atom-mark-change.ts` and
`... url-too`. Cases 0-2 pass; case 4 (whole-doc replace) only fails when
BOTH the image's own `url` attr and its `link` mark's `href` change
together (the `url-too` variant) -- confirms this is exactly the scenario
the brief's gate B3 cases 3-4 (its own numbering) test. Wrote
`gates/gateB3.ts` (ported from stack 13's, using `@y/prosemirror` +
`client-hocuspocus.ts`), ran it live against the Hocuspocus relay: same
result as the headless probe -- cases 0-2 PASS, cases 3-4 FAIL with the new
`url` landing but the OLD mark kept, reproducible.

Tried to find the responsible code cheaply, per the brief: temporarily
instrumented a local copy of `node_modules/@y/prosemirror/src/sync-utils.js`
(reverted immediately after) to log which branch of `pmNodeDiff`'s
single-child decision ran. Confirmed the failing cases DO take the
"structural window" `delta.diff` branch (over `windowDelta`'s
`marksToFormattingAttributes(c.marks)` per-child inserts), not the
"modify in place" fast path that skips marks by construction -- so the
loss happens one layer deeper, inside `lib0`'s own generic `delta.diff`
(`node_modules/lib0/src/delta/delta.js:4473`), which this brief's budget
did not extend to fully bisecting (diminishing returns for a spike
finding). Reported gate B3 as FAIL with this detail, not worked around, per
the brief -- this is the correct, literal reading of "report it as FAIL
with the detail; do not work around it."

## 11:20 -- task 3: gate G

Ported stack 13's gate G (four scenarios: G1 SIGTERM restart, G2 SIGKILL
before/after the debounce, G3 edits while the relay is down, G4 offline
editor with overlapping edits including a same-image link conflict) onto
`client-hocuspocus.ts`/`relay-hocuspocus.ts`. All four scenarios PASS on
the first real run (the relay's SIGTERM handler and debounce args added in
task 1 made this straightforward -- the harness/relay plumbing was already
proven by gate A/B/C).

## 11:30 -- task 4a: gate E, server-side attribution

Read `@y/y`'s exports (`createContentIdsFromUpdate`, `IdMap`,
`createIdMapFromIdSet`, `createContentAttribute`, `mergeIdMaps`,
`encodeIdMap`/`decodeIdMap`) and confirmed the shape against
`yjs-attributing.md`'s own worked example before writing anything. Wrote
`src/attribution.ts` using these instead of a hand-rolled map, per the
brief's explicit ask ("use it instead of a hand-rolled map, persist it, and
say which you used and why" -- see that file's own header for the design
account). Hit and fixed real API-surface gaps along the way: `@y/y`'s
`Doc` has no more `getMap`/`getText`/`getXmlFragment` (every shared type is
`.get(name)`, a unified `YNode`); a node used as an attribute bag needs
`getAttr`/`setAttr`, not `.get`/`.set` (found via `npx tsc --noEmit`,
fixed).

Ported stack 13's gate E's listing/collision/reconnect/reload/restart/size
checks onto the new API. First full run: the collision check FAILED
(`flagged=false groundTruthKept=true log=[]`) -- the forged update never
reached `recordAttribution` at all. Debugged with a headless scratch probe
(`scratch/probe-collision.ts`): forging a raw update under alice's real
clientID by starting a brand-new empty `Y.Doc` and reassigning its
clientID makes that doc's own clock for the client start at 0, which
**collides** with the clock range alice's real edits already occupy in the
actual document (she'd already made a real edit before her clientID was
captured for the forgery). Yjs treats an update whose structs are already
fully known as redundant and produces an EMPTY outgoing update (nothing new
to broadcast) -- so `createContentIdsFromUpdate(update).inserts.isEmpty()`
is true and `recordAttribution` returns immediately, silently. Confirmed
with the probe's two side-by-side attempts (kept, not deleted, since the
gate's own comment references it): fix is to sync the forging doc with
alice's CURRENT full state FIRST (a real attacker who can read the synced
document has this too), so its clock bookkeeping continues genuinely new
values. Re-ran gate E: collision check now PASSes.

Second bug found on the FULL (non-quick) run: the reconnect check asserted
`>= 2` merged ranges for alice after her post-reconnect edit, using
`listAttributedRanges`'s OUTPUT (which merges adjacent same-(user,
timestamp) runs for readability) rather than a raw per-character range
count the way stack 13's original check (on a different underlying
structure) did -- a single short edit can legitimately merge into ONE
range if every character's server-receive timestamp happens to land in the
same millisecond. Fixed the check's actual intent (her post-reconnect edit
IS visible and attributed to her, under the SAME clientID) rather than an
implementation-detail count. Re-ran the full gate E: all 5 checks PASS,
attribution overhead ~25-30% of a small test document (absolute bytes tiny
at this scale).

## 12:05 -- task 4b: gate E, suggestion mode

Read `yp-ATTRIBUTION.md`/`yp-CAVEATS.md` in full and the upstream Tiptap 3
demo's `main.js`/`extensions.js` before writing anything (per the brief).
Added the four canonical `y-attributed-*` marks to `src/schema.ts`
(additive only; scoped -- see the README's own account of exactly what was
and wasn't needed for this scenario, since it stays entirely inline and
never suggests a whole block).

Wrote `scratch/probe-suggestion-mode.ts` first, iterated there before
promoting to a gate. **Attempt 1** (`Y.createDiffRenderer` with an
`attributions` ContentMap tagged with `createContentAttribute('insert'/
'delete', 'bob')` AFTER bob's edits already ran): every mark's `userIds`
came back empty. Traced it: `DiffRenderer` reads the ContentMap fresh, by
closure, inside its OWN `beforeObserverCalls` listener, but that runs AT
THE TIME OF EACH TRANSACTION and permanently bakes in whatever attribution
existed at that exact moment -- populating the map afterward was too late
for edits that already happened. **Attempt 2** (fixed): register our own
`beforeObserverCalls` listener on `suggestionDoc` BEFORE constructing the
`DiffRenderer` (whose constructor attaches its own listener for the same
event) -- Yjs fires same-event listeners in registration order, so tagging
`tr.insertSet`/`tr.deleteSet` from our listener always runs first. Re-ran:
`userIds: ["bob"]` on every mark (insert, delete, format/link), correctly.

Verified `acceptChanges`/`rejectChanges` (found and fixed one more probe
bug: an earlier position calc via `textContent.indexOf` under-counts
positions after the image atom, producing a wrong accept range -- fixed by
finding real doc positions via `descendants`, matching the pattern gate
B3's own helpers already used). With that fix: reject correctly restores
the deleted word, accept correctly keeps the insert as real content, and
only the explicitly-accepted change reaches the live document -- the
untouched link/format suggestion stays pending, as it should.

Checked the serialization-leak question directly: `serializeDoc` (spike
1's serializer) THROWS `Cannot handle unknown node
\`y-attributed-format\`` on any doc still carrying an unresolved
`y-attributed-*` mark -- confirmed this is a real, load-bearing finding (a
real integration must strip these marks before serializing, or resolve
every suggestion first).

Promoted the (now-working) probe into `gates/gateE-suggestion.ts`, wired
into `gates/gateE.ts`'s `runGateE` as a `suggestionMode` field. All checks
pass.

## 12:35 -- task 5: gate D, Tiptap 3

Checked npm directly before writing anything:
`npm view @tiptap/extension-collaboration peerDependencies` ->
`{ yjs: '^13', '@tiptap/y-tiptap': '^3.0.7' }`, hard-pinned; `npm view
@y/tiptap` / `@tiptap/y-prosemirror` / `@y/y-tiptap` all 404. Confirms the
brief's expectation: no Tiptap collaboration package works with Yjs 14.

Wrote `src/tiptapExtensions.ts` (the generic schema converter, copied
unchanged in substance from stack 13's -- it's schema-agnostic) and
`src/tiptapClient.ts`: three small custom `Extension.create()` wrappers
around `@y/prosemirror`'s `syncPlugin`/`yCursorPlugin`/`yUndoPlugin`
directly (~35 lines total, with line counts per extension in the file's
own header), following the upstream demo's own pattern and its own stated
reason for the same choice. Wrote `gates/gateD.ts` (dedupe check, schema
equivalence, gate B's script through two Tiptap editors, caret, undo).

First full run FAILED (`waitUntil` timeout) -- traced to a copy-paste gap:
`runConvergence`/`runCaretAndUndo` were missing the `fs.rmSync(dbPath, {
force: true })` calls stack 13's version has at the start of each, so a
second run in the same session reused a previous run's already-edited
SQLite state and the script's positional searches (or its convergence
wait) never resolved against content that didn't match what the script
expected. Fixed (added the missing `rmSync` calls); re-ran: all 7 checks
PASS (dedupe, schema equivalence, convergence, caret both ways, undo
isolation).

## 12:50 -- task 7: runner and README

Wrote `scripts/gates.ts` (gate A on both relay flavors; B, C against
Hocuspocus with the task 6 size confirmation; new rows for B3, D, E, G).
Rewrote `README.md`'s "Relay decision"/"Layout"/"Gates"/"Known
limitations" sections to cover everything above.

Definition of done, run from a clean state:
- `rm -rf node_modules && npm ci`: clean, postinstall dedupe assertion
  passes.
- `npm run gates:quick`: **PASS** except B3 (documented, expected per the
  brief).
- `npm run gates` (full corpus, full D/E/G): **PASS** except gate C path B
  (234/266, the same pre-existing upstream bug brief 02 already documented,
  confirmed unchanged by the relay switch) and gate B3 (as above). Every
  other row -- A (both flavors), B, D, E (including suggestion mode), G --
  PASS.
- `npx tsc --noEmit`: clean, 0 errors.
- `lsof -nP -iTCP:4240-4269 -sTCP:LISTEN`: empty, checked directly after
  every relay-touching run in this brief, including the failing gate D run
  during debugging.
- `compat/`: untouched this brief, not re-verified (brief 02's own
  definition-of-done check already covers it and nothing here changed it).

All eight ordered tasks in the brief done (relay, B3, G, E part a, E part
b, D, gate C addition, runner/README). Stopping point reached. Committing
next with explicit paths, no push, no further agents launched.
