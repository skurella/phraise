# Brief 03: gate runner and fuzz

Status: done
Author: spike 3 orchestrator (Opus 5.5)
Updated: 2026-09-27
Plan: [spike 3 plan](2026-09-27-spike-3-plan.md), section 6 is your specification for what each gate measures
Charter: [spike 3 charter](2026-09-27-spike-3-charter-daemon-file-sync.md), its gate table and its section "Rules for every agent in this spike", which you obey
Role and model: builder, Sonnet

## Goal

One command, `npm run gates`, that measures every charter gate A to I against the real daemon, relay, files and git, prints a Markdown results table with numbers, and exits non-zero when a gate fails. The centre of it is gate I, a seeded randomized fuzz of at least 300 trials. Gate J is brief 04 and plugs into the same runner later: leave a slot for it. Serves D7.

## Working directory

`/Users/skk/code/phraise/.claude/worktrees/agent-ad2057bb46c104eec`, spike directory `spikes/2026-09-27-daemon-file-sync-fork-import/`. Absolute paths in every command.

## Inputs to read

1. `AGENTS.md`; the charter's gate table; the plan (short, read all of it).
2. Code you build on, do not rewrite: `src/daemon/daemon.ts` (events, timings, `stop({ persist })`), `src/relay/relay.ts`, `src/testkit/*`, `test/daemon-helpers.ts`, `test/helpers.ts` (`changedTypesDuring`, `topLevelBlockOf`), the `test/daemon.*.test.ts` files (reuse their scenarios for gates D, G, H), and `gates/f-roundtrip.ts` (gate F core measurement, already done).

## Tasks, in order

1. `gates/lib/`: a seeded PRNG, a fixture helper usable outside vitest (relay plus temp repo plus daemon plus remote client, with guaranteed cleanup), `quiesce()` that waits until the daemon's queue is empty, no timers are pending, the file is stable and both Yjs docs have equal state vectors (add a small public `idle()` or `pending()` accessor to `Daemon` if needed, and log it), and a report module that writes `results/gates.md` and `results/gates.json`.
2. Gates A to E and G, H as functions `runGateX(opts) → { pass, numbers, failures }`, each per plan section 6 with the sample sizes there (A 200 edits, B 100 per save style, C 200 rounds, D and E at least 50 scripted cases each with varied timing). Definitions that matter:
   - A: latency from the remote transaction to the file containing it, median and p95; after each edit, the top-level blocks of the file (split with `parseMarkdown` `src` attributes) are identical to the previous file's except the one holding the new token.
   - B: latency from the write to the remote doc containing the token, per save style; confinement by `changedTypesDuring` on the remote doc; the inserting client's `phraise-authors` entry is the local user.
   - C: an echo is an `import` event whose text the harness never wrote to the file. Count echoes and count imports of daemon-written bytes (hashes from `export` events). Both must be zero.
   - F at daemon level: after each imported save, no `export` event that wrote bytes within 500 ms unless a remote edit happened in that window. Combine with the core numbers from `results/f-roundtrip.json` (run `gates/f-roundtrip.ts` as part of the full run, `--quick` in quick mode).
3. Gate I, `gates/fuzz.ts`, also runnable alone with `npx tsx gates/fuzz.ts --trials N --seed S`. Per trial, seeded:
   - Base document: a real corpus README between 2 and 12 KB, or a generated document with headings, paragraphs, a list, a code block and a table.
   - Actors: the daemon; the remote client; a simulated editor holding a buffer loaded from disk at some point, which may be stale.
   - 15 to 30 steps drawn from: editor reload; editor edit-and-save with a random save style (1 to 3 edits: insert a token word at a word boundary inside a paragraph, delete a token present in the buffer, insert a new paragraph with a token); remote edit (insert a token, delete a token present, insert a paragraph with a token, occasionally delete a whole paragraph); a delay of 0 to 100 ms; a daemon restart (graceful, or crash with `persist: false`, sometimes with edits on both sides while it is down); an occasional `quiesce()`.
   - Tokens are unique lowercase alphanumeric words. Track who inserted and who deleted each token and when.
   - End of trial: `quiesce()`, then check and categorize: `exception` (a thrown error or a daemon `error` event, including unverified serialization), `divergence` (daemon and remote renders or state vectors differ), `file-not-render` (file differs from the render), `lost` (a token inserted and never deleted is absent), `delete-vs-edit` (a token absent because its paragraph was deleted by the other side concurrently: accepted, reported, not a failure; decide concurrency conservatively and explain the rule in a comment), `resurrected` (a token deleted by someone and never re-inserted is present), `echo` (as in C), `detach` (no git operations happen in the fuzz, so any detach is a failure). Also count forks, coarse textblocks, repairs and noops from `import` events.
   - Print a table of categories with counts and the seeds of failing trials, so any failure can be replayed with `--trials 1 --seed S`.
4. `gates/index.ts`: runs every gate in order, `--quick` uses small sample sizes (A 20, B 10 per style, C 20, D and E 10, fuzz 30 trials) so it finishes in a few minutes; prints the results table (gate, requirement, result, numbers) and writes `results/gates.md` and `results/gates.json`. Add a `J` row that says "see brief 04" until brief 04 fills it. `npm run gates` and `npm run gates:quick` already point at this file.
5. Run `npm run gates:quick` until it passes. Real failures you find are the point: diagnose each one to a root cause. Fix bugs in `src/daemon/` and `src/core/` when the fix is clear and small, add a regression test under `test/`, and log it. If a failure needs a design change, stop and report it with a reproducing seed instead of working around it.
6. Run `npx tsx gates/fuzz.ts --trials 60` once and report the category table. Do not run the full 300-trial fuzz or the full gate run: the orchestrator runs those.

Stopping point: tasks 1 to 6 done, `npm run gates:quick` passes, `npx vitest run` still passes.

## Definition of done

- `npm run gates:quick` exits 0 and prints the table; `npx vitest run` and `npx tsc --noEmit` pass.
- After every run nothing listens on ports 4100 to 4199 and no daemon or CLI process remains.

## Constraints

- Only add new files inside the spike directory (and your log). Edits to the spike's own `src/` are allowed for bug fixes and small accessors, each logged.
- Keep your log at `context/logs/2026-09-27-builder-spike-3-gates.md` per `AGENTS.md`, timestamps from `date`.
- Commit at each task boundary, staging paths explicitly. Do not push.
- Do not launch other agents. Bind only to 127.0.0.1 on ports 4100 to 4199; stop every server and process you start; temp repos only under `os.tmpdir()`.

## Handback

Under 300 words: outcome per task, quick-gate numbers per gate, the 60-trial fuzz category table, bugs found and fixed with their root causes, anything reported instead of fixed with its seed, the path of your log.
