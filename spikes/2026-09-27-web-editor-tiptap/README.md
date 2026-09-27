# Spike 7: the web editor, briefs 01-03 (foundation, typing, source blocks)

Status: briefs 01, 02 and 03 done. See
[the plan](../../context/plans/2026-09-27-spike-7-plan.md),
[the charter](../../context/plans/2026-09-27-spike-7-charter-web-editor.md),
[brief 01](../../context/plans/2026-09-27-spike-7-brief-01-foundation.md),
[brief 02](../../context/plans/2026-09-27-spike-7-brief-02-typing.md) and
[brief 03](../../context/plans/2026-09-27-spike-7-brief-03-source-blocks.md).
Logs: [brief 01](../../context/logs/2026-09-27-builder-spike-7-foundation.md),
[brief 02](../../context/logs/2026-09-27-builder-spike-7-typing.md),
[brief 03](../../context/logs/2026-09-27-builder-spike-7-source-blocks.md).

## Goal

Brief 01 stood up the application every later brief in this spike builds
on: one server process holding a Hocuspocus relay and a static page
server, a Tiptap 3 editor in a real browser that opens a Markdown file
seeded from disk and can show its Markdown, and a Playwright harness with
a gate reporter. Brief 02 made the editor behave like a word processor
under real keyboard input (typing, splitting/joining, formatting
shortcuts, lists, tables) and added Markdown affordances (input rules,
paste, copy), proving every scenario with Playwright in Chromium against
gates A and B. Brief 03 made the blocks the editor does not model (raw
HTML, front matter, math, footnote/link-reference definitions, and
anything unrecognized) render as labelled, editable source blocks that
never get corrupted by edits around them; Mermaid fences render as
diagrams; an edit the serializer cannot express shows a plain-language
banner instead of failing silently; and the page got plain, clean document
styling (gates C, H, and part of J). Serves D4 and D5 in
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
  serialized Markdown and prove nothing else moved). Brief 03 added
  `gateC-sourceblocks.spec.ts` (`e2e/fixtures/source-blocks.md`: front
  matter, HTML, math, a footnote, a link reference definition, a Mermaid
  fence — verified to round-trip byte for byte before use; plus
  `e2e/fixtures/unsafe-html.md` for the sanitizer test) and
  `gateH-unverified.spec.ts` (`e2e/fixtures/gate-h.md`: an autolink whose
  URL contains a backslash-escaped asterisk — see "Gate H's demonstration"
  below).
- `test/` — vitest unit tests (schema equivalence, byte-for-byte
  round-trip through a Tiptap-built document, workaround plugin order,
  brief 02's `src/editing/` modules: `freshSrc`, `pasteMarkdown`,
  `copyMarkdown`, `inputRulePatterns`, `tableNav`; brief 03's:
  `stripEmptyParagraphs`, `rawBlockLabels`, `frontMatterPreview`,
  `sanitizeHtml` (real DOMPurify against real HTML, in a per-file
  `// @vitest-environment jsdom`), `sourceBlockBoundary`,
  `blockCheckCache` (including a `vi.spyOn` proof that an unchanged
  top-level block is genuinely skipped, not just correctly reported)).
- `corpus/handwritten/` — 28 small hand-authored fixtures, copied from
  spike 5, used by the unit round-trip test and available to e2e tests.
- `corpus/manifest.json`, `corpus/needed.json`, `scripts/fetch-corpus.mjs`
  — fetches two larger real-world files (a README, a Node.js API doc) for
  later briefs' screenshots/scale gates. Fetched files are git-ignored.
- `examples/` — three small fixtures for `npm start` (heading + paragraphs
  + list + code block; a table; a blockquote + ordered list + emphasis).
- `scripts/start.ts` — `npm start`'s implementation.
- `src/editing/` (brief 03, additions) — `stripEmptyParagraphs.ts` (the
  page-level serialize wrapper that omits an empty top-level paragraph
  before handing the doc to `serializeDoc`, which correctly refuses one:
  a blank line has no Markdown form at all), `rawBlockLabels.ts` (kind ->
  plain-word label, e.g. `yaml`/`toml` -> "Page properties", `math` ->
  "Formula", anything unrecognized -> "Source"), `frontMatterPreview.ts`
  (a hand-rolled flat-mapping preview parser, not a real YAML/TOML parser
  — falls back to raw text for anything nested/multi-line),
  `sanitizeHtml.ts` (the DOMPurify config for HTML previews: explicit
  `FORBID_TAGS` for `iframe`/`style`/`object`/`embed`/`form`/`base`/
  `meta`/`link` on top of DOMPurify's own default script/event-handler/
  `javascript:` stripping), `sourceBlockBoundary.ts` (pure position
  arithmetic for the Backspace/Delete/Mod-Enter/ArrowDown gestures around a
  source block), `blockCheckCache.ts` (gate H: a node-identity cache around
  the two new exports below, so a debounced check only re-serializes
  top-level blocks that actually changed).
- `src/model/serialize.ts` (brief 03 addition) — `buildBlockCheckContext`
  and `serializeBlock` are `serializeDoc`'s own internal per-block ladder,
  factored out and exported (no behaviour change to `serializeDoc` itself —
  the full brief 01/02 test suite was re-run after this refactor) so gate
  H's check can verify one changed block without paying for a whole-document
  re-parse every time.
- `web/src/nodeviews/` (brief 03) — the three Tiptap node views:
  `rawBlockView.ts` (source blocks: a label, a rendered preview per kind
  sanitized HTML, KaTeX math, a front-matter key-value list, or raw text —
  and an always-present editable source `contentDOM`, toggled visible by
  whether the caret is inside it or "Edit source" was clicked; also
  renders gate H's unverified-block banner for `kind: 'unverified'`),
  `rawInlineView.ts` (inline math via KaTeX; an unobtrusive chip with the
  raw source in its tooltip for inline HTML/footnote references/anything
  else), `codeBlockView.ts` (a plain labelled code block, or for
  `lang: mermaid` the rendered-diagram/editable-source pattern, with
  `mermaid` loaded only through a dynamic `import()` so it is its own
  bundle chunk).
- `web/src/editing/` (brief 03 additions) — `sourceBlockKeymap.ts`
  (Backspace/Delete select the adjacent source block instead of merging
  into it; Mod-Enter/ArrowDown-at-the-last-line exit any `code: true`
  block), `unverifiedCheck.ts` (gate H: the debounced, local-transaction-
  only check that replaces an unverifiable block with a `raw_block` of
  kind `unverified`, and the "Keep this"/"Undo my change" logic the
  banner's buttons call into). `pasteRule.ts` gained one guard line so a
  paste into a source block never tries to insert block-level Markdown
  content into inline-only content.

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

`npm run gates` runs gates `[A]` (22 tests), `[B]` (23 tests), `[C]`
(6 tests) and `[H]` (4 tests); later briefs add D, E, F, G, I, J and K.
The reporter marks every gate with no tests "not run", not a failure.
Every gate that does run passes.

## Gate H's demonstration

Brief 03 tried both constructs the brief itself suggests (a paragraph with
`&#10;&#10;` entities edited elsewhere; `***foo** bar*` with a bold
toggle) with the real serializer, plus a fuzz across every CommonMark spec
example — both suggested constructs, and all 132 nested-emphasis examples
under every mark-toggle, verify successfully with this serializer's
re-serialize ladder; they are evidently already-fixed regressions from
spike 1's original remark-only findings, not live bugs. The demonstration
used instead: CommonMark spec example 20 ("Backslash escapes"), an
autolink `<https://example.com?find=\*>` whose URL text contains a
backslash-escaped asterisk. Removing its `link` mark (a real generic core
command, `unsetMark('link')`) leaves a plain text run the serializer
cannot re-express as unlinked plain text that reparses back to the same
literal `\*` — confirmed to really throw `UnverifiedSerializationError`,
not assumed. See the builder log for the full fuzz results (46 real
failures found across 652 spec examples and two edit types) and why this
one was picked over the others (single paragraph, not a multi-block
fixture).

Mod-E (inline code) is this spike's own choice of shortcut: Google Docs has
none for inline code. Documented where it's wired,
`web/src/editing/markShortcuts.ts`.

Ports: the Playwright fixture picks a random free port in 4400-4449 per
test (charter's range for this spike); `npm start` uses 4480 (page) and
4481 (relay), matching the plan. Everything binds `127.0.0.1` only.

## Verified

- `npx vitest run` — 14 files, 117 tests, all passing (brief 01's schema
  equivalence, corpus round-trip and workaround-order tests; brief 02's
  `freshSrc`, `pasteMarkdown`, `copyMarkdown`, `inputRulePatterns` and
  `tableNav` tests; brief 03's `stripEmptyParagraphs`, `rawBlockLabels`,
  `frontMatterPreview`, `sanitizeHtml`, `sourceBlockBoundary` and
  `blockCheckCache` tests).
- `npx tsc --noEmit` — clean.
- `npm run gates` — builds the page, runs gates `[A]`, `[B]`, `[C]` and
  `[H]` in Chromium, 55/55 passing, prints the table, writes
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

## Bundle sizes (brief 03, after the Mermaid split)

Measured with `npx vite build` from a clean `dist/`, comparing against the
brief-02 baseline (same command, run against the working tree with brief
03's changes temporarily stashed):

| | before brief 03 | after brief 03 |
|---|---|---|
| main `index-*.js` | 608.34 KB (185.79 KB gzip) | 914.10 KB (279.70 KB gzip) |
| CSS | 1.07 KB | 36.48 KB (9.70 KB gzip) |
| `mermaid` + its diagram-type sub-chunks | not present | ~2 MB raw across ~60 chunks (`mermaid.core-*.js` 666 KB alone), **loaded only on demand** |

**Mermaid is confirmed never in the initial load**: grepping the built
`index.js` for the mermaid chunk's own filename finds it referenced only
inside the one `import('mermaid')` call in `loadMermaid()`
(`web/src/nodeviews/codeBlockView.ts`) — Vite/Rollup puts it in its own
chunk and the page never fetches it unless a document actually contains a
`lang: mermaid` code block.

**katex is NOT similarly split**, and accounts for most of the ~306 KB
increase in the main chunk: `web/src/nodeviews/{rawBlockView,
rawInlineView}.ts` import it statically (`import katex from 'katex'`), so
Rollup inlines katex's ~250 KB (minified) directly into `index.js` rather
than lazy-loading it. Mermaid ships its OWN separate, already-lazy copy of
katex (`katex-*.js`, one of its dynamic-import-only chunks) for its own
internal math rendering; grepping the built `index.js` finds zero
references to that chunk's filename, confirming our static import is not
even sharing it — it is a second, fully-inlined copy. The brief only
asked for Mermaid to be dynamically imported, so this was left as a
static import for simplicity; dynamic-importing katex too (matching the
Mermaid pattern) is a straightforward follow-up if initial load size
becomes a real concern before a non-technical user ever opens a document
with a formula in it. DOMPurify (~84 KB source, small once minified)
accounts for the rest of the increase.

## Notes for the next brief
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
- Brief 03: two more real Playwright/browser races, same shape as brief
  02's. (1) A native `End` keypress inside a multi-line `<pre>` (real
  embedded newlines) moves to the end of the current VISUAL line, not the
  block's own last line — not usable for "place the caret at the very end
  of this source block". Fixed by computing the exact position directly
  from the node's own `nodeSize` and driving selection via
  `editor.commands.setTextSelection`, keeping only the actual edit as a
  real keyboard event. (2) Clicking a button whose `mousedown` handler
  calls `editor.commands.focus()` does not synchronously move real DOM
  focus in headless Chromium — confirmed via `document.activeElement`
  right after the click (still `<body>`); the very first keystroke sent
  right after is lost. Fixed by polling for `document.activeElement`
  carrying the `ProseMirror` class before typing. See
  `e2e/gateC-sourceblocks.spec.ts` and the builder log.
- `checkSchemaEquivalence` is unaffected by adding a node view via
  `.extend({ addNodeView: ... })` on one of the generically-converted
  extensions (confirmed: `test/schemaEquivalence.spec.ts` still passes) —
  this is the pattern to follow for any FUTURE node view too, rather than
  hand-writing a new Tiptap Node.
- `Node | Mark` union values from `buildTiptapExtensions()` cannot have
  `.extend()` called on them directly (TypeScript can't resolve the
  overloaded union signature); narrow with `instanceof` against Tiptap's
  own `Node`/`Mark` classes first (`web/src/main.ts`'s `baseExtensions`).
- Playwright's fixture-option merging broke on a `test.use({ seedFiles:
  [...] })` call whose array had MORE THAN ONE element (`TypeError:
  seedFiles is not iterable`, reproduced with a minimal throwaway spec,
  deleted before committing); a single-element array was fine. Worked
  around by using a separate `test.use()` per fixture file (one at the top
  of the file, one inside a nested `test.describe()` for a second fixture)
  — the same shape `gateB-inputrules.spec.ts` already uses for its own
  second fixture, so likely worth remembering rather than re-discovering.
- Gate H's per-block cache (`src/editing/blockCheckCache.ts` +
  `web/src/editing/unverifiedCheck.ts`) measured on
  `corpus/fetched/nodejs-node-docapinapimd.md` (240 KB, 1619 blocks): a
  cold full check costs ~1.2s (dominated by `detectDocStyle`'s one
  full-document re-parse, the same cost `serializeDoc` itself pays); a
  second check after ONE small paragraph edit, with the cache warm, costs
  ~6 ms — about 200x faster than calling `serializeDoc` again on the whole
  document (~1.2s). The context (link/footnote definitions + detected
  style) is only recomputed when the set of definition blocks changes, not
  on every check.
