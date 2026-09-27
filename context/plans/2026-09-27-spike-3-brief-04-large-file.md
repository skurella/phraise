# Brief 04: gate J, the large file, and a verification cache

Status: done
Author: spike 3 orchestrator (Opus 5.5)
Updated: 2026-09-27
Plan: [spike 3 plan](2026-09-27-spike-3-plan.md), sections 3.5 and 6 (row J)
Charter: [spike 3 charter](2026-09-27-spike-3-charter-daemon-file-sync.md), gate J and the section "Rules for every agent in this spike", which you obey
Role and model: builder, Sonnet

## Goal

Measure what the daemon costs on the 240 KB file from spike 1 (`corpus/fetched/real/nodejs-node-docapinapimd.md`, 245,936 bytes), make the per-save and per-remote-edit paths cheap with a verification cache if that is cheap to do, and report before and after. Serves D7 and the charter question whether Node is adequate for the daemon.

## Working directory

`/Users/skk/code/phraise/.claude/worktrees/agent-ad2057bb46c104eec`, spike directory `spikes/2026-09-27-daemon-file-sync-fork-import/`. Absolute paths in every command.

## Inputs to read

1. `AGENTS.md`; the charter's gate J; the plan sections 3 and 6.
2. `src/core/docsync.ts` (`importText`, `renderDetailed`), `src/core/diff.ts`, `src/core/versions.ts` (`diffCost`, `chooseBase`), `src/md/serialize.ts` (`serializeDoc` and its candidate ladder; the verbatim candidate re-parses every block in isolation, which is the known cost), `src/md/parse.ts` (`parseMarkdown`, its per-block self-description check), `src/daemon/daemon.ts` (`runExport`, `persistState`).

## Tasks, in order

1. `gates/j.ts` exporting `runGateJ({ quick })`, and a standalone entry `npx tsx gates/j.ts`. Measure on the 240 KB file, each as median of 5 runs after one warm-up, in milliseconds:
   - `parseMarkdown` of the whole file; `serializeDoc` of the untouched doc; `docToYDoc`; `yDocToDoc`;
   - `DocSync.importText` of a one-word edit in the middle (fresh save, fast path) and of the same edit as a stale save (forked: make a remote edit elsewhere first);
   - `DocSync.renderDetailed` after one remote word edit;
   - `persistState`'s cost: size of `ydoc.bin` and time of `Y.encodeStateAsUpdate`;
   - `chooseBase` with 8 candidates that differ by one remote edit each;
   - end to end through a real daemon and relay: remote word edit to file (gate A latency) and file save to remote (gate B latency), 10 each, median.
   Also peak RSS of the process (`process.memoryUsage().rss`) after the end-to-end run.
2. Record these numbers as "before" in your log and in `results/j-before.json`.
3. Cache verification, only where the profile shows the time goes. The expected shape: in `src/md/serialize.ts`, memoize the per-block result of the verbatim and splice candidates by a key of `src`, the node's JSON, and the definitions context the block is re-parsed with; in `src/md/parse.ts`, memoize the self-description check per block by source and context. Module-level `Map`s bounded by an LRU of a few thousand entries are fine. The cache must never change output: add a test that serializes every handwritten corpus file and the 240 KB file with and without the cache and compares bytes. Other obvious hot spots are fair game if cheap, for example `yParent.toArray()[cursor]` inside the loop in `src/core/diff.ts` (quadratic in block count) and `renderDetailed`'s extra `parseMdast` of the whole output (use the cheapest check that still detects a block-count change). Note every change to `src/md/` in the spike README section "Changes to copied code" (create the section) with the reason.
4. Re-measure everything in task 1 as "after", `results/j-after.json`. Wire `runGateJ` into `gates/index.ts` in place of the placeholder row, with `pass` meaning: a fresh-save import plus the resulting export of the 240 KB file takes under 500 ms at the median, and the end-to-end latencies are reported. Report before and after side by side in the gate's numbers.
5. Run `npx vitest run`, `npx tsx gates/f-roundtrip.ts --quick` and `npx tsx gates/fuzz.ts --trials 20` to show the cache changed no behaviour (numbers in your log). Do not run the full gates or the 300-trial fuzz.

Stopping point: tasks 1 to 5 done. If the cache cannot reach the 500 ms target cheaply, stop after recording what you measured and where the time goes; that is a valid result.

## Definition of done

- `npx tsx gates/j.ts` prints a before and after table; `npm run gates:quick` includes row J; `npx vitest run` and `npx tsc --noEmit` pass.

## Constraints

- Only add new files inside the spike directory, plus edits to the spike's own `src/` as the tasks describe, each logged. Your log: `context/logs/2026-09-27-builder-spike-3-large-file.md`, timestamps from `date`.
- Commit at each task boundary, staging paths explicitly. Do not push.
- Do not launch other agents. Bind only to 127.0.0.1 on ports 4100 to 4199; stop every server and process you start; temp dirs only under `os.tmpdir()`.

## Handback

Under 300 words: before and after numbers for each measurement, what was cached and where the time went, whether the 500 ms target was met, test and fuzz results after the change, the path of your log.
