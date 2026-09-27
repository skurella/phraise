Status: active
Author: builder (Sonnet 5)
Updated: 2026-09-27
Related: [brief](../plans/2026-09-27-spike-2-brief-04-loro.md), [plan](../plans/2026-09-27-spike-2-plan.md)

Timezone: local machine time (America, likely PT/ET — using `date` output verbatim per entry).

## Log

### Entry 1 — task received
Read AGENTS.md, brief-04-loro.md, spike-2-plan.md, and the Yjs fork README in full
(especially the "Orchestrator revision" section). Listed the Yjs fork's `src/`,
`test/`, `scripts/`, `fixtures/` layout to plan what to copy vs. reimplement for Loro.

Priority order per brief: 1 (doc layout + round-trip) > 2 (rebase) > 4 (comments) >
5 (attribution) > 3 (integration) > 6 (gates). Budget ~3h; will stop and hand back
partial+honest if exceeded, per brief instruction.

Plan: new package `spikes/2026-09-27-crdt-rebase-loro-fork/`, npm, vitest,
`loro-crdt@1.16.3` + `loro-prosemirror@0.4.4`. Copy (not import) schema, markdown
parsing, diff.ts's two-way tree alignment, fuzz helpers, and fixtures/corpus from
the Yjs fork, noting origin in each copied file's header comment.

### Entry 2 — 06:43, core (item 1: doc layout + item 2: rebase) done, smoke-tested
Scaffolded package.json/tsconfig, `npm install` succeeded (loro-crdt 1.16.3,
loro-prosemirror 0.4.4, both current on npm). Read `node_modules/loro-prosemirror/src/lib.ts`
in full (unminified, ships with the package): document layout is root LoroMap "doc"
(nodeName/attributes/children), exactly matching the plan's spec. Confirmed with
ad hoc `node --input-type=module` scripts (not committed) before writing real code:
- `updateLoroToPmState`/`createNodeFromLoroObj` work headless with a `{doc: pmNode}`
  stand-in for EditorState -- no EditorView/plugin needed. Round-tripped a small
  doc with a mark, `back.eq(pmDoc)` true.
- `LoroText.mark()`/`.unmark()` THROW ("Style configuration missing for ...")
  until `doc.configTextStyle(...)` has been called at least once -- undocumented
  in the .d.ts, not mentioned by any error until you hit it. loro-prosemirror's
  own (unexported) `configLoroTextStyle` does this; reimplemented as
  `configureTextStyle` in `src/loro-doc.ts` since it isn't exported.
- `LoroText.length` is a getter property at runtime, NOT a method, despite the
  shipped .d.ts declaring `length(): number`. Calling `.length()` throws
  "t.length is not a function". Real type-definition bug, noted in README.
- `forkAt(frontiers)` + `setPeerId` + `export({mode:"update", from: vv})` +
  `import()` round-trip correctly (manual merge test passed).
- Frontiers (`{peer,counter}[]`) are plain JSON, usable directly as the `base`
  pointer's "snapshot" -- no encode/decode-to-bytes step Yjs's
  `Y.encodeSnapshot`/`decodeSnapshot` needs. Simplification vs Yjs.

Wrote: schema.ts, markdown.ts (both copied verbatim from the Yjs fork -- pure
PM/Markdown, no CRDT dependency), ids.ts (adapted: Loro PeerID is `${number}`
decimal string, not a 32-bit int), loro-doc.ts (constants + configureTextStyle +
buildLoroNode, since loro-prosemirror only exports `createNodeFromLoroObj`/
`updateLoroToPmState` at the top level, not its lower-level per-container
builders), seed.ts, text.ts, diff.ts (word-granularity two-way diff -- LCS/Dice
alignment copied verbatim from the Yjs fork since it's pure PM logic; the
Loro-mutation half rewritten using LoroText.insert/delete + mark/unmark "clear
then reapply" reformatting; also a "loroprosemirror" comparison granularity
that delegates to the library's own `updateLoroToPmState`), rebase.ts
(computeRebaseUpdate: forkAt + diff + assert eq(pmB) + record + export update).

test/smoke.spec.ts: 3/3 pass -- markdown round-trip through the Loro tree,
deterministic seeding (byte-identical snapshots from two independent seeds),
and a full rebase (A -> B diff, assert equality, export+import into live,
base pointer advanced). All on the first real run, no bugs found in this path
beyond the two loro-crdt rough edges above.

### Entry 3 — 06:50, items 4/5/3 (comments, attribution, integration) done and tested
- `src/comments.ts`: `fuzzyAnchor` copied verbatim from the Yjs fork (pure
  string matching, no CRDT dependency). CRDT half uses `LoroText.getCursor(pos,
  side)` + `doc.getCursorPos(cursor)` (Cursor.encode()/decode() for storage,
  ~9 bytes). Verified: cursor tracks correctly across concurrent inserts
  before it (offset shifted 6->9 after a 3-char insert ahead of it, manual
  test). 2/2 comment tests pass: crdt-resolves through a rebase, falls back
  to orphaned when the anchor block is deleted upstream.
- `src/attribution.ts`: `LoroText.getEditorOf(pos): PeerID` gives
  per-character authorship natively. Real simplification vs. Yjs: the Yjs
  fork had to reimplement `isVisible` and walk `Y.Item` linked lists by hand
  (`collectClientRuns`) since Yjs doesn't export that; here it's one
  documented public method call per character. 1/1 test passes (seed author
  + rebase peer both attributed correctly).
- `src/integrate.ts` (needs-review + resurrection, plan section 5): verified
  container ids are stable across `forkAt` (`fork.getMap(...).get(0).id ===
  original.id` for an untouched container, same identity guarantee Yjs gives
  via item ids with gc:false). So "content of block X at snapshot S" is just
  `live.forkAt(S)` + a tree walk, no isVisible reimplementation needed.
  Extended seed.ts/rebase.ts to also write a permanent `snapshot:<commit>`
  key (frontiers, plain JSON -- no encode/decode needed) alongside the
  overwritten `base` pointer, mirroring the Yjs fork's own two-key scheme, so
  integrate can resolve any past rebase record's A/B frontiers.
  SCOPE CUT (logged per brief's own "only if simple; otherwise measure the
  loss and report" for this item): resurrection appends the resurrected
  block at the end of the ROOT document's children, not the Yjs fork's
  already-simplified "nearest live ancestor". Walking a partially-deleted
  Loro ancestor chain wasn't judged simple enough for the remaining budget.
  2/2 tests pass (mirroring Yjs gate D2 and gate B/C in miniature): a block
  deleted upstream but edited locally by a peer is resurrected, flagged
  `deleted-upstream-edited-locally`, and the rebasing server itself (who
  didn't author the edit) resurrects nothing; a block edited both upstream
  and locally is flagged `concurrent-edit`. One test bug caught and fixed
  along the way: `priorFrontiers` (plan's "P") must be captured right before
  the *rebase* update is applied, not before a local human edit is merged in
  -- got this backwards on the first attempt, which silently made
  `localChanged` false and hid the flag; fixed once traced (not a src bug).

Full suite: 8/8 pass, `npx tsc --noEmit` clean.

Real bugs/rough edges in loro-crdt/loro-prosemirror found so far (going in
README): (1) `LoroText.mark()`/`.unmark()` throw until
`doc.configTextStyle(...)` is called at least once -- undocumented in the
.d.ts. (2) `LoroText.length` is a getter property at runtime, but the shipped
.d.ts declares `length(): number` -- calling it as a function throws.

### Entry 4 — 06:52-07:03, item 6 (gates + mini fuzz) done, README written, all green
- `src/replica.ts`: relay harness using `LoroDoc.subscribeLocalUpdates`
  (fires only for genuinely local commits, never for `.import()`ed content --
  verified against the package's own doc-comment example) instead of Yjs's
  `doc.on("update", ...)`. No relay-storm bug class is possible here by
  construction (nothing auto-re-emits), so no dedup/exclude-sender
  workaround was needed beyond the obvious "don't relay back to whoever
  just sent this". 205 lines vs. the Yjs fork's 355.
- `src/gates/scenario.ts` + `src/gates/index.ts`: gates A/B/C/D/E/F +
  idempotence, consolidated into one file (scope cut from the Yjs fork's
  one-file-per-gate layout, logged). Two bugs caught and fixed while
  building these, both my own, not product bugs:
  1. Gate B originally quoted "original plan" -- but "original" is exactly
     the word the rewrite changes, so jsdiff's word-level diff legitimately
     deletes it; the CRDT anchor for that word cannot survive by
     construction. Fixed by quoting "the rollout" (text untouched by the
     edit) -- this is the correct thing for gate B to test, not a workaround.
  2. `src/fuzz/mini.ts`'s first F-violation check compared block texts by
     plain-text SET MEMBERSHIP across two independently freshly-parsed
     Markdown strings (mdA/mdB), with no identity -- so any block alice's
     random token happened to land in produced a false "F-violation" (~90%
     of trials failed). Fixed by switching to the same identity the real
     integrate.ts/gate F use: `forkAt(storedFrontiers)` + block container
     id, not text-set membership. After the fix: 200/200 trials clean.
- Verified Loro has the exact same "human-vs-human concurrent
  delete-vs-edit loses data" behavior the Yjs fork found and root-caused
  (its README, "Real bugs found"): hand-written repro (bob deletes a
  paragraph block; carol concurrently inserts "CAROL_TOKEN " into that same
  paragraph on her own independent fork; merge both into a fresh replica) ->
  `{"nodeName":"doc","children":[]}`, CAROL_TOKEN and the whole paragraph
  gone. Confirms this is inherent to tree-CRDT delete semantics generally,
  not a Yjs-specific bug, and that neither fork's resurrection mechanism
  (both trigger only on rebase-caused deletes) covers it.
- Measured sizes for the same corpus doc (fixtures/corpus/2026-09-27-agent-
  workflow.md, 8425 bytes markdown) on both forks (Yjs measured from a
  throwaway copy of its src/ in my scratchpad -- never wrote to that spike's
  directory, confirmed via `git status --porcelain` before and after):
  seed snapshot 12,751 (Yjs) vs 24,544 (Loro) bytes (1.93x); one-word rebase
  update 341 vs 436 bytes (1.28x). Loro's snapshot is consistently ~1.9x
  larger, plausibly from wrapping every PM node in a LoroMap with two nested
  attributes/children containers (each a first-class container with its own
  id/metadata) vs Yjs's flatter XmlElement/XmlText encoding.
- LOC: core (schema/markdown/ids/seed/diff/rebase/text[+loro-doc.ts extra
  plumbing]) 915 (Yjs) vs 896 (Loro) lines -- roughly even once loro-doc.ts's
  131 lines of "had to reimplement the library's own unexported per-container
  builders" are counted in. replica.ts 355 vs 205 (fair like-for-like
  comparison, real ~42% reduction).
- Full suite: 10/10 tests pass, `npx tsc --noEmit` clean, `npm run gates`:
  A/B/C/D/E/F/idempotent all PASS, mini fuzz 200/200 trials clean (0
  exception/diverged/local-text-lost/F-violation), ~7.5s total.
- Wrote README.md with the full assessment (goal/status/how-to-run, layout,
  what-was-simpler/harder, bugs found, sizes, LOC, scope cuts, non-scope).

## Handback

See message to caller (spike orchestrator) via SubagentHandback, under 300
words per the brief's format: gate table, condensed assessment, commit hash.
