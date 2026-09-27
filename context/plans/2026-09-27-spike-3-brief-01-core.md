# Brief 01: core sync library (DocSync, two-way diff, fork import)

Status: done
Author: spike 3 orchestrator (Opus 5.5)
Updated: 2026-09-27
Plan: [spike 3 plan](2026-09-27-spike-3-plan.md), sections 1, 3 and 5 (RemoteEditor only)
Charter: [spike 3 charter](2026-09-27-spike-3-charter-daemon-file-sync.md), read its section "Rules for every agent in this spike" and obey it
Role and model: builder, Sonnet

## Goal

Build the pure, synchronous core that turns a saved file into attributed CRDT operations without reverting anything a remote peer did after the editor's base, and renders the CRDT back to bytes. Serves D7. No network, no file watching: that is brief 02.

## Working directory

`/Users/skk/code/phraise/.claude/worktrees/agent-ad2057bb46c104eec`, spike directory `spikes/2026-09-27-daemon-file-sync-fork-import/`. Use absolute paths in every command. The scaffold exists: `src/md/` is spike 1's document model (copied, do not change it in this brief), `package.json` has every dependency, `npm install` is done, `corpus/fetched/` holds the corpus, `fixtures/half-typed.json` holds 47 half-typed states, `test/md-roundtrip.test.ts` passes (`npx vitest run`).

## Inputs to read

1. `AGENTS.md`.
2. The plan, sections 1, 3 and 5. Section 3 is the specification you implement.
3. Spike 2's diff, which you copy and extend: `git show 88bd85c:spikes/2026-09-27-crdt-rebase-yjs-fork/src/diff.ts`, and its fork mechanics in `git show 88bd85c:spikes/2026-09-27-crdt-rebase-yjs-fork/src/rebase.ts`. Run `git show` from the worktree directory, one plain command at a time.
4. `src/md/schema.ts`, `src/md/yjs.ts`, `src/md/compare.ts` in the spike directory. Skim `src/md/parse.ts` and `src/md/serialize.ts` exports only.

## Tasks, in order

1. `src/core/diff.ts`: `applyDiff` per plan 3.4 (copy spike 2's diff, note origin branch and commit in a header comment, extend for spike 1's schema: inline leaves, `table_cell`, `raw_block`, array-valued attrs such as `table.align`, nested attr sync on matched pairs). Export counters (`coarseTextblocks`, `pairedUpdates`, `inserts`, `deletes`, `attrOnly`).
2. `src/core/versions.ts`: the version ring and `chooseBase` per plan 3.2.
3. `src/core/docsync.ts`: class `DocSync` wrapping a live `Y.Doc` (gc false) with `adopt(text)` (seed an empty doc from text), `recordWrite(text)` (records a `write` version with the current snapshot), `importText(text, { author: { name, kind }, base? })` per plan 3.3, `render()` per plan 3.5 with an optional whole-document check, `versions`, `authors` accessors. Export `ORIGIN_IMPORT`. The fork uses a fresh random client ID; the fast path uses the live client ID; both are registered in `phraise-authors`.
4. `src/testkit/remote-editor.ts`: `RemoteEditor` over any `Y.Doc` per plan section 5, with helpers: replace the Nth word of the Nth paragraph, insert a paragraph after block N, delete block N, insert text at a character offset in a textblock. Plus `src/testkit/tokens.ts`: unique token generator and a function listing tokens present in a text.
5. Tests in `test/core.*.test.ts` (vitest), all in memory, with two or three `Y.Doc`s linked by exchanging updates:
   - fresh save: one word changed in one paragraph. Decode the resulting update and assert every inserted and deleted item lies inside that top-level block, and the inserting client maps to the local user in `phraise-authors`.
   - stale save (gate D): editor base V0, remote edits in other blocks and in the same paragraph (a different word, and a deletion of a word) after V0, then the editor saves V0 plus its own edit. Afterwards: the remote edits are all present and the remote deletion is not undone, the editor's edit is present, both docs converge.
   - undo after save picks the anchor (plan 3.2), and cost-0 saves import nothing.
   - concurrent edits in different blocks and the same block, both orders of update delivery: convergence, every inserted token present.
   - inline leaves: edit text around an image and a hard break without the coarse fallback; adding an image uses the fallback and still verifies.
6. `gates/f-roundtrip.ts` runnable with `npx tsx gates/f-roundtrip.ts [--quick]`: gate F per plan section 6. For each corpus file (handwritten and real; `--quick` takes every 10th): adopt it, then 5 seeded rounds of editor-like byte edits (insert or delete 1 to 20 characters from the alphabet of letters, spaces, newlines and `*_\`[]()#->|!$~<`), import each, require `render() === saved`. Then each half-typed state inserted into 10 base documents at four positions (start, between two blocks, end, appended to the end of an existing line). Print totals, the pass rate, counts of coarse and repair paths, and the first 20 failures with a short excerpt. Write JSON results to `results/f-roundtrip.json`.
7. Run task 6 in full once, and fix what is cheap. Failures caused by spike 1's serializer or parser are findings: list them with categories in your log, do not change `src/md/` unless the fix is a few lines and you log it.

Stopping point: tasks 1 to 6 done, tests pass, task 7's full run done and its numbers logged. If task 7 leaves failures you cannot fix cheaply, stop and report them.

## Definition of done

- `npx vitest run` passes in the spike directory; `npx tsc --noEmit` passes.
- `npx tsx gates/f-roundtrip.ts` runs to completion and prints its table.

## Constraints

- Only add new files (plus the spike's own files you created). Do not edit anything outside `spikes/2026-09-27-daemon-file-sync-fork-import/` except your log.
- Keep your log at `context/logs/2026-09-27-builder-spike-3-core.md` per `AGENTS.md`, timestamps from `date`.
- Commit your work on the current branch at each task boundary, staging paths explicitly. Do not push.
- Do not launch other agents.
- Tests use only in-memory docs or temporary directories under `$TMPDIR`.

## Handback

Under 300 words: outcome per task, test and gate F numbers, fallback counts, failures by category, anything in the plan you had to deviate from and why, the path of your log.
