# CRDT rebase, Loro fork approach (brief 4, gate I)

Status: gates A-F, idempotence and a 200-trial mini fuzz all pass (`npm run gates`, ~7.5s).

Goal: implement the same "fork at base, two-way diff, merge" rebase algorithm
from [the spike-2 plan](../../context/plans/2026-09-27-spike-2-plan.md) on
[Loro](https://loro.dev) (`loro-crdt@1.16.3`, `loro-prosemirror@0.4.4`), far
enough to judge against the working Yjs fork
(`spikes/2026-09-27-crdt-rebase-yjs-fork/`, read as reference, not modified)
whether Loro is materially simpler or more correct, how mature
`loro-prosemirror` is, and what switching would cost. This is a fresh,
self-contained package: no imports from the Yjs fork. `schema.ts` and
`markdown.ts` are copied verbatim (pure ProseMirror/Markdown, no CRDT
dependency); `diff.ts`'s tree-alignment half (LCS/Dice matching) and
`comments.ts`'s `fuzzyAnchor` are copied verbatim for the same reason; every
other file is a from-scratch Loro implementation. Each copied file says so in
its own header comment, per the brief's origin-noting instruction.

## How to run

```sh
npm install
npm test          # vitest: 10 tests (seed/rebase/comments/attribution/
                   # integrate/gates + 200-trial mini fuzz)
npm run gates      # prints the gate table + mini-fuzz summary below;
                   # exits non-zero on any failure
npm run typecheck  # npx tsc --noEmit
npx tsx scripts/sizecheck.ts  # reproduces the snapshot/update size numbers below
```

## Gate table (latest run)

| Gate | Pass | Detail |
|---|---|---|
| A | PASS | untouched paragraph's comment resolves `crdt` after rebase + convergence |
| B | PASS | a quote surviving an in-place rewrite resolves `crdt` at word granularity |
| C | PASS | a deleted paragraph's comment resolves `orphaned`, quote kept |
| D | PASS | all 3! = 6 whole-batch delivery orderings converge (PM JSON + review map identical) |
| E | PASS | attribution shows Alice, Bob, the seed author, and the rebase peer |
| F | PASS | every non-flagged block equals commit B's text exactly, by block identity |
| idempotent | PASS | two independent `computeRebaseUpdate` calls produce byte-identical update bytes; re-importing the same update is a no-op |
| mini fuzz | PASS | 200/200 trials: 0 exception, 0 diverged, 0 local-text-lost, 0 F-violation |

## Layout

- `src/schema.ts`, `src/markdown.ts` — copied verbatim from the Yjs fork (no
  CRDT dependency at all).
- `src/ids.ts` — `hash32` copied verbatim; peer-id helpers adapted to Loro's
  `PeerID` (`` `${number}` ``, a decimal-string u64) instead of Yjs's 32-bit
  `clientID`.
- `src/loro-doc.ts` — constants and small helpers
  (`getChildren`/`getAttrs`/`buildLoroNode`/`configureTextStyle`) that exist
  because `loro-prosemirror` only exports its two headless entry points
  (`createNodeFromLoroObj`, `updateLoroToPmState`) and a handful of constants
  (`ROOT_DOC_KEY`, `NODE_NAME_KEY`, `CHILDREN_KEY`, `ATTRIBUTES_KEY`) from its
  public `src/index.ts` — not the lower-level per-container builders
  (`createLoroMap`, `createLoroText`, `getLoroMapChildren`, etc.) that its own
  `src/lib.ts` uses internally. This file reimplements the small pieces our
  own diff needs, reading `node_modules/loro-prosemirror/src/lib.ts` (shipped
  unminified with the package) as the spec for the document layout: root
  `LoroMap` `"doc"`, every PM node a `LoroMap` with `nodeName`/`attributes`
  (`LoroMap`)/`children` (`LoroList`), every run of PM text siblings
  collapsed into exactly one `LoroText` child — the same "one text container
  per textblock" invariant the plan asks for, verified against the library's
  own `createNodeFromLoroObj` reader in `test/smoke.spec.ts`.
- `src/seed.ts` — `seedDoc`/`docToPM`. Seeds via `loro-prosemirror`'s own
  public `updateLoroToPmState`, called **headless** with a
  `{ doc: pmNode }` stand-in for `EditorState` (verified: it only reads
  `.doc`, no `EditorView`/plugin needed — brief item 1's fallback question
  "if loro-prosemirror cannot be used headless" does not apply, it can be).
  Base pointer = `{ id, commit, frontiers }`; `frontiers` (a plain
  `{peer,counter}[]` array) *is* the "snapshot" `doc.forkAt()` needs
  directly, no `encode`/`decode`-to-bytes round trip the way Yjs's
  `Y.encodeSnapshot`/`decodeSnapshot` requires.
- `src/diff.ts` — two-way tree diff, **word granularity** (as the brief asks)
  plus a `"loroprosemirror"` comparison mode that delegates entirely to
  `updateLoroToPmState` (see "What was simpler" below). The alignment half
  (`structuralHash`/`lcsMatches`/`diceSimilarity`/`planGapOps`/`planChildOps`)
  is copied verbatim from the Yjs fork — pure `PMNode` logic. The apply half
  is rewritten: `LoroText.insert`/`.delete` for the word diff (jsdiff
  `diffWordsWithSpace`), then a "clear every schema mark over the whole
  range, reapply each target run's marks" pass via `LoroText.mark`/`.unmark`
  (the brief's specifically-named API) instead of the Yjs fork's one-shot
  `applyDelta` retain pass — `LoroText` has no delta-retain API of that
  shape, so the mark/unmark loop is the natural equivalent.
- `src/rebase.ts` — `computeRebaseUpdate`: `live.forkAt(base.frontiers)` +
  deterministic `setPeerId` + the diff + `result.eq(pmB)` assertion (throws
  otherwise) + `base`/`rebase:<id>`/`snapshot:<id>`/author records +
  `fork.export({mode:"update", from: vv})`. Does not apply to `live` — same
  contract as the Yjs fork.
- `src/text.ts` — `docPlainText`/`offsetToPosition`, walking the `LoroMap`
  tree instead of `Y.XmlFragment`. Unlike `Y.XmlText.toString()` (which
  serializes XML-ish markup), `LoroText.toString()` **is** plain text —
  verified, one less workaround needed here.
- `src/comments.ts` — `fuzzyAnchor` copied verbatim (pure string matching).
  The CRDT half uses `LoroText.getCursor(pos, side)` / `doc.getCursorPos` +
  `Cursor.encode()`/`.decode()` (a ~9-byte opaque handle) in place of Yjs's
  `RelativePosition`/`AbsolutePosition` JSON. Verified a cursor tracks
  correctly across a concurrent insert ahead of it (offset shifted 6→9 after
  a 3-char insert, in an ad hoc script before writing the real code).
- `src/attribution.ts` — `listAttribution`, built directly on
  `LoroText.getEditorOf(pos): PeerID`, which **gives per-character
  authorship natively** — see "What was simpler" below.
- `src/integrate.ts` — needs-review + resurrection (plan section 5). Reads
  block content at a past point via `live.forkAt(frontiers)` + a tree walk;
  container ids are verified stable across `forkAt` (same guarantee Yjs's
  `gc:false` item ids give), so no identity-mapping scheme is needed. A real
  scope cut vs. the Yjs fork (logged, per the brief's own "only if simple;
  otherwise measure the loss" for this item): resurrection appends at the
  end of the **root** document's children rather than the Yjs fork's
  already-simplified "nearest live ancestor" — walking a partially-deleted
  Loro ancestor chain wasn't simple enough for the remaining budget. Sound
  (nothing is lost), just less positionally faithful.
- `src/replica.ts` — a much smaller harness than the Yjs fork's (205 vs. 355
  lines) for a real reason, not just less feature coverage: see "What was
  simpler" below.
- `src/gates/scenario.ts`, `src/gates/index.ts` — the gate scenario (a
  trimmed, 6-block version of the Yjs fork's 10-block/3-list-item fixture —
  a logged scope cut for time) and gates A-F + idempotence, consolidated into
  one file per concern rather than the Yjs fork's one-file-per-gate layout.
- `src/fuzz/mini.ts` — a deliberately much smaller fuzz harness than the Yjs
  fork's brief-3 harness (9 files: corpus windowing, dedicated mutation
  generators for marks/heading-level/list-items, per-category loss
  classification, a granularity-comparison CLI, repro scripts). This one
  covers the same four gated categories (`exception`/`diverged`/
  `local-text-lost`/`F-violation`) with one human + one upstream mutation
  generator (word-replace or whole-block-delete) at word granularity only.
  **What it structurally cannot test** (logged, not glossed over): it has
  only one human, so it can never exercise the human-vs-human
  concurrent-delete-vs-edit interaction the Yjs fork's fuzz found (see
  below) — that was verified separately, by hand.

## Assessment notes

### What was simpler on Loro

- **Attribution is free.** `LoroText.getEditorOf(pos): PeerID` answers "who
  inserted this character" directly and is public, documented API. The Yjs
  fork had to reimplement Yjs's own private `isVisible` from exported
  primitives and walk `Y.Item` linked lists by hand
  (`collectClientRuns`) to get the same answer — Yjs simply doesn't expose
  per-character authorship. `src/attribution.ts` is 78 vs. 81 lines, but the
  *kind* of code is materially simpler (one public method call vs.
  reimplementing private internals).
- **Historical content reads need no identity-mapping design.** Container
  ids are stable across `forkAt`/`checkout` (verified empirically: forking a
  doc and re-fetching an untouched container by the same path yields
  `.id === original.id`), exactly like Yjs's `gc:false` item ids, but without
  Yjs's caveat that this relies on an unexported implementation detail
  (`ContentType.delete` never replacing `.type`, discovered by reading Yjs
  source, per that fork's own comments). Loro's guarantee is closer to being
  part of the documented contract (frontiers/forkAt are first-class,
  documented features).
- **No relay-storm bug class.** `LoroDoc.subscribeLocalUpdates` fires **only**
  for genuinely local commits, never for content that arrived via
  `.import()` — verified against the package's own doc-comment example. The
  Yjs fork's "Real bugs found" section describes a real, painful bug: because
  `Y.encodeStateAsUpdate(doc, before)` always restates the whole delete set,
  a harmless relay could look "new" and start an exponential bounce (19 → 37
  → 57 → 111 queued updates in a handful of rounds) until memory ran out.
  There is no equivalent failure mode possible here by construction, because
  nothing is re-emitted automatically at all.
- **Frontiers as the "snapshot" are just data.** Yjs needs
  `Y.encodeSnapshot`/`Y.decodeSnapshot` to turn a `{stateVector, deleteSet}`
  pair into bytes for storage in a `Y.Map`; Loro's frontiers
  (`{peer,counter}[]`) are already plain, JSON-storable values that
  `forkAt`/`checkout` accept directly.
- **`doc.import()` reports pending dependencies directly**
  (`{success, pending}`), instead of the Yjs fork needing to hand-roll a
  `wouldPend` probe (encode the doc, apply the candidate update to a scratch
  copy, inspect `store.pendingStructs`) to get the same information.
- **`loro-prosemirror` ships its own two-way tree diff-and-patch**
  (`updateLoroMapChildren`/`updateLoroText` in its `lib.ts`, exposed via the
  public `updateLoroToPmState`) — an LCS-from-both-ends child alignment plus
  a `simpleDiff`-based text patch, conceptually the same job as plan section
  3. `diff.ts`'s `"loroprosemirror"` granularity uses it as a one-line
  delegate, for free. For a production system this is a real question worth
  the lead's attention: how much of plan section 3's hand-rolled diff is
  actually necessary once `loro-prosemirror` already ships one, vs. keeping
  our own for the specific properties the plan cares about (configurable
  granularity, exact control over which mark API is exercised).

### What was harder on Loro

- **`loro-prosemirror`'s low-level per-container builders are not exported.**
  Only `createNodeFromLoroObj`/`updateLoroToPmState` and four key constants
  are public; `createLoroMap`/`createLoroText`/`getLoroMapChildren`/
  `getLoroMapAttributes` (used to build/mutate individual containers, which
  our own word-granularity diff needs) had to be reimplemented from reading
  its `src/lib.ts` (131 lines in `loro-doc.ts`). This is real, if modest,
  extra plumbing the Yjs fork didn't need (`y-prosemirror` similarly only
  exports whole-doc helpers, but Yjs's own `Y.XmlElement`/`Y.XmlText`
  constructors are public and sufcient — Loro's `LoroMap`/`LoroList`/
  `LoroText` constructors are public too, but the *layout convention*
  (attributes/children key names, one-LoroText-per-textblock) lives only in
  the unexported helpers).
- **Two rough edges/documentation gaps in the libraries** (found while
  building this, see "Real bugs found" below): `LoroText.mark`/`.unmark`
  throwing until `configTextStyle` is called, and `.length` being a runtime
  getter despite the shipped `.d.ts` declaring it as a method.
- **`loro-prosemirror`'s maturity signal is mixed.** The library is small
  (1979 lines across `lib.ts`+plugins) and clearly built for the
  interactive-editor case (an `EditorView`-driven sync plugin, undo, cursor
  awareness) rather than headless/server-side use; using its two exported
  functions off-label (no `EditorView`) worked cleanly in every test here,
  but that is not a documented, supported mode — a production adoption would
  want to confirm this with the Loro team rather than rely on our own
  probing.

### Real bugs / rough edges found in `loro-crdt`/`loro-prosemirror`

1. `LoroText.mark()`/`.unmark()` **throw** (`"Style configuration missing for
   ..."`) until `doc.configTextStyle(...)` has been called at least once for
   that mark key — not mentioned in the `.d.ts` or raised until you hit it.
   `applyDelta` with attributes does not have the same requirement (used
   only by the initial full-tree build, `createLoroText`'s path). Worked
   around with `configureTextStyle()` in `loro-doc.ts`, reimplementing
   `loro-prosemirror`'s own unexported `configLoroTextStyle`.
2. `LoroText.length` **is a getter property at runtime**, but the shipped
   `nodejs/loro_wasm.d.ts` declares it as a method (`length(): number`).
   Calling `.length()` throws `"t.length is not a function"`. A real
   type-definition/runtime mismatch, not a usage error.
3. (Verified, not a bug, but worth recording precisely): Loro's tree-CRDT
   semantics have the **same human-vs-human concurrent delete-vs-edit data
   loss** the Yjs fork found and root-caused (its "Real bugs found",
   penultimate entry). Minimal hand-written repro, no rebase involved: bob
   deletes a paragraph block while carol concurrently inserts
   `"CAROL_TOKEN "` into that same paragraph's text on her own independent
   fork; after merging both into a fresh replica, `CAROL_TOKEN` and the
   entire paragraph are gone (`{"nodeName":"doc","children":[]}`). This is
   inherent to deleting a container in *any* tree CRDT (deleting a subtree
   discards whatever was concurrently inserted into it, by construction),
   not specific to either library. Neither fork's resurrection mechanism
   covers this case (both only trigger resurrection for a rebase-caused
   delete, not a plain concurrent human delete) — a real, shared, unresolved
   design gap for the plan's algorithm, independent of which CRDT library is
   used.

### Sizes (same corpus document, `fixtures/corpus/2026-09-27-agent-workflow.md`, 8425 bytes of Markdown)

| | Yjs | Loro |
|---|---|---|
| seed snapshot | 12,751 bytes | 24,544 bytes (1.93x) |
| one-word rebase update | 341 bytes | 436 bytes (1.28x) |
| snapshot after rebase | 13,106 bytes | 25,148 bytes (1.92x) |

Loro's snapshot is consistently about 1.9x larger for this document. Plausible
cause (not fully root-caused, given the time budget): Loro's document layout
wraps every PM node in a `LoroMap` with two nested containers
(`attributes`+`children`), each a first-class Loro container with its own id
and metadata overhead, vs. Yjs's flatter `Y.XmlElement`/`Y.XmlText`
representation. The update-size gap is smaller (~28%) since a single-word
change touches few containers either way. This is a real, measurable cost of
`loro-prosemirror`'s document layout worth weighing against Loro's other
advantages for a production choice.

### Performance

200 mini-fuzz trials (each: parse a random corpus window, seed two replicas,
one local edit, one upstream mutation, a full word-granularity rebase,
convergence + drain, all four gated checks) completed in the `npm run gates`
script's ~7.5s total (which also runs gates A-F/idempotence first), for a
mini-fuzz-only rough average of a few tens of milliseconds per trial (see
`npx vitest run test/gates.spec.ts`, which shows ~9s for the same 200 trials
inside vitest's own overhead). No performance red flags for a spike-scale
document; a real benchmark (larger corpus, warmed-up WASM, isolated timing)
was out of scope for the remaining budget.

### Lines of code (core: schema/markdown/ids/seed/diff/rebase/text[+loro-doc])

| | Yjs | Loro |
|---|---|---|
| schema.ts | 65 | 68 |
| markdown.ts | 103 | 91 |
| ids.ts | 27 | 31 |
| seed.ts | 80 | 77 |
| diff.ts | 428 | 322 |
| rebase.ts | 123 | 99 |
| text.ts | 89 | 77 |
| (loro-doc.ts, extra plumbing) | — | 131 |
| **core total** | **915** | **896** |

| | Yjs | Loro |
|---|---|---|
| integrate.ts | 255 | 197 |
| attribution.ts | 81 | 78 |
| comments.ts | 316 | 313 |
| replica.ts | 355 | 205 |

`diff.ts` is smaller on Loro partly because this fork only implements word
granularity + a delegate comparison mode, not the Yjs fork's four
granularities (word/char/block/yprosemirror) — not a fully apples-to-apples
comparison. `replica.ts` being 42% smaller **is** a fair, like-for-like
comparison (same job: relay harness for the gates) and reflects the
simplifications in "What was simpler" above (no relay-storm workaround, no
hand-rolled pending-dependency probe). `comments.ts` is nearly identical in
size mostly because `fuzzyAnchor` (the bulk of the file) is copied verbatim;
the CRDT-anchoring half alone is shorter on Loro (Cursor encode/decode is a
few lines vs. RelativePosition JSON's slightly larger surface). The
gates/fuzz directories are not compared line-for-line at all: this fork's
versions are deliberately, logged-ly smaller in scope (trimmed scenario, one
consolidated gates file, a much smaller fuzz harness — see "Non-scope" and
each file's own header comment) — presented separately so the core-algorithm
comparison above isn't diluted by that scope difference.

## Scope cuts (logged, honest, not silently dropped)

- **Diff granularity**: word only, plus a `"loroprosemirror"` comparison
  delegate. No char/block granularities (the Yjs fork's other two modes).
- **Resurrection position**: appends at the root's end, not "nearest live
  ancestor" (already a Yjs-fork-level simplification, cut one step further).
- **Gate D**: 6 whole-batch orderings, no additional 50 seeded-random
  per-update shuffles (the Yjs fork's stronger version).
- **Gate scenario**: 6 labeled blocks, not the Yjs fork's 10-block/list-item
  fixture.
- **Mini fuzz**: one human + one upstream mutation generator (word-replace
  or whole-block-delete), no marks/heading-level/list mutations, no
  granularity comparison, no chained (B-then-C) rebases. 200 trials as the
  brief asks, but a narrower slice of the state space than the Yjs fork's
  500-trial harness.
- **Not attempted at all**: re-seed (gate G/G2 equivalent — explicitly
  non-scope per the brief), UI, networking (also explicitly non-scope).
- **Not separately verified**: whether Loro's container-delete visibility
  can jump ahead of pending structs during out-of-order delivery the way
  Yjs's delete-set application did (the Yjs fork's root cause for "a chained
  rebase C could hide P2's pre-merge state") — this fork's gate D only
  exercises a single rebase, not a chained one, so this is an open question,
  not a claim either way.

## Non-scope

Diff granularities beyond word (except the `loroprosemirror` comparison
mode), re-seed, UI, networking — all as directed by the brief.
