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
