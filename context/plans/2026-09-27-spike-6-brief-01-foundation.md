# Brief 01: foundation — scaffold, markdown module, crdt module, testkit basics

Status: dispatched
Author: spike 6 orchestrator (Opus 5.5)
Updated: 2026-09-27
Plan: [spike 6 plan](2026-09-27-spike-6-plan.md) (the design spec; read sections 1 to 4 and 9)
Charter: [spike 6 charter](2026-09-27-spike-6-charter-integration-engine.md), section "Rules for every agent in this spike" applies to you in full.

## Goal

Create the spike package `spikes/2026-09-27-integration-engine/` and its first two modules: `src/markdown/` (the block-preserving document model, no Yjs) and `src/crdt/` (the only module that touches Yjs), plus `src/testkit/` basics and real unit tests. Everything later in the spike builds on these. Serves D4, D5 (five-point CRDT interface), D6 (fork, diff, merge).

## Inputs to read

- `AGENTS.md`, this brief, plan sections 1 to 4 and 9.
- Source code to copy (paths under `$REF` from plan section 1):
  - `2026-09-27-daemon-file-sync-fork-import/src/md/` (markdown model with the persistent parse cache), `src/core/diff.ts`, `src/core/docsync.ts` (for how fork, diff, merge and `renderDetailed` work), `test/md-roundtrip.test.ts`, `test/core.*.test.ts`, `src/testkit/`.
  - `2026-09-27-collab-stack-yjs13-hocuspocus/src/schema.ts` (take its `toDOM`/`parseDOM` rules), `src/compare.ts` (compare by type name), `src/yjs.ts` (codec on `@tiptap/y-tiptap`), `src/workarounds/`, `package.json` (pinned versions).
  - `2026-09-27-markdown-core-remark-splice/scripts/fetch-corpus.mjs`, `corpus/` (manifest, specs, handwritten).
- Do not read other docs.

## Tasks, in order. Stop when task 7 is done.

1. **Scaffold.** `package.json` (type module; scripts `test` = `vitest run`, `typecheck` = `tsc --noEmit`, `fetch` = `node scripts/fetch-corpus.mjs`, `gates`/`gates:quick` = `tsx gates/index.ts [--quick]` with a placeholder `gates/index.ts` that prints an empty table and exits 0). Dependencies: the union of what the copied code needs, pinned as in spike 5 (`yjs` 13.6.33, `@tiptap/y-tiptap` 3.0.9, `@hocuspocus/server`, `@hocuspocus/provider`, `@hocuspocus/extension-sqlite` 4.7.0, `prosemirror-*`, remark stack, `diff`, `approx-string-match`, `ws`, `y-protocols`; dev: `tsx`, `typescript`, `vitest`, `jsdom`, `global-jsdom`, `@types/*`). Do **not** depend on `y-prosemirror` directly: use `@tiptap/y-tiptap` everywhere (spike 3 used `y-prosemirror`; retarget its imports). `tsconfig.json`, `vitest.config.ts`, `.gitignore` (node_modules, corpus/fetched, any data or tmp dirs). Run `npm install` to create `package-lock.json`.
2. **Corpus.** Copy spike 1's `scripts/fetch-corpus.mjs` and `corpus/` (manifest, specs, handwritten). Run `npm run fetch` once and confirm it populates `corpus/fetched/` (gitignored).
3. **`src/markdown/`.** Copy spike 3's `src/md/` except `yjs.ts`. Apply spike 5's schema DOM rules and compare-by-name. Keep the persistent LRU parse cache. `index.ts` exports the public API. No import of `yjs` or any Yjs binding. `README.md` for the module.
4. **`src/crdt/`.** Implement plan section 3, points 1 to 4, **except** `blockStatesAt` and `resurrectBlock` (brief 03 adds those and point 5):
   - codec from spike 5 `src/yjs.ts` (fragment `prosemirror`, map `phraise-doc`), `createDoc()` with `gc: false`;
   - `editorPlugins(doc, opts)` returning ySync, leafMarks, rootAttrs in the required order (copy the two workaround plugins);
   - `inspectUpdate(update)` via `Y.parseUpdateMeta`;
   - `snapshot`, `encodeSnapshot`/`decodeSnapshot` as bytes, `forkDiffMerge(doc, base, targetPM, {clientId, origin})` built from spike 3's `diff.ts` and the fork, verify, repair and merge steps of spike 3's `DocSync.importText` (not its version ring or base choice, which belong to the daemon later);
   - `render(doc)`: spike 3's `renderDetailed` logic (best effort plus degraded list plus boundary repair), returning `{text, degraded, boundaryRepairs, composed}`; it belongs next to `read` because it only needs the PM doc, so put the serialization part in `src/markdown/` as `renderDoc(pmDoc)` and have crdt call it;
   - meta accessors `getMeta`, `setMeta`, `transact`, `onUpdate`, `encodeState`, `applyUpdate`, `stateVector`, `clientId(doc)`, `setClientId(doc, id)`;
   - `README.md` stating the interface and that no other module may import Yjs.
5. **`src/testkit/` basics.** `ports.ts` (allocate a free port in 4300 to 4399, bind check on 127.0.0.1), `tmp.ts` (temp dirs under `os.tmpdir()`, removed by a returned cleanup), `prng.ts`, `tokens.ts`, `waitFor.ts`, `corpus.ts` (list handwritten and fetched corpus files, read by name). Copy from spike 3's testkit where it exists.
6. **Unit tests** (`test/*.test.ts`), all real:
   - markdown: every handwritten corpus file round-trips byte for byte; a one-word edit changes only its block; cache cold versus warm gives identical output (from spike 3's test);
   - crdt: seed then read equals the parsed doc for every handwritten file (root attrs and linked images included); `forkDiffMerge` at an old snapshot keeps a concurrent live edit and applies the fork's edit (both tokens present); a no-op when target equals current; `render` never throws on a block it cannot verify and reports it as degraded;
   - an import-boundary test that scans `src/**/*.ts` and fails if any file outside `src/crdt/` imports `yjs`, `y-protocols`, `lib0` or `@tiptap/y-tiptap`;
   - a schema test that every inline atom node type declares `leafMarks`.
7. **Run** `npm test` and `npm run typecheck`; both pass. Write the top-level `README.md` skeleton: purpose, how to run, layout, and an "Origin of copied code" section naming spike, branch, commit and path for every copied file.

## Definition of done

`cd spikes/2026-09-27-integration-engine && npm ci && npm test && npm run typecheck` passes from a clean checkout (corpus tests that need `corpus/fetched/` may skip with a clear message when it is absent, but the handwritten ones always run). No file outside `src/crdt/` imports Yjs.

## Constraints

- Work only inside `spikes/2026-09-27-integration-engine/` and your own log `context/logs/2026-09-27-builder-spike-6-foundation.md`. Only add new files.
- Do not commit; the orchestrator commits.
- Bash in this environment refuses commands that mention `git` inside pipes, loops, `cd &&` chains or heredocs. Run git commands as single plain commands. Prefer the Write tool for creating files.
- Handback under 300 words: outcome, test counts, anything that deviated from this brief, open problems.
