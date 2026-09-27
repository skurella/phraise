# Spike 7: the web editor in a real browser

## Final state (orchestrator, 2026-09-28)

Findings: [spike 7 findings](../../context/docs/2026-09-27-spike-7-findings-web-editor.md). Orchestrator log: [log](../../context/logs/2026-09-27-orchestrator-spike-7.md).

```bash
npm ci
npm run setup      # Playwright browsers into .pw-browsers/ (git-ignored) and the three fetched corpus files
npm test           # vitest unit tests
npm run typecheck  # tsc --noEmit
npm run gates      # builds, runs every gate, prints the gate table and a WebKit table, writes results/
npm start          # builds, seeds examples/ into a temporary directory, prints http://127.0.0.1:4480/?doc=hello.md&user=Alice
```

`npm run gates` (`scripts/gates.ts`) exits non-zero if any Chromium gate A to K fails or has no tests. WebKit runs gates A to D and is reported in a second, informational table. Firefox is opt-in (`PHRAISE_FIREFOX=1 npm run gates`) because it does not launch on the owner's machine. Gate J rewrites the PNGs in `screenshots/` on every run; commit them only when the look changed on purpose.

Corrections to the brief sections below, made by the orchestrator:

- **U+00A0.** The brief 05 section calls a typed space turning into U+00A0 "a Chromium quirk under load". The cause was ours: the page built Tiptap with `injectCSS: false`, and without Tiptap's base CSS the editable lacks `white-space: pre-wrap`, so Chromium inserts U+00A0 for a trailing space. Fixed with `injectCSS: true`; the tests no longer normalize it away.
- **Line keys in tests.** `e2e/keys.ts` gives Home and End in Chromium and Cmd+Left and Cmd+Right in WebKit on macOS, where Home and End scroll.
- **Retries.** Every retry of a keyboard or click action in a test prints a `[...-retry]` line, so a dropped keystroke cannot hide.
- **Origin.** `src/model/serialize.ts` is not byte-identical to spike 5 any more: brief 03 extracted the per-block ladder into an exported `serializeBlock` and `buildBlockCheckContext` for the gate H cache, without changing `serializeDoc`'s behaviour. `src/collab/tiptapWorkaroundsExtension.ts` gained the third workaround plugin in brief 05.

## History

Status: briefs 01-07 done; brief 08 was the review. See
[the plan](../../context/plans/2026-09-27-spike-7-plan.md),
[the charter](../../context/plans/2026-09-27-spike-7-charter-web-editor.md),
[brief 01](../../context/plans/2026-09-27-spike-7-brief-01-foundation.md),
[brief 02](../../context/plans/2026-09-27-spike-7-brief-02-typing.md),
[brief 03](../../context/plans/2026-09-27-spike-7-brief-03-source-blocks.md),
[brief 04](../../context/plans/2026-09-27-spike-7-brief-04-collab-offline.md),
[brief 05](../../context/plans/2026-09-27-spike-7-brief-05-caret-ime.md) and
[brief 06](../../context/plans/2026-09-27-spike-7-brief-06-comments.md).
Logs: [brief 01](../../context/logs/2026-09-27-builder-spike-7-foundation.md),
[brief 02](../../context/logs/2026-09-27-builder-spike-7-typing.md),
[brief 03](../../context/logs/2026-09-27-builder-spike-7-source-blocks.md),
[brief 04](../../context/logs/2026-09-27-builder-spike-7-collab-offline.md),
[brief 05](../../context/logs/2026-09-27-builder-spike-7-caret-ime.md),
[brief 06](../../context/logs/2026-09-27-builder-spike-7-comments.md).

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
styling (gates C, H, and part of J). Brief 04 proved the collaboration,
undo and offline gates in real browsers: presence (name badges, coloured
carets), an image address/link popover whose Apply edits the image's `url`
and its `link` mark together in one transaction (spike 5's gate B3 edit),
two real browser contexts converging on typed edits and on that image edit
through the relay (gate D); per-client undo/redo via
`@tiptap/extension-collaboration`'s own Yjs `UndoManager` (gate E); and a
real offline path with `y-indexeddb` and a hand-written service worker,
surviving a reload and a full page close/reopen while offline and
reconverging with no edit lost once back online (gate I). Serves D4, D5
and D6's offline path in
[the architecture decisions](../../context/docs/2026-09-27-architecture-decisions.md).
Brief 05 fixed a real y-tiptap 3.0.9 selection-recovery bug (an idle local
caret does not follow a remote edit earlier in the same paragraph) with a
third workaround plugin, without touching `node_modules`; root-caused and
fixed two real gate E/full-suite flakes (a rare CDP input-delivery miss,
and a rare Chromium contentEditable space-to-U+00A0 substitution under
parallel load); added gate G (IME composition through the DevTools
protocol -- Japanese, Chinese pinyin, cancellation, a concurrent remote
mark change, an empty paragraph, a table cell, all alongside a second
user editing the same document); and added pending-IndexedDB-write
tracking with a "Saving on this device" status, `pagehide`/
`visibilitychange` flushing and a `beforeunload` prompt for gate I, plus a
measurement of how much an offline edit survives closing the page the
instant after typing.
Brief 06 added comments (gate F): a thread data model in a `Y.Map` outside
the document fragment (so comments never touch the Markdown), a headless
CRDT/quote-selector-fuzzy/orphaned anchor resolver (D3, as amended after
spike 2) built over a from-scratch ProseMirror-tree plain-text projection
(not spike 2's single-`Y.XmlText`-per-block one, which this richer schema
doesn't have), a decoration-based highlight plugin, and a sidebar with a
composer (floating "Comment" button or Mod-Alt-M), replies, resolve/
reopen, an "Orphaned" group and a "Show resolved" toggle -- all proved
with two (and, for persistence, three) real browser contexts and real
keyboard/mouse input.

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
- `src/collab/presence.ts` (brief 04) — `colorForName` (deterministic
  `#rrggbb` hex from a name -- hex, not `hsl(...)`: see the file's own
  comment for why `@tiptap/extension-collaboration-caret` silently
  discards anything else) and `buildPresenceBadges` (the awareness-array
  -> top-bar-badge-list pure logic).
- `src/offline/editorGate.ts` (brief 04) — `createBuildGate`: "build the
  editor after whichever comes first" as a plain two-source promise race,
  first call wins.
- `src/offline/status.ts` (brief 04) — `deriveSyncStatus`/`STATUS_LABEL`:
  the "Saved"/"Offline, changes kept on this device"/"Reconnecting"
  status indicator's state machine, a pure function of browser-online +
  relay-connection-status.
- `src/editing/imageEdit.ts` (brief 04) — `buildImageEdit`: the image
  popover's Apply/Remove-link new attrs+marks, given the real schema and
  node. Preserves an existing `link` mark's other attrs; only `href` (or
  `url` for the image itself) is overwritten. The caller (`web/src/
  editing/imagePopover.ts`) dispatches both in ONE
  `tr.setNodeMarkup(pos, undefined, attrs, marks)` -- this is spike 5's
  gate B3 edit (an image's address and its link, changed together),
  which showed data loss on Yjs 14; here, through the `leafMarks`
  workaround, it round-trips through the relay correctly in both browser
  contexts.
- `web/src/editing/imagePopover.ts` (brief 04) — the click-on-image
  ProseMirror plugin (`handleClickOn`) and its lazy popup (two fields,
  "Image address" and "Link", Apply/Remove-link buttons), same
  self-contained-popup pattern as `linkShortcut.ts`. Its static layout
  lives in `style.css`, not as an inline style -- see the file's own
  comment for the real hidden-attribute-vs-inline-`display` bug that came
  from mixing the two.
- `web/src/presenceView.ts` / `web/src/statusView.ts` (brief 04) — thin
  DOM-rendering functions over the two pure modules above; wired from
  `provider.awareness`'s `update` event and `provider`'s `status` event +
  `window`'s `online`/`offline` events in `main.ts`.
- `web/public/sw.js` + `web/src/offlineShell.ts` (brief 04) — the offline
  app shell. Vite's build output has hashed/unpredictable chunk names (and
  further code-splits Mermaid), so rather than a build-time precache
  manifest, the PAGE itself explicitly primes the cache after a
  successful load (`primeOfflineCache`: its own navigation URL,
  `/config.json`, and every same-origin URL from `performance
  .getEntriesByType('resource')`) -- deterministic, not dependent on the
  service worker's own install/activate timing racing the very first
  page load (which a precache list would hit, since the worker cannot
  control fetches made before it activates). The worker's own `fetch`
  handler is network-first, caching every successful same-origin GET as
  a bonus, and falls back to the cache (`ignoreSearch`) when offline.
  `window.phraise.offlineReady` (a promise) lets a test/consumer wait for
  both "worker active" and "shell primed" before relying on offline
  support, instead of guessing at timing.
- `web/src/main.ts` (brief 04 rewiring) — builds the `Y.Doc` with BOTH a
  `y-indexeddb` `IndexeddbPersistence` (one database per document name,
  `phraise-doc:<docName>`) and the `HocuspocusProvider`, and awaits
  `createBuildGate()`'s `ready` before constructing the editor: the
  IndexedDB side only settles the gate when the doc's own Y.XmlFragment
  is ALREADY non-empty (a previous offline session's content) -- an
  empty, freshly-opened IndexedDB in a new browser profile must not win
  the race against the provider's real sync, or the editor (and spike
  5's workaround plugins) would see an empty document instead of the
  real one. Adds `ImagePopover` to the extensions array (no schema
  change: `test/schemaEquivalence.spec.ts` still passes) and exposes
  test-only `window.phraise.builtFrom`, `flushIndexeddb()`,
  `offlineReady`, `statusLabel()` alongside the existing hooks.
- `src/collab/workarounds/localCaretFollow.ts` (brief 05, workaround 3 of
  3) — for a transaction the binding dispatches for a remote change or a
  local undo/redo, recomputes a plain text selection purely from the Yjs
  relative position, bypassing `@tiptap/y-tiptap` 3.0.9's
  `recoverSelectionEndpoint` structural-move heuristic (added upstream in
  3.0.6/3.0.7 for drag-and-drop, but also misfires for an ordinary
  concurrent edit in the same paragraph -- see the file's own comment and
  the builder log for the confirmed bug and the upstream issue text).
  `node`/`nodeRange`/`all` selections are left untouched. Wired into
  `PhraiseWorkarounds` last; order enforced by `test/workaroundOrder.spec.ts`.
- `src/offline/pendingWrites.ts` (brief 05) — `createPendingWriteTracker`:
  tracks IndexedDB writes in flight by piggybacking on the same
  `storeState(persistence, true)` `flushIndexeddb()` already uses; every
  local doc update starts one flush, `pendingCount()` is the number not
  yet settled. Backs the "Saving on this device" status and the
  `pagehide`/`visibilitychange`-triggered flush and `beforeunload` prompt
  in `web/src/main.ts`.
- `e2e/gateG-ime.spec.ts` (brief 05) — IME composition through the
  DevTools protocol (`page.context().newCDPSession(page)`,
  `Input.imeSetComposition`, `Input.insertText`); see "Brief 05" below.
- `src/comments/` (brief 06, pure, no ProseMirror/DOM) — `model.ts`
  (`THREADS_MAP_NAME`, a top-level `Y.Map` of threads, each itself a
  nested `Y.Map` so its `messages` field can be a `Y.Array`: concurrent
  replies from two replicas both survive Yjs's own array-CRDT ordering;
  `createThread`/`addReply`/`setResolved`/`getThread`/`listThreads`/
  `observeThreads`), `textProjection.ts` (`projectDocText`: a plain-text
  projection of a ProseMirror `Node` tree, joining textblocks with `\n\n`
  and representing an inline atom as one `￼` placeholder character,
  plus `posToOffset`/`offsetToPos`), `anchor.ts` (the D3 anchor record --
  a CRDT relative-position pair as `Y.relativePositionToJSON`, the quote
  selector, and creation-time offsets -- `AnchoringContext` built either
  headlessly via `@tiptap/y-tiptap`'s own `initProseMirrorDoc` or, live,
  from the editor's `ySyncPlugin` binding's `doc`/`type`/`mapping`;
  `buildAnchorRecord`/`resolveAnchor`'s CRDT-then-fuzzy-then-orphaned
  order; `fuzzyAnchor`/`contextOnlyAnchor` ported from spike 2's
  `src/rebase/comments.ts`, see "Origin of copied code" below), and
  `relativeTime.ts` (`formatRelativeTime`).
- `web/src/comments/` (brief 06) — `liveContext.ts` (`liveAnchoringContext`:
  the live `AnchoringContext` constructor, reading the same binding fields
  `src/collab/workarounds/localCaretFollow.ts` already does), `highlightPlugin.ts`
  + `highlightExtension.ts` (`commentHighlightPlugin`/`CommentHighlights`:
  the decoration plugin -- no marks, no schema change -- recomputing on
  every `docChanged` transaction or an explicit `refreshCommentHighlights`
  meta transaction; skips resolved and orphaned threads; the active
  thread gets a stronger highlight; `handleClick` activates a thread),
  `commentTrigger.ts` (`CommentTrigger`: the floating "Comment" button,
  same lazy-DOM-element pattern as `web/src/editing/imagePopover.ts`, and
  the Mod-Alt-M keyboard shortcut), `sidebar.ts` (`renderSidebar`: threads
  grouped as active (sorted by resolved position) / Orphaned / Resolved
  (behind the "Show resolved" toggle), the composer, and
  `captureDraftFocus`/`restoreDraftFocus` so a focused reply/composer
  textarea's value and caret survive a rerender triggered by someone
  else's edit), and `controller.ts` (`CommentsController`: the only
  per-tab-local state -- active thread, pending composer selection, show-
  resolved toggle -- and the wiring between the Y.Map observer, the
  highlight plugin's refresh, and the sidebar's (debounced, 250ms)
  rerender on document changes).
- `e2e/gateF-comments.spec.ts` (brief 06) + `e2e/fixtures/comments.md`
  (verified byte-identical round-trip before use) — gate F, two (and, for
  the reload/fresh-context test, three) real browser contexts, real
  keyboard (`Shift+ArrowRight` phrase selection) and mouse; see "Brief 06"
  below.
- `test/comments/` (brief 06) — `model.spec.ts` (lifecycle + three
  concurrent-merge scenarios, two real `Y.Doc`s exchanging
  `Y.encodeStateAsUpdate`/`Y.applyUpdate`, no relay, no EditorView),
  `textProjection.spec.ts`, `anchor.spec.ts` (the CRDT/fuzzy/orphaned
  resolution order and the acceptance rule's hand cases, including the
  ambiguity guard), `relativeTime.spec.ts`.

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

`src/comments/anchor.ts`'s fuzzy-matching functions (`fuzzyAnchor`,
`contextOnlyAnchor`, `contextSimilarity`, `levenshtein`, `charSimilarity`,
and the acceptance-rule constants) are ported, not copied unchanged, from
`origin/spike/2026-09-27-collab-stack` at `eeb3fe2`'s
`spikes/2026-09-27-collab-stack-yjs13-hocuspocus/src/rebase/comments.ts`
(brief 06). Spike 2's version resolves offsets through its own
`docPlainText`/`offsetToPosition` (one `Y.XmlText` per textblock,
guaranteed by its toy schema); this port resolves them through
`src/comments/textProjection.ts`'s ProseMirror-`Node`-tree projection
instead (this schema's textblocks can mix `Y.XmlText` runs with sibling
inline-atom `Y.XmlElement`s, which spike 2's schema never has to handle),
and positions are PM positions, not raw `Y.XmlText` character indices.
The data model (`model.ts`) and the anchor-record builder/resolver
(`anchor.ts`'s `AnchorRecord`/`buildAnchorRecord`/`resolveAnchor`) are new
code shaped around D3 as amended, not copied from spike 2's
`CommentRecord`/`addComment`/`resolveComment` (a different Yjs binding --
`@tiptap/y-tiptap`'s exported `initProseMirrorDoc`/
`absolutePositionToRelativePosition`/`relativePositionToAbsolutePosition`,
not spike 2's own hand-rolled `RelativePosition` walk over a single
`Y.XmlText`).

## Commands

```bash
npm ci                 # install
npm run setup          # Playwright browsers (.pw-browsers/, git-ignored) + the two fetched corpus files
npm test               # vitest: 175 unit tests
npm run typecheck      # tsc --noEmit
npm run gates          # builds the page, runs the Playwright gates, prints the gate table
npm start              # builds if needed, seeds from examples/, serves on 127.0.0.1:4480 (relay 4481)
```

`npm run gates` runs gates `[A]` (22 tests), `[B]` (23 tests), `[C]`
(6 tests), `[D]` (6 tests), `[E]` (3 tests), `[F]` (6 tests), `[G]`
(6 tests), `[H]` (4 tests) and `[I]` (2 tests); J and K are still out of
scope. The reporter marks every gate with no tests "not run", not a
failure. Every
gate that does run passes.

`expect: { timeout: 15_000 }` in `playwright.config.ts` (raised in two
steps: 5s -> 10s in brief 04, 10s -> 15s in brief 05) applies to every
`expect.poll`/`toBeVisible` etc. in the suite: gate D/E/I's multi-context
tests poll for a real cross-client network round trip (relay -> the
other browser's own WebSocket -> its `ySyncPlugin`/`y-tiptap` apply
cycle), and under `npm run gates`' full worker parallelism (several
Chromium instances and relay processes competing for CPU at once) that
round trip can take noticeably longer than a lower timeout. Brief 05 also
root-caused and fixed, at their actual cause rather than by raising this
timeout further, two other real flakes found running the whole suite
with `--repeat-each=5` at default worker parallelism: a rare CDP
input-delivery miss (`page.keyboard.type()` occasionally not reaching the
page at all) and a rare Chromium contentEditable quirk under CPU
contention (a typed space landing as U+00A0 instead of U+0020, reaching
even the serialized Markdown) -- see the builder log for both. The whole
suite, `--repeat-each=5` at default workers, passed 360/360 three times
in a row after these fixes.

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

- `npx vitest run` — 24 files, 175 tests, all passing (brief 01's schema
  equivalence, corpus round-trip and workaround-order tests; brief 02's
  `freshSrc`, `pasteMarkdown`, `copyMarkdown`, `inputRulePatterns` and
  `tableNav` tests; brief 03's `stripEmptyParagraphs`, `rawBlockLabels`,
  `frontMatterPreview`, `sanitizeHtml`, `sourceBlockBoundary` and
  `blockCheckCache` tests; brief 04's `presence`, `editorGate`,
  `syncStatus` and `imageEdit` tests; brief 05's `localCaretFollow` and
  `pendingWrites` tests, plus `syncStatus`/`workaroundOrder` extended;
  brief 06's `test/comments/model`, `textProjection`, `anchor` and
  `relativeTime` tests, 27 in all).
- `npx tsc --noEmit` — clean.
- `npm run gates` — builds the page, runs gates `[A]`, `[B]`, `[C]`,
  `[D]`, `[E]`, `[F]`, `[G]`, `[H]` and `[I]` in Chromium, 78/78 passing,
  prints the table, writes `results/gates.md`/`gates.json`, exits 0.
  `lsof -nP -iTCP:4400-4499 -sTCP:LISTEN` is empty afterward.
- Whole-suite flake sweep (brief 05, before gate F existed):
  `playwright test --repeat-each=5` at default worker parallelism, run
  three times in a row after the two flake fixes documented there:
  360/360 passing every time. Brief 06's own file:
  `playwright test e2e/gateF-comments.spec.ts --repeat-each=5
  --workers=1` — 30/30 passing (a full-suite repeat-each sweep including
  gate F is the orchestrator's own long-verification-run call per the
  charter, not repeated here).
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

## Brief 04: how gate D/E/I were verified, and what was found

- **Offline simulation**: `browserContext.setOffline(true)` was tried
  first (per the brief's own suggestion to find what works) and confirmed
  to genuinely cut an already-connected Hocuspocus WebSocket in headless
  Chromium — the status indicator flips to "Offline, changes kept on this
  device" within well under a second, and a second, still-online browser
  context genuinely never receives an edit typed while the first is
  offline. The documented fallback (stop the relay process, or route
  around it) was not needed.
- **Real bugs found by running the tests, not guessed** (full detail in
  the builder log):
  1. Locating a paragraph by `hasText` breaks the instant a REMOTE user's
     caret lands inside it (`CollaborationCaret` injects the caret's name
     label as a real DOM text node into that paragraph's own subtree,
     changing its `textContent`). Fixed by locating paragraphs
     structurally (`#editor .ProseMirror > p`, `nth(index)`) in every
     gate D/E/I test, never by `hasText`.
  2. `colorForName`'s original `hsl(...)` string was silently replaced
     with `transparent` by `@tiptap/extension-collaboration-caret`'s own
     `sanitizeUserColor` helper (`isValidColor` only accepts `#rrggbb`
     hex) — both users' caret labels rendered fully transparent. Fixed by
     changing `colorForName` to return hex.
  3. An idle remote user's ProseMirror selection is NOT remapped through
     someone else's edit elsewhere in the same paragraph on this stack —
     confirmed by polling, not assumed. A test originally designed around
     two carets placed simultaneously before either user typed was
     redesigned so the second user places their caret (real keyboard
     navigation) AFTER the first edit has already converged on their
     page. Worth the next brief's attention if a future gate needs a
     remote cursor to visually track someone else's edits while idle.
  4. Undo grouping (confirmed empirically with a throwaway probe, see the
     log): Yjs's `UndoManager` groups by real elapsed time (~500ms
     `captureTimeout`), not by word. Against this LOCAL relay, a full
     click+poll+type+poll round trip comfortably finishes within that
     window, so an explicit pause is needed between two edits meant to
     land in separate undo groups — this is the actual thing under test
     (crossing the real timeout boundary), not a substitute for polling.
  5. A CSS bug, not a test bug: the image popover's own inline
     `display: 'flex'` permanently overrode the `hidden` attribute's
     default `display: none`, so it never actually hid after Apply.
     Fixed by moving static layout into `style.css`.
- `img:not(.ProseMirror-separator)` is needed everywhere images are
  located/counted in gate D/E/I — ProseMirror renders invisible
  `.ProseMirror-separator` `<img>` placeholders around inline atoms that
  otherwise shift `nth()` indices.

## Brief 05: the caret fix, IME (gate G), and the flake sweep

- **The caret bug (finding 1) and its fix**: `@tiptap/y-tiptap` 3.0.9's
  `restoreRelativeSelection` resolves a plain text selection correctly
  from the Yjs relative position, then runs it through
  `recoverSelectionEndpoint`'s `isMisresolvedAfterStructuralChange`
  heuristic (added upstream in 3.0.6/3.0.7 for drag-and-drop block
  moves), which treats ANY change to the selection's paragraph's
  `textContent` as a misresolution and can substitute a stale/wrong
  position for the already-correct one. Reproduced against the real app
  (a minimal hand-rolled two-`Y.Doc` unit test did NOT reproduce it —
  see the builder log for why) with two new `e2e/gateD-collab.spec.ts`
  tests, and confirmed as a true positive by temporarily removing the fix
  and observing the exact predicted corruption (`AAA AlicXYZe's
  paragraph...` instead of `AAA Alice's XYZparagraph...`). Fixed by
  `src/collab/workarounds/localCaretFollow.ts`, a third `PhraiseWorkarounds`
  plugin, without touching `node_modules` or the pinned version. Upstream
  issue text (title, minimal repro, cause) written into the builder log
  for the lead to file.
- **Gate E's flake** (the "type alternately" test, 2/18 in the
  orchestrator's own measurement): root-caused as a real, rare (~1 in
  100-150) CDP input-delivery miss on this machine — `page.keyboard.type()`
  occasionally dispatches into a page that had real focus established
  moments earlier, yet the keystrokes never reach the document at all
  (confirmed: polling the local model for 30+ further seconds afterward
  showed it never changes, versus single-digit milliseconds when it
  works). Fixed with `typeAndVerify` (type, poll the LOCAL selection,
  retry the same text if nothing landed) in every gate E/G/I test file
  that types through two alternating users.
- **Gate I: pending-write tracking, "Saving on this device", the
  close-at-once measurement**: `src/offline/pendingWrites.ts` tracks
  IndexedDB writes in flight; `deriveSyncStatus` gains a `saving` state;
  `main.ts` flushes on `pagehide`/`visibilitychange` and registers a
  `beforeunload` prompt when offline with a write still pending. The
  existing gate I test now waits for "Offline, changes kept on this
  device" before closing the page (what a real user would see and wait
  for) — the fix for the orchestrator's own 6/24 measurement. A NEW test,
  explicitly a finding and not a gate, measures what happens WITHOUT that
  wait: closing the instant after typing, offline, survived only
  **21/100 (21%)** of the time across ten runs of ten repetitions each,
  always all-or-nothing (never a partial/corrupted string) — confirmed
  the app really does attempt a flush every time the page could be going
  away (a temporary `console.log` inside the flush handler showed it
  firing for all 100 attempts), but a tab close does not wait for async
  IndexedDB work to finish, a platform limitation this fix narrows but
  cannot close.
- **Gate G (IME composition)**, new, driven through the DevTools protocol
  (`Input.imeSetComposition`, `Input.insertText`; Playwright's own
  `keyboard` API cannot simulate an in-progress, uncommitted composition
  at all). Real finding, confirmed directly: `editor.view.composing`
  genuinely reads `true` during an active CDP-driven composition, but
  ProseMirror applies each preview step as real, already-synced document
  content — the live, still-uncommitted preview reaches OTHER users'
  pages before any commit, and a plain mouse click on a paragraph another
  user is actively composing in can land on `CollaborationCaret`'s own
  caret/label DOM decoration instead of on editable text (never moving
  the selection at all). Worked around with `editor.commands
  .setTextSelection` for positioning instead of clicks. All 6 scenarios
  (Japanese, Chinese pinyin, a cancelled/empty commit, a concurrent
  remote mark change, an empty paragraph, a table cell) pass reliably —
  no `test.fail()` scenarios were needed in the end, once a real (not
  guessed) timing race between a local typist and a still-arriving
  remote composition preview was fixed the same way as gate E's flake
  (wait for the remote change to actually finish arriving before typing).
- **The flake sweep** (`playwright test --repeat-each=5`, default
  workers, whole suite): found and fixed, at their cause, the gate E
  input-delivery flake's own retry logic being too strict under real
  parallel load (it could see "landed, just slower than 2s" and
  mistakenly treat that as "nothing landed"), and a genuine Chromium
  contentEditable quirk under CPU contention where a typed space lands as
  U+00A0 (non-breaking space) instead of U+0020 — confirmed to reach not
  just the live DOM but this app's own serialized Markdown, via a
  char-code dump of a captured failure. Normalized at the two points
  these three gate files read text back for comparison
  (`selectionInfo()`, `markdown()`). Three consecutive clean 360/360 runs
  after both fixes.
- A second, independent confirmation of the `seedFiles` multi-element
  array Playwright fixture-option bug this README already documented
  (see "Notes for the next brief" below): hit again in
  `e2e/gateG-ime.spec.ts` and `e2e/gateI-offline.spec.ts`'s new
  measurement test, worked around the same way (a nested `test.describe`
  per extra fixture file, or copying a seed file directly into
  `phraiseServer.seedsDir` at runtime for a test needing many of them).

## Brief 06: comments (gate F), what was found

- **Two real bugs, both confirmed against the real app first (not
  guessed), before being fixed**:
  1. `Decoration.inline(from, to, attrs, spec)` takes `attrs` and `spec`
     as two SEPARATE constructor arguments (confirmed by reading
     `node_modules/prosemirror-view/dist/index.d.ts`'s own signature).
     The first version put `data-thread-id` only in `attrs` and tried to
     read it back off `.spec` in `handleClick`; `.spec` is empty unless a
     spec object is passed explicitly. Symptom: clicking inside a
     highlight never activated its thread. Fixed by passing
     `{threadId: thread.id}` as the fourth argument.
  2. The threads `Y.Map` lives OUTSIDE the ProseMirror-bound fragment (by
     design, so comments never touch the Markdown), which means TWO
     things don't automatically follow from "the highlight plugin
     recomputes on every `docChanged` transaction": (a) a remote thread
     change (new comment/reply/resolve from another replica) produces no
     ProseMirror transaction at all, so nothing told the highlight plugin
     to recompute — Bob's sidebar updated but his highlight never
     appeared until `web/src/comments/controller.ts`'s Y.Map observer was
     made to also call `refreshCommentHighlights`; (b) a thread becoming
     ORPHANED is purely a consequence of a document edit (the quoted text
     deleted), with no write to the threads map at all — the sidebar's
     own "which group is this thread in" grouping only ran from
     thread-map-triggered or locally-triggered renders, so an orphaning
     edit left the sidebar showing the thread as still-active. Fixed by
     also calling `render()` (debounced 250ms) on every `docChanged`
     editor transaction.
- **A real, not-a-bug finding**: a single logical `Decoration.inline`
  range can render as MORE THAN ONE `<span>` once an edit lands strictly
  inside it — ProseMirror renders one wrapper element per contiguous
  pre-existing inline text node rather than merging adjacent ones under
  one decoration. `e2e/gateF-comments.spec.ts`'s `highlightedText()`
  helper joins `allTextContents()` across however many spans exist
  (document order) instead of asserting a single element.
- **A design decision recorded, not a bug**: debouncing the doc-changed
  sidebar rerender (task above) meant a focused reply/composer textarea
  could otherwise be wiped by someone else's edit arriving mid-typing, so
  `sidebar.ts` gained `captureDraftFocus`/`restoreDraftFocus` — the
  focused field's identity, value and caret are captured before a rebuild
  and restored after.
- **`fuzzyAnchor`'s ambiguity guard didn't cover its own fallback path**:
  found while writing `test/comments/anchor.spec.ts`'s hand case for "a
  second location scores nearly as well" (two byte-identical copies of
  one sentence, far enough apart that their 32-character context windows
  never overlap). The main quote-search path's ambiguity guard correctly
  refused to pick either occurrence, but execution then fell through to
  `contextOnlyAnchor` (the "quoted text was edited in place" fallback),
  which scored each candidate on its own small scale and picked the best
  one with NO ambiguity check of its own — so it silently picked one of
  the two identical locations anyway. Fixed by scoring every
  `contextOnlyAnchor` candidate with the SAME weighted formula the
  quote-search path uses and applying the same `AMBIGUITY_MARGIN` guard.
  A genuine correctness gap for a real scenario class (duplicated
  sections), not just a test artifact — see `anchor.ts`'s own comment on
  `contextOnlyAnchor` for the full account.
- Comments are confirmed never to affect the Markdown by construction
  (`THREADS_MAP_NAME` is a top-level `Y.Map`, never touched by
  `serializeDoc`, which only ever reads `FRAGMENT_NAME`'s
  `Y.XmlFragment`) and by test (gate F's own byte-identical assertion
  after adding/replying/resolving).
- Not chased further (recorded, not silently dropped): comments spanning
  two blocks are not specially handled — `buildAnchorRecord` builds
  whatever quote/offsets a cross-block PM range actually has (the quote
  would contain the `\n\n` block separator), and `resolveAnchor` treats
  it like any other range; no test exercises this directly, per the
  brief's own "not in scope" note.

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
- Brief 04, for brief 05 (comments) and beyond:
  - Locate a paragraph/block in a multi-context Playwright test
    structurally (`#editor .ProseMirror > p`, `nth(index)`), never by
    `hasText` — a remote user's caret can inject real text into the DOM
    subtree of whatever paragraph it lands in (see this file's "Brief 04"
    section above). The same likely applies to a comment anchor's own
    decoration once brief 05 adds one.
  - `editor.storage.collaborationCaret.users` (from
    `awarenessStatesToArray` inside `@tiptap/extension-collaboration-caret`)
    is already the presence data source, refreshed on
    `provider.awareness`'s own `update` event — reuse it rather than
    re-deriving anything from `provider.awareness.getStates()` directly.
  - `provider.on('status', ...)` gives `'connecting'|'connected'|
    'disconnected'` (confirmed from `@hocuspocus/provider`'s
    `WebSocketStatus` enum); combined with `window`'s `online`/`offline`,
    this is the whole status-indicator input — no polling needed.
  - Any color handed to `CollaborationCaret`'s `render`/`selectionRender`
    callbacks is sanitized through `isValidColor`
    (`/^#[0-9a-fA-F]{6}$/`) BEFORE those callbacks see it — only
    `#rrggbb` hex survives; anything else (including a perfectly valid
    `hsl(...)` CSS colour) becomes `'transparent'`.
  - `y-indexeddb`'s `IndexeddbPersistence` writes each local update to
    IndexedDB as it happens (no meaningful debounce on the write itself,
    only on its periodic full-snapshot compaction); its exported
    `storeState(persistence, true)` forces a full snapshot write and
    returns a promise, used here (`window.phraise.flushIndexeddb()`) to
    make a reload-after-offline-edit test deterministic instead of
    guessing at write timing.
  - `expect: { timeout: 10_000 }` is now the suite-wide default (see
    "Commands"); a future gate that polls a cross-client network round
    trip should rely on this rather than adding its own per-assertion
    timeout, so the whole suite's tolerance for parallel-worker
    contention stays in one place. (Brief 05 raised it again, to 15s.)
- Brief 05, for brief 06 (comments) and beyond:
  - `page.keyboard.type()`/`.press()` can occasionally not reach the page
    at all (a real CDP input-delivery miss on this machine, roughly 1 in
    100-150 keystroke sequences) and, under real parallel load, can
    insert a space as U+00A0 instead of U+0020 (a genuine Chromium
    contentEditable quirk, reaching even the serialized Markdown). Both
    are real, not test bugs; `typeAndVerify` (type, poll the LOCAL
    selection, retry if nothing landed, tolerate the U+00A0 substitution)
    in `gateE-undo.spec.ts`/`gateG-ime.spec.ts`/`gateI-offline.spec.ts` is
    the established fix for both — reuse it rather than a bare
    `page.keyboard.type()` in any new multi-user test that types through
    two alternating pages.
  - A real, uncommitted composition inserts its preview text as actual,
    already-synced document content on this stack (`editor.view.composing`
    reads `true`, but the preview reaches other users before any commit) —
    do not assume a composing user's content is invisible to collaborators
    until they commit.
  - `editor.commands.setTextSelection` (or `.chain().focus()
    .setTextSelection(...).run()`) is the reliable way to position a
    caret in a test where a real click risks landing on
    `CollaborationCaret`'s own caret/label DOM decoration instead of
    editable text — this can happen whenever ANOTHER user's live caret or
    an active composition is inside the paragraph being clicked into, not
    only during IME.
  - The `seedFiles` multi-element-array Playwright fixture-option bug
    (see the "Brief 04" notes above) has now been hit three times across
    three different spec files; treat it as a certainty, not a
    coincidence, for any new test needing more than one extra seed file —
    either nest nested `test.describe`s (fine for 2-3 files) or copy
    files directly into `phraiseServer.seedsDir` at runtime (better for
    many, e.g. one per loop repetition).
- Brief 06, for brief 07 (scale, styling, screenshots, other browsers) and
  beyond:
  - `@tiptap/y-tiptap` exports `initProseMirrorDoc(yXmlFragment, schema) ->
    { doc, mapping }` (confirmed with types at
    `node_modules/@tiptap/y-tiptap/dist/src/lib.d.ts`) — a way to get a
    real ProseMirror `Node` plus its `ProsemirrorMapping` straight from a
    `Y.XmlFragment`, with NO `EditorView` and no DOM at all. Useful
    anywhere a headless test (or a server-side process) needs to reason
    about the document as ProseMirror sees it without spinning up jsdom.
  - `Decoration.inline(from, to, attrs, spec)`'s `attrs` (what renders
    into the DOM) and `spec` (what `.spec` reads back, e.g. in
    `handleClick`) are separate constructor arguments — pass both if you
    need to both render something AND read it back later; see the
    "Brief 06" section above for the bug this caused the first time.
  - A `Y.Map`/`Y.Array` structure that lives OUTSIDE the ProseMirror-bound
    `Y.XmlFragment` (comments, and presumably any future non-Markdown
    metadata) does NOT generate ProseMirror transactions when it changes
    — anything reacting to it (a decoration plugin, a sidebar) needs its
    OWN explicit observer (`Y.Map.observeDeep`), not just "listen to the
    editor". Conversely, something that depends on the DOCUMENT (like
    whether an anchored range still resolves) needs its own `docChanged`
    listener even if it is not itself stored in the fragment.
  - `formatRelativeTime`/`renderSidebar`/etc. in `src/comments/` and
    `web/src/comments/` are a small, reusable example of this spike's
    established split: pure logic (testable with plain Vitest, no DOM) in
    `src/`, DOM wiring in `web/src/` — worth following for any future
    sidebar/panel UI (screenshots, styling work in brief 07 will likely
    touch this exact split).
  - `page.keyboard.press('Shift+ArrowRight')` in a loop DOES reliably
    extend a real text selection character by character in this headless
    Chromium setup, PROVIDED the real model selection
    (`editor.state.selection`) is polled until it settles before being
    read — confirmed directly in `e2e/gateF-comments.spec.ts`'s
    `selectPhrase` (used to select a 27-character phrase, real keystrokes
    throughout, no flakes across a `--repeat-each=5` run). Earlier gate
    files (`gateA-shortcuts.spec.ts`'s `selectWord`, reused by
    `gateE-undo.spec.ts`) select a word via `editor.commands
    .setTextSelection` instead, with a comment attributing this to a real
    `Shift+ArrowRight` sequence being unreliable for cross-position
    selection — that claim was not re-verified here (this brief only
    needed to select forward from a known start offset, not confirm or
    refute the earlier finding), so treat both as true for now: the
    simple forward-selection shape this brief used works; something about
    a DIFFERENT shape (cross-position, word-boundary?) may not have,
    according to the earlier note.
