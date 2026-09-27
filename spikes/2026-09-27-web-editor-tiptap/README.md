# Spike 7: the web editor, briefs 01 (foundation) and 02 (typing, gates A and B)

Status: briefs 01 and 02 done. See
[the plan](../../context/plans/2026-09-27-spike-7-plan.md),
[the charter](../../context/plans/2026-09-27-spike-7-charter-web-editor.md),
[brief 01](../../context/plans/2026-09-27-spike-7-brief-01-foundation.md) and
[brief 02](../../context/plans/2026-09-27-spike-7-brief-02-typing.md).
Logs: [brief 01](../../context/logs/2026-09-27-builder-spike-7-foundation.md),
[brief 02](../../context/logs/2026-09-27-builder-spike-7-typing.md).

## Goal

Brief 01 stood up the application every later brief in this spike builds
on: one server process holding a Hocuspocus relay and a static page
server, a Tiptap 3 editor in a real browser that opens a Markdown file
seeded from disk and can show its Markdown, and a Playwright harness with
a gate reporter. Brief 02 made the editor behave like a word processor
under real keyboard input (typing, splitting/joining, formatting
shortcuts, lists, tables) and added Markdown affordances (input rules,
paste, copy), proving every scenario with Playwright in Chromium against
gates A and B. Serves D4 and D5 in
[the architecture decisions](../../context/docs/2026-09-27-architecture-decisions.md).

## Layout

- `src/model/` — spike 1's document model: ProseMirror schema, parser,
  serializer, style detection, structural compare, the Yjs codec, and
  attribution. See "Origin of copied code" below.
- `src/collab/` — the two Yjs 13 workaround plugins (root doc attrs, inline
  leaf marks), the generic ProseMirror-Schema-to-Tiptap-extension converter
  (`tiptapExtensions.ts`, `checkSchemaEquivalence`), and the two plugins
  wrapped as one Tiptap `Extension` (`tiptapWorkaroundsExtension.ts`).
- `server/main.ts` — one Node process: the Hocuspocus 4.7 relay (SQLite
  persistence, `gc:false`, the attribution hook) plus a static file server
  for `dist/`, `GET /api/files` and `GET /config.json`. Both bind
  `127.0.0.1` only.
- `web/` — the page: Vite-built vanilla TypeScript, a Tiptap `Editor` on
  **only** the converted spike 1 schema (no StarterKit, no extension that
  adds a node or mark), `Collaboration`, `CollaborationCaret`, the wrapped
  workarounds, brief 02's editing extensions (below), and a Markdown side
  panel.
- `src/editing/` (brief 02) — the schema-free editing logic that is pure
  enough to unit-test headless, no DOM: `freshSrc.ts` (a top-level block
  created by splitting must not inherit another block's `src`/`gap` --
  also invalidates a survivor's stale trailing `gap` when new content is
  inserted right after it, e.g. by a paste; see its own file comment),
  `pasteMarkdown.ts` (the Markdown-or-not paste rule and the inline-vs-block
  decision), `copyMarkdown.ts` (a selection's `Slice` to Markdown),
  `inputRulePatterns.ts` (heading/list/blockquote/fence/thematic-break
  regexes and attr extractors), `tableNav.ts` (Tab/Shift-Tab cell
  navigation, plain position arithmetic -- not `prosemirror-tables`, which
  needs a `tableRole` on every NodeSpec).
- `web/src/editing/` (brief 02) — the Tiptap wiring around the above, one
  file per concern: `inputRulesExtension.ts` (real `InputRule`s, so
  Backspace-undo is free), `enterConversions.ts` (code fence/thematic break
  fire on Enter, not as input rules; their own Backspace-undo is
  reconstructed structurally from the node's hint attrs), `listKeymap.ts`,
  `tableKeymap.ts`, `markShortcuts.ts` (Mod-B/I/E), `linkShortcut.ts`
  (Mod-K, a plain in-page popup, no `window.prompt`), `pasteRule.ts`,
  `copyRule.ts`. `web/src/main.ts`'s extensions array has a comment on the
  one ordering dependency among these (Tiptap tries a LATER extension's
  keyboard shortcut first).
- `e2e/` — Playwright tests. `serverHarness.ts` starts/stops a real
  `server/main.ts` child process per test against a temporary seeds
  directory and database; `fixtures.ts` wraps that as a Playwright fixture;
  `gateReporter.ts` is the custom reporter; `smoke.spec.ts` is gate `[A]`'s
  original smoke test. Brief 02 added `gateA-typing.spec.ts`,
  `gateA-shortcuts.spec.ts`, `gateA-lists.spec.ts`, `gateA-table.spec.ts`,
  `gateB-inputrules.spec.ts`, `gateB-paste.spec.ts`, `gateB-copy.spec.ts`,
  and their fixtures under `e2e/fixtures/` (small hand-written `.md` files,
  each with untouched neighbour blocks so a test can assert the full
  serialized Markdown and prove nothing else moved).
- `test/` — vitest unit tests (schema equivalence, byte-for-byte
  round-trip through a Tiptap-built document, workaround plugin order, and
  brief 02's `src/editing/` modules: `freshSrc`, `pasteMarkdown`,
  `copyMarkdown`, `inputRulePatterns`, `tableNav`).
- `corpus/handwritten/` — 28 small hand-authored fixtures, copied from
  spike 5, used by the unit round-trip test and available to e2e tests.
- `corpus/manifest.json`, `corpus/needed.json`, `scripts/fetch-corpus.mjs`
  — fetches two larger real-world files (a README, a Node.js API doc) for
  later briefs' screenshots/scale gates. Fetched files are git-ignored.
- `examples/` — three small fixtures for `npm start` (heading + paragraphs
  + list + code block; a table; a blockquote + ordered list + emphasis).
- `scripts/start.ts` — `npm start`'s implementation.

## Origin of copied code

Copied from `origin/spike/2026-09-27-collab-stack` at commit `eeb3fe2`
(spike 5, directory `spikes/2026-09-27-collab-stack-yjs13-hocuspocus/`),
itself built from spike 1 at `1e1f4a6`. Retrieved with
`git archive origin/spike/2026-09-27-collab-stack -- <paths>` (this
worktree cannot run arbitrary `git show`/redirect combinations, so the
paths were archived to a tarball inside the worktree and extracted, then
copied into place — no different in effect from `git show` per file).

- `src/model/{schema,parse,serialize,style,compare,yjs,index,attribution}.ts`
  — byte-identical to spike 5. No import-path changes were needed: every
  cross-reference among these files is already internal to this one
  directory.
- `src/collab/tiptapExtensions.ts` — unchanged except one import:
  `./schema.js` → `../model/schema.js`.
- `src/collab/tiptapWorkaroundsExtension.ts` — unchanged (its only
  cross-file imports are `./workarounds/*.js`, which moved as a unit).
- `src/collab/workarounds/leafMarks.ts` — unchanged (no cross-directory
  import).
- `src/collab/workarounds/rootAttrs.ts` — unchanged except one import:
  `../yjs.js` → `../../model/yjs.js`.
- `corpus/manifest.json`, `corpus/handwritten/*.md` (28 files) — unchanged.
- `scripts/fetch-corpus.mjs` — adapted, not copied unchanged: restricted to
  the ids listed in `corpus/needed.json`
  (`npm-express-readme`, `nodejs-node-docapinapimd`), and the
  CommonMark/GFM spec-example fetching spike 5's version also did was
  dropped (this spike does not copy `corpus/specs.json`; out of this
  brief's scope).
- `src/tiptapClient.ts` (spike 5) was read as a **wiring reference only**,
  per the brief, and not copied: `web/src/main.ts` is new code that follows
  the same extension order and the same "build the editor only after the
  provider's first sync" rule, but talks to a real browser `WebSocket`
  through `@hocuspocus/provider`'s `HocuspocusProvider({url, name,
  document, token})` constructor directly, with no jsdom shims (spike 5's
  jsdom `getClientRects`/`getBoundingClientRect` patches and its explicit
  `websocketProvider`/`WebSocketPolyfill` wiring are jsdom-only concerns
  that do not apply in a real browser).

Everything else — `server/main.ts` (trimmed from spike 5's `src/relay.ts`:
kept the relay, SQLite, `gc:false`, and the attribution hook; dropped the
`plain:`/`rebase:` document kinds and the `/rebase`/`/state` HTTP routes,
which are spike 5/spike 2 concerns this brief has no use for), `web/`,
`e2e/`, `test/`, `scripts/start.ts`, `examples/`, and the adapted
`fetch-corpus.mjs` — is new code written for this spike.

## Commands

```bash
npm ci                 # install
npm run setup          # Playwright browsers (.pw-browsers/, git-ignored) + the two fetched corpus files
npm test               # vitest: 69 unit tests
npm run typecheck      # tsc --noEmit
npm run gates          # builds the page, runs the Playwright gates, prints the gate table
npm start              # builds if needed, seeds from examples/, serves on 127.0.0.1:4480 (relay 4481)
```

`npm run gates` runs gates `[A]` (22 tests) and `[B]` (23 tests); later
briefs add gates C through K. The reporter marks every gate with no tests
"not run", not a failure. Every gate that does run passes.

Mod-E (inline code) is this spike's own choice of shortcut: Google Docs has
none for inline code. Documented where it's wired,
`web/src/editing/markShortcuts.ts`.

Ports: the Playwright fixture picks a random free port in 4400-4449 per
test (charter's range for this spike); `npm start` uses 4480 (page) and
4481 (relay), matching the plan. Everything binds `127.0.0.1` only.

## Verified

- `npx vitest run` — 8 files, 69 tests, all passing (brief 01's schema
  equivalence, corpus round-trip and workaround-order tests, plus brief
  02's `freshSrc`, `pasteMarkdown`, `copyMarkdown`, `inputRulePatterns` and
  `tableNav` tests).
- `npx tsc --noEmit` — clean.
- `npm run gates` — builds the page, runs gates `[A]` and `[B]` in
  Chromium, 45/45 passing, prints the table, writes
  `results/gates.md`/`gates.json`, exits 0. `lsof -nP -iTCP:4400-4499
  -sTCP:LISTEN` is empty afterward.
- `npm start` — prints the open URL; `curl` of the page returns 200; a
  real Ctrl-C (verified by sending `SIGINT` to the whole process group,
  not just the top pid — confirmed with `ps -o pid,ppid,pgid` that
  `npm start` → the `tsx` CLI → the actual script → the spawned
  `server/main.ts` child all share one process group, the same as a real
  terminal Ctrl-C would hit) stops every process and leaves nothing
  listening.
- Manual check in a real browser (not just Playwright): opened
  `examples/hello.md`, typed into it, opened the Markdown panel, read
  `window.phraise.markdown()` from the console — all matched.

## Notes for the next brief

- The built page bundle is about 608 KB minified (186 KB gzipped) as a
  single chunk — Vite warns about chunk size. Worth watching as more
  extensions are added (brief 03's Mermaid rendering especially); code
  splitting is one option if it grows further.
- `@hocuspocus/server`'s top-level `Server` class exposes a public
  `destroy(): Promise<void>` (confirmed in its `.d.ts`), used directly for
  clean shutdown — no need for spike 5's `(server as any).hocuspocus`
  reach-through.
- `Extension.configure(...)`'s returned instance exposes its raw config
  (including `addProseMirrorPlugins`) via `.config` at runtime, despite
  that property being internal to Tiptap's own TypeScript types —
  confirmed directly with a throwaway probe script before relying on it in
  `test/workaroundOrder.spec.ts`.
- Brief 02: real Playwright `.click()`/rapid `page.keyboard.press()` loops
  raced ahead of ProseMirror's own DOM-selection sync in headless
  Chromium more than once (a `Home` right after `.click()` landing on the
  stale selection; a tight `ArrowRight` loop losing most presses; a
  `Shift+End`/`Shift+ArrowRight` selection extending far past the intended
  range). The fix each time was polling for the actual end state
  (`state.selection`) before the next keystroke, not adding blind delays --
  see `e2e/gateA-typing.spec.ts`'s `placeCaret` and the builder log for the
  specifics. Worth the next e2e-writing brief reading that log before
  assuming a caret/selection is where a `.click()`/keypress sequence
  "should" have put it.
- `serializeDoc`'s `gap` attribute genuinely needs the survivor's `gap`
  invalidated (not just the new block's), whenever content is inserted
  right after an existing top-level block — not only on a fresh Enter
  split. See `src/editing/freshSrc.ts`'s file comment (the paste-into-the-
  last-block finding) if gate C/D/E's own edits turn up a similar "stale
  separator" symptom.
