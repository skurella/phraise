# Spike 6: the integration engine

Status: in progress (`src/markdown/`, `src/crdt/`, `src/git/`, `src/engine/`, `src/testkit/`, `src/relay/` built, with gates A-G and the gate runner (milestone 2 complete: head poller, rebase-on-commit, forgery fix); `src/daemon/` not yet)

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

Definition of done for brief 04 (milestone 1, gates A-E) and brief 06
(milestone 2, gates F-G): `npm test`, `npm run typecheck` and `npm run
gates:quick` pass. Gates A-G each report pass in the quick run; `npm run
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
gates/        gates/index.ts runs gates A-G and prints a results table; writes
              results/gates.{md,json}; gates/<letter>.ts for H onward land in
              later briefs. gates/lib/ has gate-only helpers (diffHunks.ts,
              topSpans.ts, words.ts, ported from spike 1 for gate E2).
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
