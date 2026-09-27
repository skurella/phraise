# Spike 6: the integration engine

Status: in progress (foundation: scaffold, `src/markdown/`, `src/crdt/`, `src/testkit/` basics)

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

Definition of done for this foundation brief: `npm ci && npm test && npm
run typecheck` passes from a clean checkout. Corpus tests that need
`corpus/fetched/` skip with a clear message when it is absent; the
handwritten corpus tests always run.

## Layout

```
src/
  markdown/   Block-preserving Markdown document model: parse, serialize, schema,
              style, compare. Pure functions on ProseMirror nodes. No Yjs import.
  crdt/       THE ONLY MODULE THAT IMPORTS yjs, y-protocols or @tiptap/y-tiptap.
              The five-point CRDT interface (plan section 3).
  engine/     (not yet built) Rebase, import, comments, review flags, attribution,
              commit prep, generations. Uses crdt + markdown.
  git/        Git storage against a remote given by URL/path: head polling, read
              file at commit, draft flush/restore (lease), commit (lease).
              Shells out to the git CLI via plumbing in a bare cache repo
              (no working tree). No Yjs.
  relay/      (not yet built) Hocuspocus server as a library plus a thin CLI.
  daemon/     (not yet built) File materialization on top of engine + crdt.
  testkit/    Temp dirs, PRNG, tokens, waitFor, corpus loader, port allocation
              (4300-4399), temp bare git remotes and clones (`remote.ts`).
              May import anything in src/; src/ never imports testkit.
gates/        gates/index.ts runs all registered gates and prints a results table
              (placeholder for now; gates/<letter>.ts land one per brief).
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

Files not listed above (`src/markdown/index.ts`, `src/crdt/index.ts`,
`src/crdt/inspectUpdate.ts`, `src/crdt/meta.ts`, `src/crdt/render.ts`,
`src/testkit/ports.ts`, `src/testkit/tmp.ts`, `gates/index.ts`, all of
`test/*`, and the scaffold files) are new for this spike. Brief 02 adds
`src/git/*` (`gitProcess.ts`, `plumbing.ts`, `index.ts`) and
`src/testkit/remote.ts`, also new -- see `src/git/README.md` for its API
and two documented deviations from the plan's stated fetch behaviour.

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
