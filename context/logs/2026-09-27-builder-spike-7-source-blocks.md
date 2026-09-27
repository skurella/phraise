Status: in progress
Author: builder (Sonnet 5)
Updated: 2026-09-27
Plan: [spike 7 plan](../plans/2026-09-27-spike-7-plan.md)
Brief: [brief 03 source blocks](../plans/2026-09-27-spike-7-brief-03-source-blocks.md)

Time zone: local machine time (CEST, from `date`).

## 17:50 — task received

Read AGENTS.md, brief 03, the charter's "Rules for every agent in this spike",
the plan, D4 and its amendments (fetched from
`origin/spike/2026-09-27-markdown-round-trip`), and both prior builder logs
(foundation, typing). Branch `spike/2026-09-27-web-editor`, worktree clean at
start. Read `src/model/schema.ts` (raw_block/raw_inline shapes, `kind`
attrs), `src/model/serialize.ts` (the verbatim/splice/textblock-splice/
re-serialize ladder, `onUnverified`/`trace`), `src/model/parse.ts` (which
`kind` values the parser produces: `html`, `yaml`, `toml`, `math`,
`definition`, `footnoteDefinition`, a bare mdast type name for anything else
(currently unreachable with this plugin stack -- see below), and
`'unstable:' + type` from the load-time self-description check),
`src/collab/tiptapExtensions.ts` (the generic schema-to-extension
converter), and all of `web/src/editing/*.ts` + `web/src/main.ts` to
understand the existing keymap/extension wiring conventions.

Installed new dependencies (network confirmed reachable, per foundation
brief's own note): `dompurify@^3.4.16`, `katex@^0.18.9`, `mermaid@^11.17.2`
as real deps; `jsdom@^26.1.0`, `@types/dompurify` as devDeps (for a
jsdom-environment unit test of the sanitizer, since DOMPurify's ESM build
auto-detects a global `window`, which jsdom's vitest environment provides).

## 18:05 — investigation before writing code

Probed with throwaway scripts (deleted before committing) to settle three
open design questions rather than guess:

1. **Is `raw_block` kind `"unknown"` (a truly unrecognized mdast type)
   reachable via this parser stack?** No. `blockFromMdast`'s switch already
   enumerates every block-level mdast type this plugin combination
   (remark-parse + remark-gfm + remark-frontmatter + remark-math) can ever
   produce; its `default` branch is unreachable with valid input today (it
   exists for future-proofing, e.g. an MDX plugin). Tried directive syntax,
   HTML comments, definition lists, task lists, a bare thematic break --
   every one already has a named case. Decision: cover the "any other kind
   string" case only in the label-mapping unit tests (a synthetic
   `raw_block` with `kind: 'mdxJsxFlowElement'`, as a stand-in for a future
   construct), and note this in gate C's own test file rather than force an
   artificial fixture. Gate C's fixture instead uses the six kinds that
   genuinely occur: html, yaml (front matter), math, footnoteDefinition +
   its `definition`-kind link, a Mermaid fence (code_block, not raw_block),
   plus one instance of the "Source" fallback label exercised at the unit
   level.

2. **Is Tiptap's default Enter/Mod-Enter chain already "the source block's
   own Enter/way-out" for free?** Yes for Enter: `@tiptap/core`'s built-in
   `Keymap` extension's Enter chain tries `commands.newlineInCode()` first
   (confirmed by reading `node_modules/@tiptap/core/dist/index.js`), which
   applies to ANY node with `code: true` in its spec -- `raw_block` and
   `code_block` both already have `code: true` -- so plain Enter inside a
   source block already just inserts a newline, no new code needed.
   Partially for Mod-Enter: core's default `Mod-Enter -> exitCode()` only
   fires when the code node is the LAST child of its parent (ProseMirror's
   `exitCode` bails otherwise). Since a source block loaded from a real file
   is essentially never the document's last block, this needed its own
   command (`exitSourceBlockCommand` in `src/editing/sourceBlockBoundary.ts`)
   that also handles "a block already follows: just move the selection
   there" and ArrowDown-at-the-last-line, generalized over `code: true`
   textblocks (raw_block, code_block/Mermaid) rather than hand-writing it
   twice.

3. **Are joinBackward/joinForward actually unsafe across a source block
   boundary, or is this precaution unnecessary?** Confirmed unsafe: `raw_block`
   has `content: 'text*'` with no block content, which makes it a real
   ProseMirror "textblock" (inline content only) exactly like `paragraph` --
   so the DEFAULT `joinBackward`/`joinForward` (last in Tiptap core's own
   Backspace/Delete chains) would happily merge a neighbouring paragraph's
   text directly into a source block's own text content (both are
   textblocks of different types, which `joinTextblockBackward`/`Forward`
   merge unconditionally). This is the corruption the brief warns about;
   confirmed by reading `prosemirror-commands`' `joinTextblockBackward`
   before writing the guard, not assumed.

4. **Gate H demonstration.** Tried both of the brief's suggested
   constructs with the REAL serializer (not guessed): a paragraph containing
   `&#10;&#10;` entities edited elsewhere in the same paragraph, and
   `***foo** bar*` with a bold-mark toggle (also fuzzed all 132 CommonMark
   "Emphasis and strong emphasis" spec examples, toggling every mark at
   every text run) -- ALL verify successfully with this serializer; its
   re-serialize ladder already escapes embedded control characters back to
   numeric entities and already reconstructs valid nested-emphasis Markdown
   in every spec example tried. Both suggested constructs are evidently
   already-fixed regressions relative to spike 1's original remark-only
   findings. Broadened the fuzz to all 652 CommonMark spec examples across
   two edit types (toggle any mark off; insert a word) and found 46 real
   failures, mostly in multi-block fixtures (link reference definitions,
   HTML blocks) that are less suited to a single-paragraph demo. Picked
   CommonMark example 20 ("Backslash escapes"): `<https://example.com?find=\*>`
   (an autolink whose URL text contains a backslash-escaped asterisk).
   Editing gesture: select the autolinked text and remove the link mark
   (`editor.commands.unsetMark('link')`, a generic core command, the same
   one `markShortcuts.ts` already documents as always available) -- this
   leaves a plain text run `https://example.com?find=\*` that no candidate
   in the ladder can re-serialize back to a plain (unlinked) run containing
   that literal backslash-asterisk outside any code span or link; confirmed
   `UnverifiedSerializationError` is thrown for real, not assumed from
   reading the code.

## 18:20 — `src/model/serialize.ts`: exported per-block check context (task 5 foundation)

Refactored (no behaviour change -- full existing suite of 69 unit tests plus
gate A/B Playwright specs re-run after, all still green) `serializeDoc`'s
internal `emit()` into two new exported functions in the same module:
`buildBlockCheckContext(doc)` (the definitions-context + detected-style +
eol precompute, done once per document) and `serializeBlock(block, context,
opts)` (the verbatim/splice/textblock-splice/re-serialize ladder for ONE
block, returning `{ text, trace }`). `serializeDoc` itself now just calls
`serializeBlock` per block instead of duplicating the ladder. This is what
lets gate H's per-change check verify only the blocks that changed instead
of calling `serializeDoc` on the whole document every debounce cycle.

Measured why this matters before building the cache (script, deleted):
on `corpus/fetched/nodejs-node-docapinapimd.md` (240 KB, 1619 blocks),
`serializeDoc` with NO edits at all still costs ~1.2s, dominated by
`detectDocStyle`'s one full re-parse of the reconstructed document (matches
the original 1.29s full-document parse time almost exactly) -- not by the
per-block verification work. `buildBlockCheckContext` is still O(document)
for this reason; `checkChangedBlocks` (next) additionally caches the
context itself and only recomputes it when the set of link/footnote
definition blocks changes, so a single small paragraph edit in a huge
document costs microseconds after the first check, not 1.2s every debounce
cycle. Full numbers logged in the next entry once the harness exists.

Next: the pure per-block cache module, kind-label mapping, front-matter
preview, sanitizer config, then the node views.

## 18:33 — gate C (tasks 2, 3, 4) done: 6/6 Playwright tests, 117 unit tests

Built, in order: `src/editing/blockCheckCache.ts` (the node-identity cache
around `serializeBlock`/`buildBlockCheckContext`, unit-tested including a
`vi.spyOn` proof that an unchanged block is genuinely skipped, not just
correct); `src/editing/rawBlockLabels.ts` (kind -> plain-word label);
`src/editing/frontMatterPreview.ts` (a hand-rolled flat YAML/TOML preview
parser -- deliberately not a real parser, returns `null` for anything
nested/multi-line so the caller falls back to raw text; no new dependency
for a preview-only convenience); `src/editing/sanitizeHtml.ts` (DOMPurify
config: explicit `FORBID_TAGS` for `iframe`/`style`/`object`/`embed`/
`form`/`base`/`meta`/`link` on top of DOMPurify's own default script/
event-handler/`javascript:` stripping); `src/editing/sourceBlockBoundary.ts`
(pure position arithmetic for the Backspace/Delete/Mod-Enter/ArrowDown
boundary gestures, 11 unit tests using real resolved positions, not
hand-computed transactions).

Then the node views (`web/src/nodeviews/`): `rawBlockView.ts` (labelled
source block, preview per kind -- sanitized HTML, KaTeX math, front-matter
key-value list or raw text -- with a persistent editable `contentDOM`
toggled visible by `.phraise-editing`, tracked via the editor's own
`selectionUpdate` event since a NodeView has no other "the caret moved"
hook); `rawInlineView.ts` (inline math via KaTeX, an unobtrusive chip with
the raw value in its tooltip otherwise); `codeBlockView.ts` (a plain
labelled code block, or for `lang: mermaid` the same preview/source pattern
as `rawBlockView.ts`, with `mermaid` loaded only via a dynamic `import()`
inside `loadMermaid()` -- confirmed by grepping the built `index.js` for
any reference to the mermaid chunk's filename: none, only the dynamic
`import()` call itself; see the bundle-size entry below). Wired into
`web/src/main.ts` by `.extend()`-ing the three specific generically-
converted extensions (`raw_block`, `raw_inline`, `code_block`) by name --
`checkSchemaEquivalence` (`test/schemaEquivalence.spec.ts`) still passes
unchanged, confirming `addNodeView` altered no compared schema field.

`web/src/editing/sourceBlockKeymap.ts`: Backspace/Delete select the
adjacent `raw_block` (`NodeSelection`) instead of falling through to core's
`joinBackward`/`joinForward`, which would otherwise merge a neighbouring
paragraph's text directly into the source block's own text content (both
are ProseMirror "textblocks" of different types -- confirmed unsafe by
reading `joinTextblockBackward`/`Forward`'s source before writing the
guard, not assumed). Mod-Enter and ArrowDown-at-the-last-line are a
generic "exit any `code: true` textblock" command, since Tiptap core's
default `Mod-Enter -> exitCode()` only fires when the code node is already
the document's last child (confirmed by reading `prosemirror-commands`).
Plain Enter needed no new code: Tiptap core's own Enter chain already tries
`commands.newlineInCode()` first for any `code: true` node.

`web/src/editing/pasteRule.ts`: one added guard line (`if
(view.state.selection.$from.parent.type.spec.code) return false`) so
pasting Markdown-shaped text/plain while the caret is inside a `raw_block`
or `code_block` falls through to ProseMirror's own default paste-fitting
(which the schema's `marks: ''`/`content: 'text*'` restriction already
reduces to plain text) instead of trying to insert real block nodes into
inline-only content.

**Two real Playwright/browser races found while writing gate C's tests
(not guessed), same shape as the typing brief's own documented ones:**
1. A native `End` keypress inside a multi-line `<pre>` (real embedded
   newlines, `white-space: pre-wrap`) moves to the end of the current
   VISUAL line, not the block's own last line -- not usable for "place the
   caret at the very end of this block's source" the way `End` works on a
   single-line `<p>`. Fixed by computing the exact target position
   directly (`endOfRawBlockPos`, from the block's own `nodeSize`) and
   driving selection via `editor.commands.setTextSelection`, keeping only
   the actual edit itself (`page.keyboard.type`) as a real keyboard event --
   the same resolution the typing brief's log describes for its own
   Shift-based selection races.
2. Clicking "Edit source" and then immediately sending
   `page.keyboard.type` lost the FIRST character every time: `editor.
   commands.focus()` (called from the button's `mousedown` handler) does
   not synchronously move real DOM focus in this headless Chromium --
   confirmed by reading `document.activeElement` right after the click (it
   was still `<body>`) and only becoming the ProseMirror contenteditable
   div a beat later. Fixed by polling for `document.activeElement`
   carrying the `ProseMirror` class before typing, in both the new
   `keepUnverifiedBlock`-adjacent gate C test and (pre-emptively) gate H's
   tests below.

Gate C fixture `e2e/fixtures/source-blocks.md`: front matter (yaml),
raw HTML, a `$$` math block, a footnote with its definition, a link
reference definition, and a Mermaid fence -- verified to round-trip byte
for byte through `parseMarkdown`+`serializeDoc` before being used (a
throwaway probe script, deleted). **"An unknown construct" was NOT
included as a real fixture line**: confirmed (via a throwaway probe trying
directive syntax, definition lists, malformed frontmatter, and every
CommonMark/GFM block type) that `blockFromMdast`'s switch in
`src/model/parse.ts` already enumerates every block-level mdast type this
plugin stack (remark-parse + remark-gfm + remark-frontmatter + remark-math)
can produce from valid input -- its `default` branch (kind = the bare
mdast type name, or `'unstable:' + type` from the self-description check)
is unreachable today, existing only for future-proofing (e.g. an MDX
plugin later). Covered instead at the unit level:
`test/rawBlockLabels.spec.ts` asserts the "Source" fallback label for a
synthetic `mdxJsxFlowElement`/`unstable:paragraph` kind.

`e2e/fixtures/unsafe-html.md`: a `raw_block` containing `<img
onerror=...>` and `<script>`; gate C's last test confirms no `script`
element is ever inserted into the DOM and neither global flag is ever set.

`npx vitest run`: 14 files, 117 tests, all passing. `npx tsc --noEmit`:
clean. `npx vite build`: succeeds (bundle sizes measured and reported
below, near the end of this brief).

Next: gate H (the empty-paragraph wrapper is already done from the very
first entry above; remaining: the debounced per-block check wiring, the
unverified-block banner UI, and gate H's own Playwright tests).

## 18:41 — gate H done, definition of done, README, commit

`web/src/editing/unverifiedCheck.ts`: a Tiptap `Extension` (`UnverifiedCheck`)
listening to the editor's `update` event, bailing immediately for a
remote-origin transaction (`transaction.getMeta('y-sync$')?.isChangeOrigin`
-- `@tiptap/y-tiptap` follows y-prosemirror's own `new PluginKey('y-sync')`
convention, confirmed by grepping its built `dist/y-tiptap.js`) or for its
own fix-transaction (a private meta flag), then debouncing 400ms before
calling `BlockCheckCache.check()` on a canonical-schema doc built by
converting only CHANGED top-level live blocks (cached by the LIVE node's
own reference in a module-level `WeakMap`, so an unchanged block is never
re-converted OR re-verified across cycles -- this is what makes gate H's
measured ~6ms warm-cache cost real, not just `BlockCheckCache`'s own
cache alone, since `PMNode.fromJSON` always allocates a fresh object that
would otherwise defeat identity-based caching on every cycle). An
unverified block is replaced with `raw_block { kind: 'unverified' }`
holding the best-effort text, in a transaction that also carries the
fix-flag (so it does not re-trigger the check) and `addToHistory: true`
(so it is its own undoable step, not merged into the triggering edit --
needed so "Undo my change" only reverts the ORIGINAL edit, tested
directly). `keepUnverifiedBlock` (the "Keep this" handler) parses the
block's current text via the same `parseBlock` the check itself uses (with
a defs context rebuilt from the live doc), and only replaces the block if
that parse succeeds to exactly one node -- a no-op otherwise, so a
half-edited banner never silently loses text.

`web/src/nodeviews/rawBlockView.ts` gained the `kind === 'unverified'`
special case: instead of the normal label + preview, a banner (the exact
wording the brief specifies) with "Keep this"/"Undo my change" buttons,
and the source `contentDOM` permanently visible (no preview to toggle back
to -- showing exactly what will be saved IS the point).

Demonstration and its fixture: see this brief's earlier entry (18:20/18:33)
for how it was found; `e2e/fixtures/gate-h.md` is a 4-block file (heading,
two paragraphs, the autolink paragraph in between) verified to round-trip
byte for byte before use. The edit itself is driven through a real generic
core command (`editor.chain().setTextSelection(range).unsetMark('link').run()`),
which is exactly "a local transaction" from the check's point of view --
no special-casing needed to make the check see it.

`e2e/gateH-unverified.spec.ts`, 4/4 passing:
- the banner appears with the exact message and both buttons, and the
  block's own editable text is non-empty (the best-effort Markdown);
- "Keep this" makes the banner disappear (which IS the parse succeeding,
  confirmed by reading `keepUnverifiedBlock`'s own logic rather than
  re-implementing a separate check) and leaves `markdown()` returning a
  string (no throw) whose content still carries the URL, in a real
  paragraph -- not byte-identical to the shown text, since a link mark
  round-trips through more than one valid Markdown spelling (in this
  specific case it happened to come back out as the SAME autolink form the
  file originally had, once re-verified structurally -- ProseMirror's own
  view had no other opinion). First attempt at this test asserted literal
  byte-containment of the shown (escaped, unlinked) text and failed for
  exactly this reason; fixed by asserting substance (the URL is present, in
  a real paragraph) instead of exact spelling;
- "Undo my change" restores the original file bytes exactly
  (`editor.commands.undo()`, the generic Yjs-undo-manager-backed command
  `@tiptap/extension-collaboration` already provides -- no custom undo
  wiring needed);
- a second browser context (`browser.newContext()`, both pages on the
  SAME document through the SAME relay) sees the SAME converted block (via
  Yjs sync) but its OWN check never ran: asserted directly via a
  test-only counter (`debugStats.checkRuns`, exposed as
  `window.phraise.debugUnverifiedCheckRuns()`) rather than inferring it
  from the absence of a visible double-conversion, which a race could
  hide.

Two real Playwright/browser races found while writing these tests (not
guessed), logged in full in the earlier gate C entry and in
`README.md`'s "Notes for the next brief": native `End` inside a
multi-line `<pre>` moves to the end of the VISUAL line, not the block's
own last line; a button's `mousedown`-triggered `editor.commands.focus()`
does not synchronously move real DOM focus, losing the first keystroke
sent right after.

**Cost, measured** (not estimated) on `corpus/fetched/nodejs-node-docapinapimd.md`
(240 KB, 1619 blocks), via a throwaway script (deleted before committing)
exercising `BlockCheckCache` directly the same way `unverifiedCheck.ts`
does: a cold full check costs ~1235 ms (dominated by `detectDocStyle`'s
one full-document re-parse -- the same cost `serializeDoc` itself always
pays, per D4's own amendment); a second check after editing ONE paragraph,
cache warm, costs ~6 ms -- about 200x faster than calling `serializeDoc`
on the whole document again (~1224 ms) for the same edit. The debounce
(400ms) means this cost is paid once per pause in typing, not per
keystroke, and the ~1.2s COLD cost only happens once per document per
page load, not per edit.

### Definition of done

- `npx vitest run` -- 14 files, 117 tests, all passing.
- `npx tsc --noEmit` -- clean.
- `npm run gates` -- builds, runs gates A (22), B (23), C (6), H (4),
  55/55 passing, table printed (D/E/F/G/I/J/K "not run" as expected --
  out of this brief's scope), `results/gates.md`/`gates.json` written,
  exit 0.
- `lsof -nP -iTCP:4400-4499 -sTCP:LISTEN` -- empty after the gates run.
- No `test.fixme`s: every scenario in the brief's scope (7 tasks) has a
  passing test with a real, verified assertion.
- Bundle sizes measured and reported in `README.md`'s new section (main
  chunk 608 KB -> 914 KB / 186 KB -> 280 KB gzip; Mermaid confirmed never
  in the initial load via a direct grep of the built `index.js`; katex
  left as a static import, accounting for most of the increase, noted as
  a straightforward follow-up).

Updated `README.md`: status/goal for brief 03, new file layout entries for
every new module, the new e2e specs and fixtures, gate H's demonstration
explained, the bundle-size table, and new "notes for the next brief"
entries (the two new Playwright races, the `.extend()`/`instanceof`
narrowing pattern for adding node views, the `test.use({seedFiles:[...]})`
multi-element-array bug and its workaround, gate H's measured cache cost).

Committed (paths staged explicitly, no `-A`/`.`): all new `src/editing/`,
`web/src/nodeviews/`, `web/src/editing/` files, `test/*.spec.ts` additions,
`e2e/gateC-sourceblocks.spec.ts`, `e2e/gateH-unverified.spec.ts`,
`e2e/fixtures/{source-blocks,unsafe-html,gate-h}.md`, the `serialize.ts`
refactor, `main.ts`/`pasteRule.ts`/`style.css`/`index.html` changes,
`package.json`/`package-lock.json` (dompurify, katex, mermaid, jsdom,
`@types/dompurify`), `README.md`, and this log. `context/logs/2026-09-27-
orchestrator-spike-7.md` was already modified in this worktree before I
started (not by me) and was deliberately left unstaged. Not pushed (brief
says commit only). Commit `75514c1` on `spike/2026-09-27-web-editor`.

## Handback summary

Gate C: 6/6 passing (labels + no visible Markdown syntax + Mermaid SVG;
editing a source block via keyboard changes only its own bytes; typing/
Enter/Backspace/Delete in neighbouring paragraphs leave a source block
byte-identical; Backspace/Delete at a source-block boundary selects it
instead of merging; sanitizer removes `<script>`/`onerror`/no global
flag set). Gate H: 4/4 passing (banner + best-effort text; "Keep this";
"Undo my change"; a second browser context never runs its own check).
`npm test` 117/117. `npx tsc --noEmit` clean. No `fixme`s.

Gate H's trigger: CommonMark spec example 20, an autolink
`<https://example.com?find=\*>`; unlinking it (`unsetMark('link')`) leaves
literal-backslash plain text the serializer's ladder cannot re-express.
Both of the brief's OWN suggested constructs (`&#10;&#10;` entities;
`***foo** bar*` with a bold toggle) were tried for real and verify
successfully with this serializer -- confirmed via a fuzz across all 652
CommonMark spec examples (46 real failures found across two edit types;
this one chosen for being a single paragraph, not multi-block). Measured
cost: cold full check ~1235ms on the 240KB/1619-block corpus file; warm
(one small edit) ~6ms, ~200x faster than a naive whole-doc `serializeDoc`
call for the same edit.

Bundle sizes after the Mermaid split: main chunk 608KB -> 914KB raw
(186KB -> 280KB gzip); Mermaid (~2MB across ~60 chunks) confirmed NEVER
in the initial load (grepped the built `index.js` for the chunk's own
filename: zero references outside the one `import()` call); katex
(~250KB) was left as a static import and accounts for most of the
increase -- a straightforward follow-up, not required by this brief.

"Unknown construct" for gate C's fixture: could not be produced by this
parser/plugin stack on valid input (confirmed by probing every
CommonMark/GFM construct -- `blockFromMdast`'s switch already enumerates
every reachable mdast type); covered instead at the unit level
(`rawBlockLabels.spec.ts`'s synthetic `mdxJsxFlowElement` case).

Paths: log (this file); README
`spikes/2026-09-27-web-editor-tiptap/README.md`.
