# Brief 02: daemon runtime, relay harness, integration tests

Status: done
Author: spike 3 orchestrator (Opus 5.5)
Updated: 2026-09-27
Plan: [spike 3 plan](2026-09-27-spike-3-plan.md), sections 2, 4 and 5 are your specification; section 3 describes the core you build on
Charter: [spike 3 charter](2026-09-27-spike-3-charter-daemon-file-sync.md), read its section "Rules for every agent in this spike" and obey it
Role and model: builder, Sonnet

## Goal

Wrap the finished core (`src/core/DocSync`) in a real daemon: a Hocuspocus client that writes the document to a file in a git working tree, watches the file, imports saves, persists its base, survives restarts, and detaches when git changes the file underneath it. Prove each behaviour with an integration test against a real relay, real files and real git. Serves D7.

## Working directory

`/Users/skk/code/phraise/.claude/worktrees/agent-ad2057bb46c104eec`, spike directory `spikes/2026-09-27-daemon-file-sync-fork-import/`. Absolute paths in every command. `npm install` is done; `@hocuspocus/server` and `@hocuspocus/provider` 4.7, `ws`, `yjs` 13, `vitest` are installed. Node 22.12 has a global `WebSocket`.

## Inputs to read

1. `AGENTS.md`.
2. The plan, all of it (it is short). Sections 2, 4 and 5 are what you build.
3. `src/core/docsync.ts`, `src/core/versions.ts`, `src/testkit/remote-editor.ts`, `src/testkit/tokens.ts`, `test/helpers.ts`. Do not change `src/core/` or `src/md/` unless a bug blocks you; if so, make the smallest fix, add a test, and log it.
4. The Hocuspocus type declarations in `node_modules/@hocuspocus/server/dist/index.d.ts` and `node_modules/@hocuspocus/provider/dist/index.d.ts` as needed.

## Tasks, in order

1. `src/relay/relay.ts`: `startRelay({ port? }) → { url, port, stop() }`. Hocuspocus 4 `Server` bound to 127.0.0.1, `yDocOptions: { gc: false }`, no persistence, quiet. Without a port, take the first free port in 4100 to 4199. `stop()` must leave nothing listening.
2. `src/testkit/`: `makeTempRepo()` (a `git init` repo under `os.tmpdir()` with user name and email configured locally, one committed Markdown file, returns paths and a `cleanup()`), `RemoteClient` (a gc-false `Y.Doc`, a `HocuspocusProvider`, a `RemoteEditor`, `synced()` and `destroy()`), `saveInPlace`, `saveRenameOver`, `saveTruncateThenWrite` (truncate, wait 5 ms, write), and `waitFor(predicate, timeoutMs)`.
3. `src/daemon/daemon.ts`: class `Daemon extends EventEmitter` with `constructor({ repoDir, file, docName, relayUrl, user, stateDir?, timings? })`, `start()`, `stop({ persist = true })` (persist false simulates a crash: no final state write), `status()`. Implement plan 4.1 to 4.4 and 4.6: serial queue, remote-to-file export with the guarded write exactly as specified, file watcher with settle debounce and the empty-file grace, content-based echo check, persistence and restart including the conflict copy, events. Timings are constructor options with the plan's starting values. Adoption on first start: if the relay doc is empty, seed it from the file (`DocSync.adopt`); if the relay doc is not empty, render it and write the file when the file is missing or equal to the file's `HEAD` content, else conflict copy.
4. `src/daemon/git.ts` and its wiring: plan 4.5 and its action table. Read git state with `git` subprocesses (`symbolic-ref -q HEAD`, `rev-parse HEAD`, `rev-parse -q --verify refs/stash`, `merge-base --is-ancestor`, `log -1 --format=%an`). Detect `index.lock` during settle. Emit `detach`, `attach`, `rebase` events with a reason. Never write the file while detached.
5. `src/daemon/cli.ts`: `npx tsx src/daemon/cli.ts --relay <url> --repo <dir> --file <path> --doc <name> --user <name>` prints events as JSON lines, exits cleanly on SIGINT and SIGTERM (persisting). Also `src/relay/cli.ts` to run a relay standalone.
6. Integration tests `test/daemon.*.test.ts` (vitest; set `fileParallelism: false` in a `vitest.config.ts` and generous per-test timeouts). Each test creates its own temp repo and relay and cleans both up, including in `afterEach` on failure:
   - A: remote word edit reaches the file; untouched blocks byte-identical.
   - B: a file edit reaches the remote client, for each of the three save styles; the changed Y types lie in the edited top-level block (reuse `changedTypesDuring` and `topLevelBlockOf` from `test/helpers.ts` on the remote doc); the new items' client maps to the local user in `phraise-authors`.
   - C: 30 rapid alternating rounds (remote edit, file save, small random gaps): no import event whose bytes the test did not write; the final file equals the render of the converged doc; all tokens present.
   - D: stale save: editor reads V0, two remote edits land and the daemon writes V1 and V2, the editor saves V0 plus its own token. All remote tokens and the local token are present afterwards and the file equals the render.
   - E: simultaneous local save and remote edit, same block and different blocks: replicas converge, tokens present, file equals render.
   - F: after a local save is imported, no `export` event with a write follows within 500 ms, and the file bytes are unchanged.
   - G: one test per row of the plan 4.5 table, including a negative control: a plain editor save that makes the file equal to the `HEAD` content, with no git command run, is imported normally.
   - H: stop, edit both sides, restart: merged. Stop, delete the state directory, edit the file, restart: conflict copy beside the file, file untouched, `detach` event. CLI variant: spawn the CLI, SIGKILL it, edit both sides, respawn: merged.
7. Run `npx vitest run` three times in a row. Every flaky test is a bug to fix, not a timeout to raise; log the cause of each flake you find.

Stopping point: tasks 1 to 7 done and three consecutive clean runs. If a task cannot be finished, finish the others, and say exactly what is missing.

## Definition of done

- `npx vitest run` passes three times in a row; `npx tsc --noEmit` passes.
- After the test run, nothing listens on ports 4100 to 4199 (`lsof -iTCP:4100-4199 -sTCP:LISTEN` prints nothing) and no daemon process remains.

## Constraints

- Only add new files inside the spike directory (and your log). Do not edit anything else.
- Keep your log at `context/logs/2026-09-27-builder-spike-3-daemon.md` per `AGENTS.md`, timestamps from `date`.
- Commit at each task boundary, staging paths explicitly. Do not push.
- Do not launch other agents.
- Bind only to 127.0.0.1, ports 4100 to 4199. Stop every server and process you start. Temp repos only under `os.tmpdir()`; never operate on the Phraise repository.

## Handback

Under 300 words: outcome per task, test results of the three runs, flakes found and their causes, deviations from the plan and why, what is missing, the path of your log.
