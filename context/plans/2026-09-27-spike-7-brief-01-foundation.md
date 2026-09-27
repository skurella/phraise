# Brief 01: foundation of the web editor spike

Status: dispatched
Author: spike 7 orchestrator (Opus 5.5)
Updated: 2026-09-27
Plan: [spike 7 plan](2026-09-27-spike-7-plan.md). Charter: [spike 7 charter](2026-09-27-spike-7-charter-web-editor.md)
Model: Sonnet (builder)

## Goal

Stand up the application every later brief builds on: spike 1's document model and spike 5's collaboration code copied in, one server process holding the Hocuspocus relay and serving a Vite-built page, a Tiptap 3 editor in a real browser that opens a Markdown file seeded from disk and can show its Markdown, and a Playwright harness whose reporter prints a results table by gate. Serves D4 and D5 in the [architecture decisions](../docs/2026-09-27-architecture-decisions.md).

## Inputs

- `AGENTS.md`, the charter's section "Rules for every agent in this spike", and the [plan](2026-09-27-spike-7-plan.md) (read "Shape of the application" and "Key choices").
- Spike 5 stack 13 code: `git show origin/spike/2026-09-27-collab-stack:spikes/2026-09-27-collab-stack-yjs13-hocuspocus/<path>`, at commit `eeb3fe2`. Its README explains every file. Relevant: `src/{schema,parse,serialize,style,compare,yjs,index,attribution}.ts`, `src/workarounds/*.ts`, `src/tiptapExtensions.ts`, `src/tiptapWorkaroundsExtension.ts`, `src/tiptapClient.ts` (wiring reference only), `src/relay.ts`, `scripts/fetch-corpus.mjs`, `corpus/manifest.json`, `corpus/handwritten/`, `package.json` (pin the same versions: Yjs 13.6.33, `@tiptap/*` 3.31.3, `@tiptap/y-tiptap` 3.0.9, Hocuspocus 4.7.0).

## Scope

Directory: `/Users/skk/code/phraise/.claude/worktrees/agent-a40b6e74050a061e9/spikes/2026-09-27-web-editor-tiptap/`.

1. **Copy** the model into `src/model/` and the collaboration code into `src/collab/` (workarounds, Tiptap wrapper, converter, attribution). Do not import from another spike directory. Leave out spike 5's `rebase/`, `plain:` seeding, harness and gates. Keep the copied code unchanged except import paths and what the browser build requires; list every change in the README's origin section with branch and commit.
2. **Server** `server/main.ts`: one Node process with the Hocuspocus 4.7 relay (SQLite, `gc: false`, attribution hook as in spike 5) and a static HTTP server for `dist/`. Arguments: `--port <page>` (relay on page port + 1 unless `--relay-port`), `--db <path>`, `--seeds <dir>`. Both bind to 127.0.0.1. Document names are `file:<relpath>`, seeded once through the codec from `<seeds>/<relpath>`. `GET /api/files` lists seed files. The page learns the relay URL from the server (for example `GET /config.json`). Kills cleanly on SIGINT and SIGTERM.
3. **Page** `web/`: Vite build, vanilla TypeScript, no framework. URL `/?doc=<relpath>&user=<name>`. A Tiptap `Editor` with **only** the converted spike 1 schema (no StarterKit or any extension that adds nodes or marks), `Collaboration` on the codec's fragment, `CollaborationCaret` with the user's name and a colour derived from the name, and the workaround extension in the order spike 5 requires. Build the editor after the provider's first sync, as spike 5 does. A "Markdown" toggle opens a side panel showing `serializeDoc` of the current document, refreshed on change with a short debounce. Serialize by converting the editor document into spike 1's own schema instance first (`Node.fromJSON(schema, editor.state.doc.toJSON())`). Expose `window.phraise = { editor, markdown(), ydoc, provider }` for tests. Minimal plain styling; later briefs polish.
4. **Playwright**: `@playwright/test`, browsers installed into `.pw-browsers/` inside the spike directory (git-ignored) by setting `PLAYWRIGHT_BROWSERS_PATH` in every npm script. Headless. A test fixture that, per test file or per test, copies chosen seed files into a fresh temporary directory under `$TMPDIR`, starts `server/main.ts` on a free port between 4400 and 4449 with a temporary database, and stops it afterwards, including on failure. Projects: `chromium` now; leave room for `firefox` and `webkit`.
5. **Gate reporter**: a custom Playwright reporter that reads the gate letter from each test title prefix `[A]` to `[K]`, prints a table (gate, passed, failed, skipped, status), and writes `results/gates.md` and `results/gates.json`. A gate with any failure is FAIL; a gate with no tests is "not run". `npm run gates` builds the page, then runs Playwright with this reporter, and exits non-zero on any failure.
6. **Corpus**: copy `fetch-corpus.mjs` and `manifest.json`, restricted to a list of ids in `corpus/needed.json`; start it with `npm-express-readme` and `nodejs-node-docapinapimd`. Fetched files are git-ignored. `npm run setup` installs Playwright browsers and fetches the corpus.
7. **Tests**:
   - Unit (`npm test`, vitest): `checkSchemaEquivalence` passes for the full extension list the page uses, and fails if a node is added; serializing a Tiptap-built document of `corpus/handwritten/*.md` through the page's serialize function round-trips byte for byte; the workaround plugin order is enforced.
   - E2E, titled `[A] smoke: ...`: open a handwritten fixture in Chromium, click into the first paragraph's end, type ` hello` with `page.keyboard`, and assert `window.phraise.markdown()` equals the original with exactly that change; open the Markdown panel and see the text.
8. `npm start`: builds if `dist/` is missing, copies `examples/` into a temporary seeds directory, starts the server on 4480 (relay 4481), prints `Open http://127.0.0.1:4480/?doc=<first example>&user=Alice`. Add two or three small `examples/*.md` (a heading, paragraphs, a list, a table, a code block).
9. README: purpose, layout, origin of copied code, commands.

Not in scope: shortcuts beyond Tiptap core defaults, comments, offline, source-block views, Mermaid, IME, screenshots.

## Definition of done, and stopping point

Stop when all of these hold, verified by you:
- `npm ci`, `npm run setup`, `npm test` pass from the spike directory.
- `npm run gates` runs the smoke test in Chromium, passes, and prints the gate table.
- `npm start` prints the address; `curl` of that address returns the page; the process stops on Ctrl-C (SIGINT) and leaves nothing listening (`lsof -nP -iTCP:4400-4499 -sTCP:LISTEN` is empty).
- `npx tsc --noEmit` passes.
- Work committed on the current branch with explicit paths (never `git add -A` or `git add .`). Do not push.

## Constraints

- Work only inside `/Users/skk/code/phraise/.claude/worktrees/agent-a40b6e74050a061e9`; use absolute paths.
- Node 22.12.0, npm 11. pnpm is broken; use npm.
- Do not launch other agents.
- Log to `context/logs/2026-09-27-builder-spike-7-foundation.md` at every task boundary, timestamps from `date`.

## Handback

Under 300 words: outcome; what you verified and how (commands and results); anything left out and why; surprises the orchestrator must know (especially anything about Tiptap's schema, the page bundle size, or the server); paths of the log and README.
