# Log: builder, spike 5, stack 14 rebase (gate F)

Status: in-progress
Author: builder (Sonnet 5)
Updated: 2026-09-27
Plan: [spike 5 plan](../plans/2026-09-27-spike-5-plan.md)
Brief: [brief 06](../plans/2026-09-27-spike-5-brief-06-stack14-rebase.md)

Time zone: local machine time, from `date`.

## 14:38 — task received, read AGENTS.md, brief 06, plan, charter rules
## 14:47 — task 1 in progress: copied schema.ts, ids.ts, markdown.ts unchanged (pure PM/markdown-it, no Yjs) from stack13's src/rebase/ (origin: spike 2, branch spike/2026-09-27-crdt-rebase, commit 88bd85c)
## 14:51 — de-risking probe (scratch/probe-rebase-primitives.ts): every Yjs14 primitive the port needs, verified empirically before writing the real port

Added deps: markdown-it, prosemirror-markdown, approx-string-match (+
@types/markdown-it), same three brief05 added for stack13 (spike 2's code
needs them). `npm install` clean, postinstall dedupe still OK.

Copied schema.ts, ids.ts, markdown.ts from stack13's src/rebase/ unchanged
(pure PM schema / hashing / markdown-it -- no Yjs API surface at all, so
"the pure parts" from task 1's instruction). Origin: spike 2, branch
spike/2026-09-27-crdt-rebase, commit 88bd85c (via stack13's own copy).

Before writing seed.ts/text.ts/comments.ts/diff.ts/rebase.ts/integrate.ts,
wrote scratch/probe-rebase-primitives.ts to verify, by running actual code
against this package's real @y/y 14.0.0-rc.26 + @y/prosemirror 2.0.0-13
(not by reading docs alone), every primitive the port depends on:

1. Deterministic seeding: `doc.clientID = seedPeerId(...)` then
   `ytype.applyDelta(pmnodeToDelta(pm))` under a fixed clientID -- two
   independent seeds of the same commit produce byte-identical
   `Y.encodeStateAsUpdate` output. PASS.
2. Y.Node as a Y.Map replacement (stack13's PHRAISE_MAP/AUTHORS_MAP): a
   dedicated node (`doc.get('phraise')`) used purely as an attr bag via
   `setAttr`/`getAttr`/`forEachAttr` -- same pattern src/attribution.ts
   (brief 04) already uses in production-tested-in-this-spike code. PASS,
   including enumeration (needed to find every `rebase:*` key, mirroring
   stack13's `phraise.forEach`).
3. `Y.createDocFromSnapshot` on this stack's `Doc`/`Snapshot` (same
   `{sv, ds}` shape as Yjs13's, `ds` now an `IdSet` not a `DeleteSet`) --
   forks a live doc at a snapshot and reads back exactly the seeded
   content, attrs included. PASS. This is the SAME mechanism stack13's
   rebase.ts already relies on; confirmed it still exists, same signature,
   on `@y/y`.
4. **Task 2's diff emitter, resolved**: `pmDocDiff` -- the exact function
   `@y/prosemirror`'s own `syncPlugin` calls on every keystroke
   (`rdt/prosemirror.js`'s `pull()`) to turn a PM document change into a Y
   delta -- is NOT re-exported from the package's public `index.js` (only
   `docToDelta`/`nodeToDelta`/etc. are), and its `package.json` "exports"
   field blocks reaching into `src/sync-utils.js` directly. Used the
   brief's own named fallback instead, and it works cleanly: `lib0/delta`'s
   own `diff()` (public) applied to `docToDelta(pmA)`/`docToDelta(pmB)` --
   confirmed by reading `lib0/delta/delta.js` that `diff()` already
   recurses into matched children via `modify` on its own
   (`applyChangesetToDelta` calls `diff()` recursively per paired hunk), so
   this is NOT a cruder text-only diff -- it is the SAME word/line/char
   granularity structural diff `pmDocDiff`/`pmNodeDiff` uses internally
   (confirmed by reading `pmNodeDiff`'s own source: for anything but its
   single-paired-child fast path, it delegates to this exact `delta.diff`
   call), just computed as one whole-document diff instead of pmDocDiff's
   incremental changed-window optimization -- lib0's own doc comment
   guarantees identical convergence, differing only in op-split in "rare
   ambiguous windows". Applied via `ytype.applyDelta(change)`; fork content
   read back (`ynodeToPmnode`) `.eq()` the target commit exactly. PASS.
   **This means task 2 is done in one attempt, not two**: the brief's own
   "preferred" (word-level, per-block, uses the binding's own encoding) and
   "fallback" (delta.diff against pmnodeToDelta(pmB)) approaches turn out to
   be the SAME mechanism once `pmDocDiff`'s private wrapper is unavailable
   -- lib0's `diff` already gives per-block-equivalent recursive structural
   diffing at word granularity (line separator, then
   `patience.smartSplitRegex` word splitting, then char, confirmed by
   reading `delta.js`'s `diff`), using `@y/prosemirror`'s own
   `docToDelta`/`nodeToDelta` encoding for every node/mark, so whatever it
   writes is the same shape the binding itself would write.
5. `Y.Node#getAttrs(snapshot)` -- confirmed it takes a raw `Y.Snapshot`
   directly (read `ynode.js`: `nodeMapGetAllSnapshot` walks `_map` entries
   by `snapshot.sv`/`.ds`) and correctly excludes an attr written after the
   snapshot. PASS.
6. Yjs14's own private `isVisible(item, snapshot)` (read from `ynode.js`,
   not exported) uses `snapshot.ds.hasId(item.id)` where Yjs13 used
   `Y.isDeleted(ds, item.id)`. Confirmed `IdSet.hasId(id)` exists and a
   hand-rolled `isVisibleAt` using it matches expected visibility. This is
   the one integrate.ts primitive with no public equivalent, so it is
   reimplemented (mechanical rename from stack13's version, verified
   against the private original's own logic by reading it directly). PASS.
7. `Y.createRelativePositionFromTypeIndex`/`createAbsolutePositionFromRelativePosition`
   work UNCHANGED on a `Y.Node` (same signature, same `_start`/`.right`
   walk internally, confirmed by reading `RelativePosition.js`) -- spike
   2's schema has no inline atoms, so a textblock's own Y.Node content IS
   its text (no nested XmlText to find), which actually SIMPLIFIES
   comments.ts's anchoring vs stack13. PASS.
8. `Y.Node#clone()` for resurrection (stack13 hand-rebuilds a fresh
   XmlElement/XmlText op-by-op; Y14 has a built-in `clone()`). First
   attempt at testing it was wrong logged here so it isn't mistaken for a
   real bug later: comparing `clone().toDelta()` against the original
   immediately after cloning reads back EMPTY -- `clone()`
   (`cpy.applyDelta(this.toDeltaDeep())`) hands content to a still-detached,
   doc-less node, and the `_prelim`/`warnPrematureAccess` machinery defers
   materializing it until the node is actually integrated somewhere. Fixed
   by inserting the clone directly (`ancestor.insert(index, [clone])` --
   confirmed a content-array entry accepts a raw detached `Y.Node`,
   mirroring legacy `YXmlFragment.insert(idx, [xmlElement])`) and reading
   back afterwards: content matches exactly. PASS. This replaces stack13's
   whole hand-rolled `buildYNode`-style reconstruction in `resurrect()`
   with one `.clone()` call.

All 8 areas verified by running real code against the real package (per the
charter: "verify claims that have consequences by running the check
yourself"), not by reading source/docs alone. Moving to writing the real
port: text.ts, seed.ts, diff.ts (task 2, via docToDelta+lib0 diff),
rebase.ts, integrate.ts, comments.ts, gates/*.
## 15:00 — tasks 1-3 (headless portion) done: full src/rebase/ port, spike 2's own gates A-D2+idempotent all pass first attempt

Wrote (all new files in the stack14 package):
- src/rebase/text.ts, seed.ts, diff.ts, rebase.ts, integrate.ts, comments.ts,
  replica.ts (ported from stack13, with the Yjs14 API changes established
  by the probe: Y.Node instead of Y.XmlElement/Y.XmlText, doc.get(name)
  instead of getMap/getXmlFragment, setAttr/getAttr/forEachAttr instead of
  Y.Map, ContentString/ContentFormat/ContentType item-chain walks instead
  of XmlText internals, Y.Node#getAttrs(snapshot) built in, hand-rolled
  isVisibleAt (ds.hasId) as the one primitive with no public equivalent).
- src/rebase/gates/{types,convergence,scenario,gate-a-c,gate-b,gate-d,gate-d2,gate-idempotent}.ts
  (mechanical ports; gate-b.ts adapted -- see below).
- scripts/rebase-baseline.ts + `npm run rebase:baseline`.

Two real design departures from stack13's port, both logged in the files'
own headers too:

1. **diff.ts (task 2) does not port stack13's hand-rolled LCS+Dice-similarity
   diff at all.** `@y/prosemirror`'s own binding calls a private function,
   `pmDocDiff`, to do exactly this job on every keystroke -- but it is not
   exported from the package's public API (checked `index.js` and the
   package's `exports` field before relying on either). Per the brief's own
   named fallback, this file instead calls `lib0/delta`'s own public
   `diff()` on the two documents' canonical `docToDelta()` snapshots.
   Verified by reading `lib0/delta/delta.js` that this is NOT a cruder
   substitute -- `diff()` already recurses into matched children via
   `modify`, and aligns text at line/word(`patience.smartSplitRegex`)/char
   granularity, which is the exact same call `pmDocDiff` itself delegates to
   internally for any non-trivial window. So the brief's "preferred"
   (word-level, per-block, binding-shaped) and "fallback" (delta.diff
   against pmnodeToDelta(pmB)) approaches turn out to be the SAME mechanism
   here -- task 2 needed one attempt, not two. Verified empirically
   (scratch/probe-rebase-primitives.ts) before writing diff.ts: fork content
   after diff+applyDelta reads back exactly equal to the target commit.
2. **gate-b.ts is adapted, not ported verbatim.** Stack13's gate B forced
   three different diff granularities (word/char/block) to show word/char
   preserve a comment's CRDT anchor while block (a no-diffing whole-text
   replace) destroys it. This stack's diff.ts has one algorithm with no
   granularity knob, so there is no way to force "destroy the anchor" that
   way. Adapted to verify what's left to test for this stack (the anchor
   SURVIVES an in-place rewrite); the "anchor breaks, falls back to fuzzy"
   case stack13's block-mode demonstrated is still covered, by gate C's own
   (harder) scenario -- a whole paragraph deleted, not just re-diffed.

`npx tsc --noEmit`: clean (one real type error caught and fixed:
`newBlock._item` is nullable per @y/y's own types; added a throw-if-null
guard in integrate.ts's resurrect(), matching the "a newly-inserted node
always has an _item" invariant the code relies on).

`npm run rebase:baseline`: **6/6 pass on the first run** -- A, B (adapted),
C, D (6 permutations + 50 shuffles), D2 (resurrection), idempotent. No
gate needed a second attempt or a workaround.

Task 3's remaining half (live: liveIntegration.ts, liveClient.ts, relay
/rebase route + seeding + gc:false) and task 4/5 (gate F, wiring, README)
next.
## 15:04 — task 3 (live half) + task 4 done: liveIntegration.ts, liveClient.ts, relay rebase route/seeding/gc:false; existing gates still pass

Wrote src/rebase/liveIntegration.ts (near-verbatim port of stack13's --
beforeTransaction/afterTransaction, Y.snapshot, doc.clientID are all
unchanged on @y/y's Doc, confirmed by reading Doc.js before relying on it)
and src/rebase/liveClient.ts (adapted to this stack's own binding:
@y/prosemirror's syncPlugin/configureYProsemirror on PM_FRAGMENT with
spike 2's schema, same pattern as src/client-hocuspocus.ts, plus the
integration hook attached before the first sync completes).

Extended src/relay-hocuspocus.ts (existing file, not a new one -- brief
allows extending the stack 14 directory):
- yDocOptions: {gc:false, gcFilter:()=>false} added to the Server config
  (previously absent). Checked first that no existing gate (A/B/C/B3/D/E/G)
  references gc/gcFilter at all, so this is safe to apply relay-wide (same
  scope stack13 used).
- splitDocName gains a 'rebase' kind alongside 'file'.
- onLoadDocument: attachIntegrationHook(document, {isRemoteOrigin:
  isConnectionOrigin}) once per doc (WeakSet-guarded), for every doc kind;
  rebase: docs seed from <seeds>/rebase/<name>.md via seedDoc, checking
  spike 2's own 'pm' fragment for emptiness (not spike 1's 'prosemirror').
- onRequest: POST /rebase/<docName> {targetMarkdown, targetCommit,
  authorName?, authorEmail?} -- 404 if not loaded; idempotence checked by
  reading the doc's own PHRAISE_MAP 'base' attr before calling
  computeRebaseUpdate; applies via Y.applyUpdate(..., 'rebase'); then
  immediately acks the relay's own clientID in a synchronous follow-up
  transaction -- porting stack13's own relay-ack fix (its brief-05 log
  entry) proactively, since the same root cause (relay's clientID never
  acks its own authored record, so the NEXT unrelated connection-sourced
  transaction takes a stale P and false-flags every upstream-touched block)
  applies identically here; no reason to rediscover it by reproducing the
  bug first.

Verification: `npx tsc --noEmit` clean. `npm run gates:quick` re-run
after these relay changes: every existing gate's result is UNCHANGED
(A/B/C/D/E/G still PASS, B3 still fails cases 3-4 exactly as before --
that FAIL is pre-existing/expected per the README, not something this
brief's changes caused). `lsof -nP -iTCP:4240-4269 -sTCP:LISTEN` empty
after the run.

Next: write gates/gateF.ts (porting stack13's scenario/checks onto this
stack's liveClient/relay), wire into scripts/gates.ts, README.
## 15:07 — task 4 done: gate F, all sub-checks pass including the continuous-typing variant, first attempt

Wrote gates/gateF.ts (ported from stack13's own gate F, same scenario:
scenario.ts's MD_A -> MD_B, alice online, bob offline, three comments
planted at commit A) and scripts/run-gate-f.ts (ports 4257/4258, unused by
scripts/gates.ts's existing A-G rows at 4240-4256).

All sub-checks pass on the FIRST run (`npx tsx scripts/run-gate-f.ts`):
- Rebase applied while alice online, bob offline: {"applied":true}.
- Convergence: alice, bob, relay identical ProseMirror JSON and identical
  review state (Y.Node attr bag, not a Y.Map -- `getAttrs()`).
- A: untouched-paragraph comment resolves via crdt, all three agree.
- B: rewritten-paragraph comment ("plan for the rollout") resolves via
  crdt (this stack's lib0-diff keeps the CRDT anchor for unchanged text,
  same as stack13's word-granularity did), all three agree.
- C: deleted-paragraph comment orphans, quote kept exact, negative control
  ("harbor" paragraph) not captured, all three agree.
- D: both P (bob, offline) and Q (alice, online) flagged concurrent-edit;
  BOB EDIT, ALICE EDIT and the server's upstream rewrite all survive on all
  three peers; no unexpected flags (the relay-ack fix, ported proactively
  into relay-hocuspocus.ts's /rebase route in the previous milestone,
  worked correctly the first time -- the untouched heading was NOT
  spuriously flagged).
- D2: P2 (deleted upstream, edited offline by bob) resurrected exactly
  once via the new Y.Node-clone-style resurrect(), flagged
  deleted-upstream-edited-locally, converged.
- Every untouched block equals commit B verbatim on all three peers.
- A retried identical POST -> {"applied":false,"reason":"already at
  target"}, relay's ProseMirror JSON and review state byte-identical
  before/after.
- Continuous-typing variant: alice fires 40 single-character inserts into
  the untouched paragraph with the rebase POST fired mid-burst -- all 40
  land as one intact run, the rebase still applies, alice/bob/relay still
  converge.

No relay left running after the run (`lsof -nP -iTCP:4240-4269
-sTCP:LISTEN` empty). `npx tsc --noEmit` clean.

Unlike stack13's own gate F (which found and fixed the relay-ack bug live,
by running the scenario first), this port needed NO new bug fixes at all --
the relay-ack fix was already ported proactively (previous milestone) since
the root cause (relay's own clientID never acks its authored record) is
identical regardless of Yjs version, and every other primitive had already
been verified individually (headless gates + the probe) before gate F ever
ran. This is worth flagging in the findings/decisions table: porting a
known fix ahead of reproducing its bug fresh was the right call here, not
overconfidence -- it was re-verified end-to-end by this gate passing
outright.

Next: task 5 -- wire gate F into `npm run gates`/`gates:quick`, update
README with the "what changed from spike 2 / stack13" account and line
counts, final commit.
## 15:11 — task 5 done: gate F wired into npm run gates/gates:quick; README updated; definition of done met

scripts/gates.ts: imports runGateF/runGateFContinuousTyping, runs both
after gate G on ports 4257/4258 (documented in the file's own port comment
block), adds a "F. Rebase port (fork-at-snapshot, live)" row to the printed
table/results/gates.md/results/gates.json (gateF/gateF_continuousTyping
keys), replacing the old "F. (later brief), not run" placeholder. Gate F
runs in full under both `gates:quick` and the full `gates` (cheap, ~4s).

README.md: Status/log links updated; "Origin of copied code" gets a brief
06 paragraph; "Layout" gets entries for src/rebase/, liveIntegration.ts,
liveClient.ts, gates/gateF.ts, scripts/run-gate-f.ts,
scripts/rebase-baseline.ts; "Running" gets the rebase:baseline script and
updated timings; a new **F. Rebase port** bullet under "## Gates" with the
full scenario, every sub-check, the charter's own "do fork-at-snapshot and
deterministic client IDs exist, what had to change" question answered
point-by-point (9 items), and line-count comparisons (spike 2 original ->
stack13's port -> stack14's port) for every src/rebase/ file plus
gates/gateF.ts; "Known limitations" gets the gate-b.ts adaptation note and
retires the old "Row F not run" line.

Verification (not assumed): `npx tsc --noEmit` clean; `npm run
rebase:baseline` 6/6 (headless); `npm run gates:quick` full pass table
captured above -- every existing gate's result UNCHANGED from before this
brief's relay changes (A/B/C/D/E/G PASS, B3 still fails cases 3-4 exactly
as documented pre-existing, not a regression), plus the new F row PASS
(main scenario + continuous-typing variant). `lsof -nP -iTCP:4240-4269
-sTCP:LISTEN` empty after every run in this brief. Did not run the full
(non-quick) `npm run gates` against the full corpus -- per the charter,
"long verification runs belong to the orchestrator; a builder is done when
the quick subset passes and the full command is documented" (documented in
README's "Running" section).

Definition of done met: gates:quick passes F; tsc clean; no relay running.
Brief's stopping point ("task 5 done") reached. Preparing handback.
