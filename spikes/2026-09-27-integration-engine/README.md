# Spike 6: the integration engine

Status: in progress (`src/markdown/`, `src/crdt/`, `src/git/`, `src/engine/`, `src/testkit/`, `src/relay/` built, with gates A-H and the gate runner (milestone 2 complete: head poller, rebase-on-commit, forgery fix, gate H's serializer/parser fixes); `src/daemon/` not yet)

The headless engine that runs Phraise's whole loop in one codebase: open a
file from a git remote, edit it together, comment, flush drafts, commit,
absorb an external commit, return from offline, and edit the same document
as a file through a daemon. See the charter and plan for the full design:
[charter](../../context/plans/2026-09-27-spike-6-charter-integration-engine.md),
[plan](../../context/plans/2026-09-27-spike-6-plan.md).

## Purpose

Five earlier spikes each proved one part in isolation (markdown model,
CRDT rebase, daemon file sync, GitHub storage, the Yjs 13/Hocuspocus 4.7
stack). This spike **copies** what each proved and integrates it into one
module layout with clear boundaries, so the whole loop can be tested
together, headless, against a local bare git repository as the remote.

## How to run

```sh
cd spikes/2026-09-27-integration-engine
npm ci
npm test              # vitest unit tests, fast (handwritten-corpus tests always run)
npm run typecheck      # tsc --noEmit
npm run fetch          # populate corpus/fetched/ (gitignored); gate scripts fetch it if missing
npm run gates          # full gate suite, prints a results table, writes results/gates.{md,json}
npm run gates:quick     # same gates at small/fast sizes
```

Definition of done for brief 04 (milestone 1, gates A-E), brief 06
(milestone 2, gates F-G) and brief 07 (milestone 2, gate H -- serializer
and parser fixes): `npm test`, `npm run typecheck` and `npm run
gates:quick` pass. Gates A-H each report pass in the quick run; `npm run
gates:quick` also checks with `lsof` that nothing is left listening on
4300-4399. The full `npm run gates` (gate E2
at 50 corpus files instead of 10) is the orchestrator's to run at the
milestone boundary, per the charter ("long verification runs belong to the
orchestrator") -- it was run once here during development (50 files, 94
edits, 0 containment violations) and is otherwise not re-run on every
change. Corpus tests/gates that need `corpus/fetched/` skip (or, for gate
E2, fail with a clear message naming `npm run fetch`) when it is absent;
the handwritten corpus tests always run.

## Layout

```
src/
  markdown/   Block-preserving Markdown document model: parse, serialize, schema,
              style, compare. Pure functions on ProseMirror nodes. No Yjs import.
  crdt/       THE ONLY MODULE THAT IMPORTS yjs, y-protocols or @tiptap/y-tiptap.
              The five-point CRDT interface (plan section 3).
  engine/     Rebase, import of a saved text, needs-review flags and resurrection,
              comments (D3 anchor record), attribution listing, commit prep.
              Uses crdt + markdown only; never imports yjs itself.
  git/        Git storage against a remote given by URL/path: head polling, read
              file at commit, draft flush/restore (lease), commit (lease).
              Shells out to the git CLI via plumbing in a bare cache repo
              (no working tree). No Yjs.
  relay/      Hocuspocus server as a library (startRelay) plus cli.ts. Auth stub,
              forged-identity rejection, open-and-seed/restore, draft flusher,
              commit. HTTP control API. See src/relay/README.md.
  daemon/     (not yet built) File materialization on top of engine + crdt.
  testkit/    Temp dirs, PRNG, tokens, waitFor, corpus loader, port allocation
              (4300-4399), temp bare git remotes and clones (`remote.ts`), a
              tiny in-test hub exchanging CrdtDoc updates in causal order
              (`hub.ts`), a live jsdom editor client (`editor.ts`, `edits.ts`),
              a relay harness in-process or child-process (`relayHarness.ts`).
              May import anything in src/; src/ never imports testkit.
gates/        gates/index.ts runs gates A-H and prints a results table; writes
              results/gates.{md,json}; gates/<letter>.ts for I onward land in
              later briefs. gates/lib/ has gate-only helpers (diffHunks.ts,
              topSpans.ts, words.ts, ported from spike 1 for gate E2, reused
              by gate H for spike 1's own gates A and B).
test/         vitest unit tests, one or more per module.
scripts/      fetch-corpus.mjs.
corpus/       manifest, handwritten (checked in), specs list; fetched/ is gitignored.
results/      gates.md, gates.json written by the gate runner.
```

Dependency direction: `markdown` <- `crdt` <- `engine` <- {`relay`, `daemon`};
`git` is standalone. `src/crdt/**` is the only code that may import `yjs`,
`y-protocols` or `@tiptap/y-tiptap` (enforced by
`test/import-boundary.test.ts`). Each `src/<module>/` has its own
`README.md`.

## Origin of copied code

Code is **copied**, never imported across spike directories; every copied
file also carries a first-line comment naming its own origin. Reference
copies of the four source spikes were extracted read-only under
`$REF` (see plan section 1) from:

| Spike | Branch | Commit |
|---|---|---|
| 1. Markdown round trip | `spike/2026-09-27-markdown-round-trip` | `1e1f4a6` |
| 2. CRDT rebase, comment anchors | `spike/2026-09-27-crdt-rebase` | `ab552ed` (read via spike 5's live copy of it, `eeb3fe2`) |
| 3. Daemon file sync | `spike/2026-09-27-daemon-file-sync` | `9343b62` |
| 5. Collaboration stack | `spike/2026-09-27-collab-stack` | `eeb3fe2` |

| File here | Origin |
|---|---|
| `src/markdown/parse.ts` | spike 3 `src/md/parse.ts` (`9343b62`) |
| `src/markdown/serialize.ts` | spike 3 `src/md/serialize.ts` (`9343b62`) |
| `src/markdown/style.ts` | spike 3 `src/md/style.ts` (`9343b62`, identical to spike 5's) |
| `src/markdown/schema.ts` | spike 3 `src/md/schema.ts` (`9343b62`) with `toDOM`/`parseDOM` from spike 5 `src/schema.ts` (`eeb3fe2`) |
| `src/markdown/compare.ts` | spike 3 `src/md/compare.ts` (`9343b62`) with the compare-by-type-name fix from spike 5 `src/compare.ts` (`eeb3fe2`) |
| `src/markdown/render.ts` | adapted from spike 3 `src/core/docsync.ts`'s `renderDetailed` (`9343b62`); serialization half only |
| `src/crdt/codec.ts` | spike 5 `src/yjs.ts` (`eeb3fe2`), itself from spike 1 `src/yjs.ts` (`1e1f4a6`) retargeted to `@tiptap/y-tiptap` |
| `src/crdt/workarounds/leafMarks.ts` | spike 5 `src/workarounds/leafMarks.ts` (`eeb3fe2`) |
| `src/crdt/workarounds/rootAttrs.ts` | spike 5 `src/workarounds/rootAttrs.ts` (`eeb3fe2`) |
| `src/crdt/diff.ts` | spike 3 `src/core/diff.ts` (`9343b62`), itself from spike 2 (`88bd85c`), retargeted from `y-prosemirror` to `@tiptap/y-tiptap` |
| `src/crdt/forkDiffMerge.ts` | adapted from spike 3 `src/core/docsync.ts`'s `DocSync.importText` (`9343b62`): fork/diff/verify/repair/merge only |
| `src/crdt/editorPlugins.ts` | plugin construction/ordering from spike 5 `src/client.ts` (`eeb3fe2`) |
| `src/testkit/prng.ts` | spike 3 `gates/lib/prng.ts` (`9343b62`) |
| `src/testkit/tokens.ts` | spike 3 `src/testkit/tokens.ts` (`9343b62`) |
| `src/testkit/waitFor.ts` | spike 3 `src/testkit/wait-for.ts` (`9343b62`) |
| `src/testkit/corpus.ts` | adapted from spike 1 `gates/lib/corpus.ts` (`1e1f4a6`) |
| `scripts/fetch-corpus.mjs`, `corpus/manifest.json`, `corpus/specs.json`, `corpus/handwritten/*`, `corpus/README.md` | spike 1 (`1e1f4a6`) |
| `src/crdt/blocks.ts` | generalized from spike 2's `integrate.ts` (via spike 5's live copy, `eeb3fe2`, `src/rebase/integrate.ts`) to the full schema |
| `src/crdt/anchors.ts` | generalized from spike 2's `text.ts` (same location) to multiple text runs/inline atoms per block |
| `src/crdt/attribution.ts` | spike 5 `src/attribution.ts` (`eeb3fe2`), retargeted to this spike's naming |
| `src/crdt/integrationHook.ts` | spike 5 `src/rebase/liveIntegration.ts`'s `attachIntegrationHook` mechanics (`eeb3fe2`), integration logic removed; `wouldPend` from spike 2's `replica.ts` (same location) |
| `src/engine/ids.ts` | spike 2's `ids.ts` (same location), generalized to variadic parts |
| `src/engine/seed.ts` | spike 2's `seed.ts` (same location), rebuilt on this spike's crdt interface |
| `src/engine/rebase.ts` | spike 2's `rebase.ts` (same location), rebuilt on `forkDiffMerge`'s `onFork`/`forceFork` |
| `src/engine/integrate.ts` | spike 2's `integrate.ts` (same location), rebuilt on the generalized crdt primitives; S5-5's `ackOwnRebase` behavior ported from spike 5's `src/relay.ts` rebase route |
| `src/engine/comments.ts` | spike 2's `comments.ts` (same location), scoring/acceptance logic close to verbatim |

Files not listed above (`src/markdown/index.ts`, `src/crdt/index.ts`,
`src/crdt/inspectUpdate.ts`, `src/crdt/meta.ts`, `src/crdt/render.ts`,
`src/testkit/ports.ts`, `src/testkit/tmp.ts`, `gates/index.ts`, all of
`test/*`, and the scaffold files) are new for this spike. Brief 02 adds
`src/git/*` (`gitProcess.ts`, `plumbing.ts`, `index.ts`) and
`src/testkit/remote.ts`, also new -- see `src/git/README.md` for its API
and two documented deviations from the plan's stated fetch behaviour.
Brief 03 adds `src/engine/*` (`types.ts`, `import.ts`, `commit.ts`,
`attribution.ts`, `index.ts` -- new, no spike-2/5 equivalent in this shape)
and `src/testkit/hub.ts` (new; the *idea* is spike 2's `replica.ts`, but it
is rebuilt from scratch on crdt's public API since it lives outside
`src/crdt/` and may not import `yjs` itself), plus `test/engine.*.test.ts`.

## Changes to copied code (brief 01)

- `src/markdown/` never imports `yjs`: the former `src/md/yjs.ts` codec is
  gone from this module; its logic moved to `src/crdt/codec.ts` (this
  spike's only Yjs-importing module) under the names `seed`/`read` per plan
  section 3 point 1 (spike 5 named them `docToYDoc`/`yDocToDoc`).
- Dependency `y-prosemirror` is **not** used anywhere; `@tiptap/y-tiptap` is
  used everywhere a Yjs<->ProseMirror binding is needed (`src/crdt/diff.ts`
  and `src/crdt/forkDiffMerge.ts` retarget spike 3's `y-prosemirror` import
  to it).
- `forkDiffMerge` (this spike) is spike 3's `DocSync.importText` with its
  version ring and base-choice logic removed -- those belong to the daemon,
  added in a later brief -- keeping only the fork/diff/verify/repair/merge
  mechanics.
- `recordAttribution`/`authorOf` (plan section 3 point 3) and anchors (plan
  section 3 point 5) are deliberately **not** implemented in this brief;
  see `src/crdt/README.md`.

## Changes to copied code (brief 03)

- Spike 2's schema assumption (a textblock is `paragraph`/`heading`/
  `code_block`, each with exactly one `XmlText`) does not hold on the full
  schema. `src/crdt/blocks.ts` and `anchors.ts` generalize: a textblock is
  any node type whose `isTextblock` is true (checked dynamically against
  `src/markdown`'s schema), its children may be several text runs
  interleaved with inline atoms (`image`, `hard_break`, `raw_inline`), and
  a block's "signature" (change detection) and the document's plain-text
  projection (anchors) both account for that -- see `src/crdt/README.md`.
- `forkDiffMerge` gains `onFork(fork)` (writes records on the fork after
  the diff is verified/repaired) and `forceFork` (see that file's own doc
  comment for why the latter is required, not optional, for a caller like
  engine's rebase).
- `crdt.listMetaEntries`/`crdt.deleteMeta` are added to the "small typed
  accessor" plan section 3 asked for: engine needs to enumerate and delete
  namespaced keys (`rebase:*`, `ack:*`, `editorsSinceCommit:*`), not just
  get/set one key at a time.
- S2-11 (findings doc): a rebase record's id is `hash(baseId, targetCommit)`,
  not `targetCommit` alone -- `engine/ids.ts`'s `rebaseRecordId`.
- S5-5: the replica that computes a rebase acks its own record immediately
  (`engine.ackOwnRebase`), rather than relying on the normal per-remote-batch
  scan to discover it (which may never even run for a purely local
  transaction, and would in any case use a meaningless "before" snapshot for
  an operation this replica performed itself).
- Comment anchors are now opaque, serializable values (base64 of an
  encoded `Y.RelativePosition`, via `crdt.anchorAt`/`resolveAnchor`) instead
  of spike 2's own ad hoc `Y.RelativePosition` JSON plumbing inlined in
  `comments.ts` -- the fuzzy-match scoring/acceptance logic itself (S2-9)
  is unchanged (plain string code, already schema-agnostic).

## Changes to copied code (brief 07: gate H)

Full details, including the actual bugs and root causes, are in
`src/markdown/README.md`'s own "Brief 07 (gate H) fixes" section; this is
the short version.

- `src/markdown/parse.ts`'s `buildDefsContextFromDoc` now reads each
  definition's `attrs.src` instead of PM text content (the footnote-
  continuation parser bug: the two differed after `parseMarkdown`'s
  self-description check replaced a block, making the isolation-reparse
  ctx string inconsistent between when it is called at self-check time
  versus at a later `serializeDoc` call).
- `src/markdown/serialize.ts` gained mark-whitespace normalization
  (`normalizeMarkWhitespace`/`normalizeMarkWhitespaceDeep`, applied once to
  the whole doc at the top of `serializeDoc`), per-occurrence intraword
  `*`-forcing in `pmInlineToMdast` (custom emphasis/strong `.attention`),
  and a de-entify-and-reverify safety net at two call sites -- together,
  concurrent bold/italic toggles over overlapping ranges no longer produce
  numeric character references in the common cases (one narrow residual
  documented, not fixed -- see `src/markdown/README.md`).
- `serializeDoc`'s final reserialize call is now wrapped in try/catch,
  falling back to best effort (`attrs.src ?? textContent`) instead of
  letting an unexpected exception propagate (D9: never throws).
- New `src/engine/renderForSave.ts` (`renderForSave(doc) -> {text,
  degraded}`): `crdt.render` plus `review`-map bookkeeping (reason
  `serialization-best-effort`, set on every currently-degraded block,
  cleared once it serializes cleanly again). Needed a new crdt-side helper,
  `crdt.blocks.ts`'s `textblockIdsAtTopLevel`, to map a top-level degraded
  index (which may name a whole container, not a textblock) to the
  textblock id(s) `review` flags are actually keyed by. `engine.ReviewEntry`/
  `ReviewListEntry`'s `rebaseId` is now optional (a
  `serialization-best-effort` entry has no rebase behind it).
  `engine/commit.ts`'s `prepareCommit` and `relay/flush.ts`'s draft-flush
  render now call `renderForSave` instead of `crdt.render` directly.
- New `gates/h.ts`: spike 1's gates A (byte-identical, A2 PM-JSON round
  trip, A3b through the crdt codec and a binary Yjs update) and B (five
  seeded one-word edits, containment), reusing `gates/lib/`'s existing
  `words.ts`/`topSpans.ts`/`diffHunks.ts`; the four fixes above as
  checks; a 200-seed (50 in `--quick`) randomized concurrent-formatting
  check; and a cache-persistence check (median of 3 cold/warm cycles,
  JIT pre-warmed on unrelated content; gate threshold 3x, looser than the
  dedicated unit test's 5x -- see that check's own comment for why: shared-
  process measurement noise, not a different property being verified).
  Full run reproduces spike 1's own numbers exactly: 294/294 files for
  gate A, 293/293 files (1465/1465 edits) for gate B, matching spike 1's
  findings doc precisely.
