# Log: builder, spike 6, brief 01 (foundation)

Status: in progress
Author: builder (Sonnet 5)
Updated: 2026-09-27
Plan: [spike 6 plan](../plans/2026-09-27-spike-6-plan.md)
Brief: [brief 01](../plans/2026-09-27-spike-6-brief-01-foundation.md)
Timezone: local machine time (CEST), from `date`.

## 16:13 — task received

Read AGENTS.md, brief 01, charter "Rules for every agent in this spike", and plan sections 1-4 and 9.
Goal: scaffold `spikes/2026-09-27-integration-engine/`, `src/markdown/`, `src/crdt/`, `src/testkit/` basics, unit tests. Stop after task 7.

$REF confirmed present at the scratchpad path from plan section 1, containing all four source spike dirs.

## 16:30 — scaffold, markdown, crdt, testkit written; ready for npm install

Wrote all of task 1 (scaffold: package.json, tsconfig.json, vitest.config.ts,
.gitignore, gates/index.ts placeholder), task 2 (corpus copy: scripts/fetch-corpus.mjs,
corpus/manifest.json, specs.json, handwritten/*, README.md, all from spike 1 1e1f4a6),
task 3 (src/markdown/: parse.ts/serialize.ts/style.ts from spike 3 9343b62,
schema.ts/compare.ts from spike 5 eeb3fe2 which already carries the toDOM/parseDOM +
compare-by-name fixes on top of spike 3's version -- confirmed by diffing the two
spikes' files directly; render.ts new, extracted from spike 3 docsync.ts's
renderDetailed; index.ts drops the yjs.ts re-exports), task 4 (src/crdt/: codec.ts from
spike 5 yjs.ts retargeted; workarounds/ copied from spike 5; diff.ts from spike 3
core/diff.ts retargeted from y-prosemirror to @tiptap/y-tiptap; forkDiffMerge.ts
extracted from spike 3 docsync.ts's importText, fork/diff/verify/repair/merge only, no
version ring/base choice/authors bookkeeping (left for the daemon brief); editorPlugins.ts
from spike 5 client.ts's plugin construction; inspectUpdate.ts new (Y.parseUpdateMeta
only -- recordAttribution/authorOf deliberately deferred, brief 01's task list omits
them even though plan section 3 point 3 lists them); meta.ts new), task 5 (src/testkit/:
prng.ts/tokens.ts/waitFor.ts from spike 3, corpus.ts adapted from spike 1's gates/lib/corpus.ts,
ports.ts/tmp.ts new -- no equivalent existed in any source spike's testkit).

Deviation/interpretation logged: plan section 3 says "snapshot, encodeSnapshot/decodeSnapshot
as bytes" -- implemented `snapshot(doc): CrdtSnapshot` as the canonical bytes-producing
function and `encodeSnapshot` as its alias; did not expose a public `decodeSnapshot` since
CrdtSnapshot must stay opaque bytes and nothing outside crdt/ needs a live Y.Snapshot object
(forkDiffMerge.ts decodes internally with Y.decodeSnapshot, which is fine since that file is
inside src/crdt/).

Task 6 (unit tests) written: test/markdown-roundtrip.test.ts, test/crdt-seed-read.test.ts,
test/crdt-fork-diff-merge.test.ts, test/crdt-render.test.ts, test/import-boundary.test.ts,
test/schema-leafmarks.test.ts. crdt-render.test.ts's "never throws, reports degraded" case
is a manufactured scenario (a link mark referencing an identifier with no matching
definition) not yet verified by an actual run -- next step is npm install then npm test to
confirm it behaves as reasoned, and fix if not.

Next: npm install, npm run fetch, npm test, npm run typecheck; iterate on failures.

## 16:32 — verified, task 7 done, stopping per brief

`npm install` succeeded (255 packages). `npm run typecheck` clean on first try (no
errors). `npm test` passed on first try: 6 files, 13 tests, ~1.3s -- including the
manufactured "unverified link, reported as degraded, never throws" case in
crdt-render.test.ts (my reasoning about a shortcut link reference with no matching
definition was correct on the first attempt). `npm run fetch` populated
corpus/fetched/{real,commonmark,gfm} (266/266 manifest files, 655 CommonMark + 672 GFM
examples) with no failures; re-ran `npm test` after fetch, still 13/13 passing (the
persistent-cache test picks up the 240KB real file when present, and it wasn't present
here since that specific file wasn't in this run's manifest hits -- either way all
handwritten-file tests exercise the cache logic regardless). Confirmed the brief's exact
definition-of-done command sequence from a clean checkout: removed node_modules, ran
`npm ci` (256 packages from the lockfile), then `npm test` and `npm run typecheck`, both
green. `npm run gates`/`gates:quick` both run the placeholder runner, print "(none
registered yet)", write results/gates.{md,json}, and exit 0.

Verified `git status --porcelain --ignored` from the worktree root: only two untracked
paths outside ignores (this log file and the new spike directory as a whole); within the
spike directory, `node_modules/` and `corpus/fetched/` are correctly caught by
`.gitignore` (`!!` ignored, not staged content). No existing file was modified -- only
new files added, per the brief's constraint.

Wrote the top-level README.md skeleton (purpose, how to run, layout, "Origin of copied
code" table naming spike/branch/commit/path for every copied file, and a "Changes to
copied code" section covering the y-prosemirror -> @tiptap/y-tiptap retarget, the
yjs.ts-relocation-to-crdt, and the deliberately-deferred recordAttribution/authorOf/anchors).

### Deviations from the brief, summarized

1. `encodeSnapshot`/`decodeSnapshot`: brief text was ambiguous about their exact shape
   given CrdtSnapshot must stay opaque bytes. Implemented `snapshot(doc)` as the
   canonical bytes producer and `encodeSnapshot` as its alias; did not expose a public
   `decodeSnapshot` (would leak a live Y.Snapshot type out of the module). forkDiffMerge
   decodes internally with `Y.decodeSnapshot`, which stays inside src/crdt/.
2. `recordAttribution`/`authorOf` (plan section 3 point 3) not implemented: the brief's
   own task-4 bullet list only names `inspectUpdate` for this point, unlike the plan
   text which lists all three. Followed the brief's narrower, explicit list.
3. `forkDiffMerge`'s options are `{clientId, origin}` only, no `author` -- matches the
   brief's literal signature; the `phraise-authors` map bookkeeping that spike 3's
   `importText` did inline is left for a later brief (engine/daemon), consistent with
   the brief's own instruction to drop "its version ring or base choice."

None of these affect brief 01's stated definition of done, which is fully met.

### Open problems / notes for later briefs

- `editorPlugins`'s `cursors`/`undo` opts are accepted but not implemented (reserved,
  documented in the JSDoc) -- no live editor exists yet in this brief to need them.
- The import-boundary test currently only enforces "no file outside src/crdt/ imports
  yjs/y-protocols/lib0/@tiptap/y-tiptap"; the plan's other half ("src/relay imports
  Hocuspocus only") has nothing to check yet since src/relay/ doesn't exist -- flagged
  in the test's own comment for whoever adds src/relay/.

Handing back now: task 7 (the brief's stated stopping point) is complete and verified.
