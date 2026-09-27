Status: in progress
Author: builder (Sonnet 5)
Updated: 2026-09-27
Plan: [spike 7 plan](../plans/2026-09-27-spike-7-plan.md)
Brief: [brief 01 foundation](../plans/2026-09-27-spike-7-brief-01-foundation.md)

Time zone: local machine time (CEST, from `date`).

## 16:09 — task received

Read AGENTS.md, brief 01, charter rules section, and plan sections "Shape of the application" and "Key choices". Confirmed on branch `spike/2026-09-27-web-editor`, working tree clean, one commit ahead of origin (charter + plan + brief already committed by orchestrator). Node v22.12.0, npm 11.0.0 confirmed.

Goal: stand up `spikes/2026-09-27-web-editor-tiptap/` with model+collab code copied from spike 5, a server (Hocuspocus relay + static file server), a Vite/vanilla-TS page with Tiptap 3 editor, Playwright harness with gate reporter, and unit tests. Stopping point per brief: `npm ci`, `npm run setup`, `npm test` pass; `npm run gates` passes smoke test; `npm start` works and cleans up; `npx tsc --noEmit` passes; work committed with explicit paths.

## 16:20 — model/collab code copied, server, page and unit tests done

Copied via `git archive origin/spike/2026-09-27-collab-stack -- <paths> > .import-staging/archive.tar` (kept the git command plain per the worktree guard; git show does not permit writing outside the worktree so archive+extract-in-place was used instead) into `.import-staging/`, then `cp` into place (not a git operation, no guard issue):
- `src/model/{schema,parse,serialize,style,compare,yjs,index,attribution}.ts` — byte-identical to spike 5 (no import-path changes needed; all cross-references are internal to this directory already).
- `src/collab/{tiptapExtensions,tiptapWorkaroundsExtension}.ts`, `src/collab/workarounds/{rootAttrs,leafMarks}.ts` — unchanged except two import paths: `tiptapExtensions.ts`'s `./schema.js` -> `../model/schema.js`; `workarounds/rootAttrs.ts`'s `../yjs.js` -> `../../model/yjs.js`.
- `corpus/manifest.json`, `corpus/handwritten/*.md` (28 files) — unchanged.
- `.import-staging/` deleted before committing (not part of the spike).

`server/main.ts`: new, trimmed from spike 5's `src/relay.ts` — kept the Hocuspocus 4.7 Server + SQLite extension + `gc:false`/`gcFilter` + the attribution hook (`onAuthenticate`/`onChange` -> `src/model/attribution.ts`), dropped the `plain:`/`rebase:` document kinds, the `/rebase` and `/state` HTTP routes, and the rebase-specific imports per the brief. Added a plain `http.createServer` static file server for `dist/`, `GET /api/files` (recursive `.md` listing under the seeds dir) and `GET /config.json` (`{relayUrl}`). Verified the installed `@hocuspocus/server`'s top-level `Server` class exposes a public `destroy(): Promise<void>` (checked its `.d.ts` directly) — used for clean SIGINT/SIGTERM shutdown alongside `staticServer.close()`.

`web/`: vanilla TS, Vite (`root: 'web'`, `outDir: '../dist'`). `web/src/main.ts` reads `?doc=&user=`, fetches `/config.json`, builds a `Y.Doc` + `HocuspocusProvider`, awaits `provider.isSynced`/`'synced'` before constructing the Tiptap `Editor` (matching spike 5's `tiptapClient.ts` ordering), extension order `[...buildTiptapExtensions(), Collaboration, CollaborationCaret, PhraiseWorkarounds]` (same order as the wiring reference). `window.phraise = {editor, markdown, ydoc, provider}`; `markdown()` does `Node.fromJSON(schema, editor.state.doc.toJSON())` then `serializeDoc`. Markdown side panel toggle with a 250ms debounce on `editor.on('update', ...)`.

Unit tests (`test/`, vitest, 31 tests, all passing):
- `schemaEquivalence.spec.ts`: builds the *exact* extension list the page uses (converted schema + Collaboration + CollaborationCaret + PhraiseWorkarounds, with stand-in `Y.Doc`/provider objects since `getSchema()` never touches the provider), asserts `checkSchemaEquivalence` against `src/model/schema.ts` passes, and that adding a node makes it fail.
- `roundtrip.spec.ts`: for all 28 `corpus/handwritten/*.md`, parses, converts through `buildTiptapSchema()` and back to the model schema via `Node.fromJSON`, serializes, and asserts byte-identity with the original file (task 3's "serialize through spike 1's schema instance" concern).
- `workaroundOrder.spec.ts`: found that `Extension`'s `.config` object (holding the raw `addProseMirrorPlugins` function) is accessible at runtime despite being TS-internal — confirmed with a throwaway probe script (deleted) before writing the test — and asserts the two plugins come back in order `[leafMarksPlugin, rootAttrsPlugin]`, matching the doc comment in `tiptapWorkaroundsExtension.ts`.

Verified: `npx vitest run` -> 3 files, 31 tests, all passed. `npx tsc --noEmit` -> clean, no errors (after one fix: `Plugin`/`PluginKey`'s `.key` field is runtime-only, not in the public `.d.ts`, so the order test casts through `unknown`).

## 16:30 — Playwright harness, gate reporter, corpus fetch, npm start: all built and verified

Manual sanity check before writing Playwright tests: started `server/main.ts` by hand (tsx, temp seeds/db), used the Browser tool to open `http://127.0.0.1:4490/?doc=hello.md&user=Alice`, confirmed the editor rendered `examples/hello.md`, typed into a paragraph, opened the Markdown panel and saw it reflect the edit, and read `window.phraise.markdown()` from the console — matched. Killed with SIGTERM: process exited 0, `lsof -nP -iTCP:4400-4499 -sTCP:LISTEN` empty.

`e2e/serverHarness.ts`: `startServer(seedFiles)` copies seed files into a fresh `fs.mkdtempSync(os.tmpdir(), ...)` dir, spawns `node --import tsx/esm server/main.ts` (not the `tsx` CLI — confirmed by inspecting the process tree with `ps -o pid,ppid,pgid` that the CLI form re-execs a grandchild, same issue spike 5's harness documents) on a random port in 4400-4449, waits for the `server-ready` stdout line, retries a few times on failure. `e2e/fixtures.ts` wraps it as a Playwright fixture (`seedFiles` is a fixture option tests set via `test.use(...)`; teardown always runs, per Playwright's own fixture semantics, so "stops afterwards including on failure" needs no extra code). `e2e/gateReporter.ts`: reads `[A]`-`[K]` from test titles, prints the table, writes `results/gates.md`/`gates.json`; a gate with 0 tests is "not run", any failure makes it FAIL. Exit code on failure comes from Playwright itself, not the reporter.

`e2e/smoke.spec.ts`, gate `[A]`: uses `corpus/handwritten/no-trailing-newline.md` (picked because its first paragraph, "This file ends without a newline.", is short and plain enough that "click paragraph, press End, type" lands at the true end rather than a wrapped-line end, and has no characters needing re-escaping on serialize). Asserts `window.phraise.markdown()` equals the original with exactly " hello" inserted, then opens the Markdown panel and checks the text appears there too.

Verified: `PLAYWRIGHT_BROWSERS_PATH=.pw-browsers npx playwright install chromium` succeeded; `npm run gates` (which runs `vite build` then `playwright test`) -> gate table printed, `A | 1 | 0 | 0 | PASS`, all other gates "not run", exit code 0, `results/gates.md`/`gates.json` written correctly. `lsof -nP -iTCP:4400-4499 -sTCP:LISTEN` empty after the run.

`scripts/fetch-corpus.mjs`: trimmed from spike 5's version — restricted to ids in `corpus/needed.json` (`["npm-express-readme", "nodejs-node-docapinapimd"]`), dropped the CommonMark/GFM spec-example fetching (no `specs.json` copied, out of this brief's scope). Verified: `node scripts/fetch-corpus.mjs` -> both files fetched successfully (network access confirmed available in this environment), correct sha256 checks pass.

`scripts/start.ts` (`npm start`): builds via `vite build` if `dist/index.html` is missing, copies `examples/*.md` into a fresh temp seeds dir, spawns `server/main.ts` on 4480/4481, prints `Open http://127.0.0.1:4480/?doc=hello.md&user=Alice` after a short delay, and handles SIGINT/SIGTERM by killing the child and removing the temp dir. Verified the *real* Ctrl-C path, not just `kill` on the top pid: inspected the process tree (`npm start` -> `tsx` CLI -> the actual `start.ts` process -> the spawned `server/main.ts` child) and confirmed all four share one process group; sent `kill -INT` to `-<pgid>` (negative pgid, the shell's own group-signal form) to simulate a terminal Ctrl-C exactly. Result: all four processes gone, `lsof -nP -iTCP:4400-4499 -sTCP:LISTEN` empty, the temp seeds/db directory removed.

`examples/{hello,table,notes}.md`: three small fixtures (heading+paragraphs+list+code block; a table; a blockquote+ordered list+emphasis/link) for `npm start`.

Next: README, a clean `npm ci` from scratch, the full definition-of-done command list, commit.

## 16:29 — clean-checkout verification, commit, handback

Wrote `README.md` (purpose, layout, origin-of-copied-code section per file, commands, verified section, notes for the next brief). Removed `node_modules/`, `dist/`, `.pw-browsers/`, `results/`, `test-results/`, `corpus/fetched/` and the leftover `.import-staging/` (created accidentally at the worktree root during the initial `git archive`, not inside the spike directory — deleted before staging) and re-ran the whole definition-of-done list from a clean state:
- `npm ci` -> 226 packages, no errors.
- `npm run setup` -> all three Playwright browsers installed into `.pw-browsers/`, both corpus files fetched.
- `npm test` -> 3 files, 31 tests, all passed.
- `npm run gates` -> builds, runs gate `[A]` in Chromium, `1 passed`, table printed, exit 0.
- `lsof -nP -iTCP:4400-4499 -sTCP:LISTEN` -> empty after `npm run gates`.
- `npx tsc --noEmit` -> clean.
- `npm start` -> built `dist/`, printed `Open http://127.0.0.1:4480/?doc=hello.md&user=Alice`, `curl` returned 200. Verified the *real* Ctrl-C path: `ps -o pid,ppid,pgid` showed `npm start` -> `tsx` CLI -> the actual `start.ts` process -> the spawned `server/main.ts` child all sharing one process group; sent `kill -INT` to the negative pgid (the same signal a terminal Ctrl-C delivers to a whole foreground process group) and confirmed all four processes exited and the temp seeds/db directory was removed.

`git status --short` showed only the new spike directory and this log file (gitignored dirs correctly excluded, confirmed with `git status --ignored`). Staged explicitly: `git add spikes/2026-09-27-web-editor-tiptap context/logs/2026-09-27-builder-spike-7-foundation.md` (no `-A`/`.`). Committed as `fe9ab21` on `spike/2026-09-27-web-editor`, not pushed (brief says commit only).

Nothing was left out of the brief's scope; everything in "Scope" items 1-9 is done. Handing back to the orchestrator now.
