Status: in progress
Author: builder (Sonnet 5)
Updated: 2026-09-27
Plan: [spike 7 plan](../plans/2026-09-27-spike-7-plan.md). Brief: [brief 07](../plans/2026-09-27-spike-7-brief-07-scale-look.md).

Times are local machine time (CEST), from `date` at time of writing.

## 22:27 -- task received, read context

Read `AGENTS.md`, the brief, the charter's "Rules for every agent" and
"Constraints", the plan, and the previous builder log
(`2026-09-27-builder-spike-7-comments.md`) plus the README's "Notes for the
next brief" section for brief 07.

Repo state as briefs 01-06 left it: 78/78 gates A-I passing, 175 vitest
unit tests, `.pw-browsers/` already has chromium, firefox and webkit
installed (brief 01's `npm run setup:browsers` installs all three even
though only chromium ran until now).

Scope for this brief, in order: fix list (copy test, gate A real-selection,
gate H unlink-via-UI, `npm start` always builds, six styling items), gate K
(scale, `results/scale.json`), gate J (feel + screenshots), Firefox/WebKit
projects + cross-browser reporter table, final commands (full gates run,
fresh-clone check).

Plan for the fix list's selection-method items: grep showed
`editor.commands.setTextSelection` used programmatically in exactly three
gate A/B files: `gateA-typing.spec.ts` (1 site, the cross-paragraph select-
and-type test), `gateA-shortcuts.spec.ts` (`selectWord`, used by 5 tests),
`gateB-copy.spec.ts` (2 sites). Plan: a new `e2e/mouseSelect.ts` with real
Range-API-computed click/double-click/shift-click helpers (double-click for
a single word -- the natural gesture; click-then-shift-click for a phrase
or a cross-paragraph range), replacing all three programmatic sites. Gate
A's own "select across two paragraphs" test specifically also gets tried
with real `Shift+ArrowRight` per the brief's own instruction and the
orchestrator's tip that it works if polled properly; will decide between
that and click+shift-click based on which is more robust once tried.

## 22:35 -- `npm start` fix

`scripts/start.ts` now always runs `vite build` before serving, instead of
skipping when `dist/index.html` already exists. One-line-of-intent change.

## 22:45 -- manual visual investigation, real bugs found

(Note: an earlier version of this entry was accidentally written to
`spikes/2026-09-27-web-editor-tiptap/context/logs/...` -- a wrong path --
before being noticed and merged back here; that stray directory is removed,
never committed.)

Booted `server/main.ts` directly (port 4490/4491, outside the charter's
test range 4400-4449 and outside `npm start`'s own 4480/4481, so it never
collides with either) with a temp seeds dir, and used the Browser pane
against real fixtures/corpus files to see what the orchestrator's
screenshots actually showed, rather than guessing at CSS. Two real,
previously-undiagnosed bugs found this way, beyond what the fix list
already named as CSS:

1. **Every raw/source block that happens to contain ProseMirror's initial
   (unfocused) selection opens in "editing" (raw source) mode on load, not
   just front matter** -- confirmed directly:
   `rawBlockView.ts`'s `updateEditingState` treats "editing" as purely
   "the selection is inside this node's range", with no check for whether
   the editor has ever actually been focused. `autofocus: false`
   (`main.ts`) still leaves `EditorState`'s own default initial selection
   sitting at the very first valid cursor position, which for a document
   starting with front matter (routine for real files) is INSIDE that
   raw_block. This is why front matter specifically showed `---`
   delimiters in the orchestrator's screenshots: it wasn't a fenceless-text
   bug, the block was rendering as an open source editor, unrelated to
   whether `parseFlatFrontMatter` succeeded (confirmed it did, via a
   throwaway probe script: 2 valid entries from the exact fixture text).
   Fixed by gating `updateEditingState` on `editor.isFocused` too (new
   `focus`/`blur` listeners alongside the existing `selectionUpdate` one),
   so a block only opens once the user has actually clicked/focused into
   the editor and landed inside it. Also fixed the yaml/toml fallback path
   (a non-flat front matter) to strip fences from the RAW text shown too --
   it was passing the fenced original through even on the rare occasions
   `updateEditingState`'s bug wasn't the cause.
2. **Reference-style images (`![alt][id]`), e.g. every badge in Express's
   own real README, rendered as broken -- root cause confirmed to be
   neither the service worker, the headless browser, nor the network** (as
   the brief asked to determine). `src/model/schema.ts`'s `image` node
   stores `url: ''` plus `refType`/`identifier` for a reference-style image
   BY DESIGN (so the Markdown re-serializes as reference syntax, not a
   resolved literal URL), but its `toDOM` used that raw empty `url`
   directly as `<img src>`. `document.querySelectorAll('img')` on the real
   Express README showed every badge's `src` resolving to `location.href`
   (the current page's own URL) -- confirmed live: Chromium was
   re-requesting the page itself as "image data" and failing to decode it.
   Fixed with a new `image` node view (`web/src/nodeviews/imageView.ts`)
   that resolves the identifier against the document's own `definition`
   raw_blocks (`src/editing/referenceResolve.ts`, new, unit-tested) only
   for the DOM `src` -- the node's own attrs, and therefore the serialized
   Markdown, are untouched. Verified against the real fetched
   `corpus/fetched/npm-express-readme.md`: all 5 badges (npm version,
   downloads, CI, coverage, OpenSSF scorecard) now load real images from
   `img.shields.io`/`api.scorecard.dev` -- confirming outbound network
   access genuinely works in this browser sandbox, so "the network" was
   never the cause either; it was purely the unresolved-URL bug. The same
   root cause affects reference-style TEXT links (`href=""`, confirmed too,
   e.g. the README's own `[Code of Conduct]` shortcut reference) -- left
   out of this fix (marks have no per-instance NodeView equivalent in
   ProseMirror; would need a decoration-based mechanism) since it doesn't
   visibly break like an image does and wasn't what the screenshots
   showed; noted here for a future brief.
3. **Table header row was never bold or shaded because `<th>` never
   existed in the DOM** -- confirmed via
   `document.querySelectorAll('th').length === 0` on a real table fixture
   before diagnosing further. `table_cell`'s schema `toDOM` always emits
   `<td>` (a cell node can't see its enclosing `table_row`'s `header` attr
   from a pure `toDOM(node)` function), so the pre-existing
   `#editor .ProseMirror th { background; font-weight }` CSS rule matched
   nothing. Fixed with a `table_cell` node view
   (`web/src/nodeviews/tableCellView.ts`) that resolves the enclosing row
   via `getPos()` (same "walk up through the current doc" idiom
   `rawBlockView.ts` already uses) and picks `<th>`/`<td>` accordingly --
   view-only, the Markdown round-trip already worked before this (it goes
   through `table_row.attrs.header`, never the DOM tag). Verified editing
   still works inside a `<th>` cell (typed a character, `window.phraise
   .markdown()` showed it in the header row).
4. **Consecutive top-level blocks (paragraph-to-paragraph, paragraph-to-
   list, paragraph-to-blockquote) had zero gap, but NOT after source-block
   cards or before a table/hr** -- confirmed as a real CSS SPECIFICITY bug,
   not a missing rule: the spacing rule was
   `#editor .ProseMirror > * + *` (specificity 1 id + 1 class + 0 type =
   (1,1,0)), and it was losing, regardless of source order, to
   `#editor .ProseMirror p { margin: 0 }` /
   `#editor .ProseMirror ul, ol { margin: 0 }` /
   `#editor .ProseMirror blockquote { margin: 0 }` (each (1,1,1), a higher
   specificity because a type selector beats none once id/class counts
   tie). Read back `getComputedStyle(p).marginTop` directly on a live
   paragraph with a preceding sibling paragraph: `0px`, confirming the
   diagnosis before touching CSS. Fixed by changing the selector to
   `#editor .ProseMirror > *:not(:first-child)` -- same "every direct child
   except the first" selection as the `+ *` combinator gave, but
   `:not(:first-child)`'s pseudo-class argument adds a class-level
   specificity point, so (1,2,0) now beats every plain-type selector
   below it regardless of source order. Verified on `e2e/fixtures/
   typing.md` (three consecutive paragraphs, a list, a following paragraph
   -- all now spaced) and the source-blocks fixture.
5. Footnote/link-reference definitions (`raw_block` kind
   `footnoteDefinition`/`definition`) now render as "1. The footnote's own
   definition text." / "reference link: https://example.com/reference"
   instead of raw fenced Markdown source, via a new pure module
   `src/editing/definitionPreview.ts` (`parseFootnoteDefinition`,
   `parseLinkReferenceDefinition`), unit-tested, wired into
   `rawBlockView.ts`'s preview branch (falls back to the raw text,
   fence-free, for anything that doesn't match the expected shape).
6. A footnote reference (`raw_inline` kind `footnoteReference`) now renders
   as a real `<sup>` with its id (e.g. "1"), not an uppercase "FOOTNOTE
   REF" chip -- `rawInlineView.ts`, parses the id out of the raw source
   (`[^1]`) with a regex, falls back to showing the raw value verbatim if
   it doesn't match that shape.

All six verified together on `e2e/fixtures/source-blocks.md` (front
matter, HTML, math, footnote, link reference, Mermaid) and
`corpus/fetched/npm-express-readme.md` via screenshots read back with the
Read tool, not just claimed from the tool output.

## 22:49 -- fix list's remaining items done

Added `test/definitionPreview.spec.ts` (9 tests) and
`test/referenceResolve.spec.ts` (3 tests) for the two new pure modules
above. Full `npx vitest run`: 26 files, 187/187 passing (175 + 12 new).

`e2e/mouseSelect.ts` (new): `dblClickWord` (real double-click, computed via
a DOM `Range` over the target word's text node) and `clickThenShiftClick`
(real click, then a real shift+click at another substring's edge) --
replacing every `editor.commands.setTextSelection` in gate A/B tests where
a real user would use the mouse:
- `gateA-shortcuts.spec.ts`'s `selectWord` (used by 5 tests) -> a real
  double-click. Note for the record: the file's OWN prior comment blamed
  `setTextSelection` on "real Shift-ArrowRight sequences raced ahead of the
  browser's own caret movement", but that finding was about a DIFFERENT
  technique (Shift-ArrowRight) -- double-click itself had never actually
  been tried here and turned out to be perfectly reliable (5/5 passing, no
  retry).
- `gateB-copy.spec.ts`'s `selectSubstring` (2 call sites) -> click-then-
  shift-click at the substring's own start/end edges.
- `gateA-typing.spec.ts`'s "select across two paragraphs and type over the
  selection" -> kept as real Shift-ArrowRight specifically (the brief's own
  instruction), via a new `extendSelectionAcrossBlocksTo` that presses
  Shift-ArrowRight one at a time and polls `editor.state.selection` to
  settle after each press before checking or sending the next one --
  confirmed this works reliably across a real paragraph boundary once
  polled properly (the orchestrator's tip), contradicting this file's own
  prior "found unreliable" comment, which (per the log this file cited)
  was never actually re-tried with proper settle-polling, only observed
  once to overshoot.

New copy test (`gateB-copy.spec.ts`, nested `test.describe` + its own
`test.use` per this spike's established `seedFiles`-array-bug workaround):
selects bold + a link + a two-item list (`e2e/fixtures/copy-rich.md`, new,
verified byte-identical round-trip before use) via click-then-shift-click,
and asserts the clipboard's `text/plain` contains `**bold text**`,
`[link](https://example.com/)`, `- Item one`, `- Item two`, and its
`text/html` contains real `<strong>`/`<a href=...>`/`<li>` tags -- the
fix list's exact ask ("the current test copies plain words only").

Gate H: `unlinkAutolink` now drives the real UI (`gateH-unverified.spec.ts`):
click into the autolink (its paragraph IS just the one autolink, so a
plain `.click()` always lands inside), real Mod-K, assert the popup shows
the CURRENT href prefilled and a visible "Remove link" button, click it.
Needed a real feature change first (`web/src/editing/linkShortcut.ts`):
`currentLinkHref` (reads the mark at the selection/caret, requiring the
WHOLE selection to carry one consistent link) plus a real "Remove link"
button, hidden unless the selection is already linked. Found and fixed a
real bug writing this, the SAME class already documented in this codebase
(`imagePopover.ts`'s own comment on brief 04's bug): the popup's `root`
had `style.display = 'flex'` set permanently inline, which silently wins
over the `hidden` attribute's own `display: none` the instant both are
present -- confirmed directly (`toBeHidden()` failing with the element
still carrying `hidden=""` in the DOM) before fixing it by dropping
`display`/`alignItems`/`gap` from `root`'s inline style entirely (input
and button's natural inline layout already sits them side by side; the
button got a small `marginLeft` instead of `gap`). All 4 gate H tests pass
after the fix; gate A's own Mod-K tests (`gateA-shortcuts.spec.ts`, no
existing link, so `currentLinkHref` returns null and the button stays
hidden) re-run clean too.

`scripts/start.ts`: always runs `vite build` first now, never skips based
on `dist/` already existing.

Styling fixes (found via manual investigation against real fixtures/corpus
in a temporary server on 127.0.0.1:4490/4491, stopped before handback):
raw-block "editing" mode now gated on `editor.isFocused` (fixes front
matter -- and any other block -- opening in raw-source view before the
user ever clicks in); footnote/link-reference definitions render as a
plain sentence; a footnote reference renders as a real superscript;
reference-style images (e.g. every Express README badge) resolve to their
real URL for display via a new `image` node view + `referenceResolve.ts`
(confirmed: neither the service worker, the browser, nor the network was
the cause -- a `url: ''` attr by design, rendered as `<img src="">`, which
browsers resolve to the current page); table header cells render as real
`<th>` via a new `table_cell` node view (schema `toDOM` can't see the row's
own `header` attr); paragraph/list/blockquote-to-block spacing fixed via a
CSS specificity bug (`> * + *` was losing to more-specific `p`/`ul`/
`blockquote` rules regardless of source order; `> *:not(:first-child)`
wins instead). Full detail already logged at 22:45 above.

Manual exploration server (port 4490/4491) still running for gate J
screenshot work; will be stopped before handback along with the temp
seeds directory.

## 22:54 -- fix-list regressions found and fixed, full suite green

`npm run build` then a full default-parallelism `npx playwright test` (all
gates A-I) found two real regressions from the styling/node-view work,
both fixed:
1. `gateC-sourceblocks.spec.ts`'s own footnote-reference assertion still
   expected the OLD `.phraise-inline-chip` class -- updated to
   `.phraise-footnote-ref` (+ asserting the `<sup>` reads "1"), matching
   the fix list's own ask.
2. `gateB-copy.spec.ts`'s cross-paragraph copy test flaked ONCE under
   default worker parallelism (passed reliably serially and at
   `--repeat-each=5 --workers=1`, 15/15) -- a real, rare mouse-gesture
   analogue of the CDP input-delivery miss this suite already documents
   for `page.keyboard.type()` (`gateE-undo.spec.ts`'s `typeAndVerify`).
   Fixed the same way: `e2e/mouseSelect.ts`'s `clickThenShiftClick`/
   `dblClickWord` now take the expected resulting selected text and retry
   the whole gesture (up to 3x, logging every retry via `console.log`) if
   the app's own selection hasn't settled to it -- centralized once here
   rather than duplicated per call site.

Full suite (`npx playwright test`, default parallelism, gates A-I): 79/79
passing. `npx tsc --noEmit`: clean.

Committing the fix-list work now (charter: commit incrementally, explicit
paths), before starting gate K.

## 23:15 -- gate K (scale) done, all numbers pass, results/scale.json written

New instrumentation (test-only, same pattern as existing `debugStats`
hooks): `unverifiedCheck.ts`'s `debugStats.lastRunMs` (wall time of the
gate H per-block check pass); `highlightPlugin.ts`'s `debugStats
.lastComputeMs` (wall time of the comment re-anchoring pass); `main.ts`
exposes both plus `encodedStateSize()` (`Y.encodeStateAsUpdate(ydoc)
.byteLength` -- equivalent to the relay's own state once synced, simpler
than reading the relay's SQLite file) and `debugCreateComment(from, to,
text)` (creates a real anchored thread bypassing the composer UI, for
seeding N comments quickly -- gate F's own tests already cover the real
composer path).

`e2e/gateK-scale.spec.ts` (new), 5 tests, writes `results/scale.json`
(merged incrementally across tests via `test.afterAll`, so a failure in
one measurement doesn't lose ones already taken):
1. **Load**: wall-clock (Node `Date.now()`) from just before `page.goto`/
   `page.reload` to a `page.waitForFunction` confirming the editor's DOM
   has as many top-level children as the parsed document has top-level
   blocks (1619) -- i.e. the LAST block is painted, not just "some
   content". First visit (relay-seeded): **1537-1803ms** across several
   runs (isolated and under full-suite contention) -- well under the
   gate's 5s pass criterion, asserted directly. Repeat visit
   (IndexedDB, after an explicit `flushIndexeddb()` for determinism, the
   same trick gate I's own tests use): **125-153ms**, confirmed via
   `builtFrom === 'indexeddb'`. Relay state size: **845,093 bytes**
   (`Y.encodeStateAsUpdate`, ~3.4x the 245,936-byte source file, the CRDT
   overhead).
2/3. **Key press to paint**, 200 real `page.keyboard.press()` characters
   (a real phrase, 10ms pacing) into a paragraph at the document's middle,
   while a second browser context (Bob) runs a continuous background
   load: every 120ms, alternately inserts one character into a paragraph
   ~50 top-level blocks away and into Alice's OWN paragraph (at its far
   end) -- via `editor.commands.insertContentAt`, a real Yjs transaction
   over the relay, not real OS keyboard (only one page can hold real
   keyboard focus at a time in this headless setup; Bob is background
   load here, not the thing being measured). Bob's edits use a distinctive
   marker character (`‡`, DOUBLE DAGGER) and the test POLLS Alice's
   own `markdown()` for it after Bob stops -- confirming the concurrent
   edits genuinely synced (32-33 landed each run), not just that the loop
   ran without throwing. Measured BOTH ways per the brief: the Event
   Timing API (`PerformanceObserver({type:'event', durationThreshold:16})`
   + `first-input`) and a `requestAnimationFrame` scheduled from every real
   `keydown`. **Reporting RAF for p50/p95/max** (documented in the file's
   own header comment): `durationThreshold: 16` means the Event Timing API
   only ever reports entries ABOVE 16ms, so on a healthy page most
   keystrokes are silently dropped from that sample entirely -- there is
   no percentile to compute from a sample that drops its own fast end.
   RAF captures all 200 unconditionally. `first-input` never fired in this
   headless setup across every run (`null` every time) -- reported as-is,
   a genuine observation, not hidden. Results, panel closed: **p50 6.1-
   6.4ms, p95 12.9-14.2ms, max 14.8-16.4ms** (n=200) -- comfortably under
   the gate's 50ms p95 criterion (asserted directly), including under full
   `npm run gates` parallelism. Panel open (not gated, still measured):
   **p50 7.5-7.8ms, p95 14.0-15.1ms, max 16.4-17.6ms** -- close to the
   closed numbers; the debounced Markdown-panel refresh does not
   meaningfully change key-to-paint latency at this scale. The Event
   Timing entries (304-450 per run) cross-check as expected: several per
   keystroke (keydown/keyup/input each reported separately once any one of
   them exceeds 16ms), consistent with RAF's own values clustering right
   around that threshold.
4. **Small README comparison** (`corpus/fetched/npm-express-readme.md`,
   9,949 bytes): deliberately SOLO (no Bob) -- a README this size has
   nowhere near 50 top-level blocks to place a second concurrent editor,
   so this is a baseline of the editor's own per-keystroke cost without
   collaboration overhead, not a second collaboration scenario. **p50
   7.6-8.1ms, p95 15.8-16.0ms, max 17.7-18.0ms** -- essentially the SAME
   as the large document's own numbers (within noise), i.e. the
   245,936-byte document's size does not measurably slow down typing
   latency once painted; the editor's per-keystroke cost is dominated by
   fixed overhead (ProseMirror's own transaction/render cycle), not
   document size.
5. **In-page costs**: `parseMarkdown`/`serializeDoc` measured in Node, not
   the browser (documented why in the file's header: both are DOM-free
   TypeScript, same V8 either way, avoids a debug-hook overhead skewing a
   microbenchmark) -- **parseMarkdown ~1.2-1.3s, serializeDoc ~1.2-1.25s**
   on the whole 245,936-byte file (consistent with brief 03's own earlier
   note that `serializeDoc` pays the same `detectDocStyle` full-reparse
   cost). Gate H's per-block check, in-page via `debugUnverifiedCheckLastMs`:
   **cold ~958-973ms** (first check ever: builds the whole definitions
   context and re-serializes every top-level block), **warm ~16-18ms**
   (one edit later, only the changed block misses `BlockCheckCache`) --
   about 55-60x faster, same order of magnitude as brief 03's own
   "~200x" figure for a smaller edit. Comment re-anchoring pass with 20
   comments (seeded via `debugCreateComment`, spread across the document;
   the 20th thread's own creation IS the triggering docChanged-equivalent
   event, so reading `debugCommentHighlightLastMs()` right after gives
   exactly this number): **0.6-0.7ms** -- negligible even with 20 threads.

A real bug found and fixed while writing this file (not guessed): every
`waitForFullyPainted` call hung indefinitely (30s+ timeouts) because the
test forgot to seed ANY content for its own doc names at all -- confirmed
by a throwaway debug spec (`_debug-load.spec.ts`, deleted after) that
reproduced the identical sequence WITH proper seeding and found it fast
(~2s). Fixed with a `seedDoc` helper that copies a fixture directly into
`phraiseServer.seedsDir` (the established workaround for this spike's own
`seedFiles`-array Playwright fixture bug, per the README's "Notes for the
next brief" -- five differently-named docs needed here, one fresh Yjs
document per measurement so they don't interfere with each other).

Verification: `npx tsc --noEmit` clean; `npx vitest run` 26 files, 187/187;
`npm run gates` (full suite, default parallelism, gates A-K): **84/84
passing**, gate K's own numbers stable under real contention from every
other gate running concurrently (p95 key-to-paint 14.2ms vs isolated
12.9-14.2ms -- no meaningful difference). `results/scale.json` written and
committed.

Next: gate J (feel, screenshots), then Firefox/WebKit, then final commands.

## 23:28 -- gate J (feel) done, all screenshots committed-ready, another real bug found

Another real bug found and fixed before writing any gate J test (not
guessed): `web/src/nodeviews/codeBlockView.ts`'s `MermaidBlockView` had the
EXACT SAME "opens in raw-source-editing mode before the editor has ever
been focused" bug the fix list's front-matter finding already fixed in
`rawBlockView.ts` -- `updateEditingState` there also had no
`editor.isFocused` gate. Fixed identically (same `focus`/`blur` listeners,
same `isFocused` check, same `destroy()` cleanup). Would have shown a
Mermaid block's raw fence source instead of the rendered diagram in the
mermaid screenshot below if a document happened to load with the initial
selection inside it. Re-ran gate C (source blocks, includes gate C's own
Mermaid assertions) after this fix: still 6/6.

Corpus: added `kubernetes-enhancements-kepssigapimachinery4153declarativeva`
to `corpus/needed.json`/fetched it -- the brief's own suggested
`...kepssigapps4017-pod-index-label...` has NO GFM table at all (confirmed
by grepping its raw source: zero `^|.*|` lines), so tried four other real
kubernetes/enhancements KEPs from `corpus/manifest.json` and picked the one
with both a real GFM table (3 tables) and fenced code blocks (16), per the
brief's own "or similar, check it has both". Verified it round-trips byte
for byte through the real parser/serializer before use (368 top-level
blocks: 102 headings, 134 paragraphs, 31 bullet lists, 22 ordered lists, 16
code blocks, 3 tables, 8 blockquotes, 52 raw blocks).

`e2e/gateJ-feel.spec.ts` (new), 11 tests:
1/2. **Automated no-visible-Markdown-syntax check**, on the Express README
   and the design doc above: walks the rendered `#editor .ProseMirror`
   DOM, concatenating visible text (a newline at each block-level
   element's boundary, so the "line starting with `#` " check has real
   lines), skipping any `<pre>` subtree entirely (covers real code blocks,
   a source block's own open editor, AND a raw-text preview fallback --
   all render as `<pre>`) and anything CSS-hidden (closed source editors).
   Checks for `**`, `__`, backtick, `](`, `![`, `[^`, and a line starting
   with `#` + space. Both real documents come back completely clean.
3-11. **Screenshots** (1280x800, device scale 1 -- Playwright's own
   default -- PNG, each asserted under 300KB): all ten the brief names,
   using real content throughout (the two corpus documents above for the
   two the brief ties to real corpus content; this spike's own established
   real-if-plain-English fixtures -- `comments.md`, `collab.md`,
   `source-blocks.md`, `gate-h.md`, `typing.md` -- for the rest, driven
   with the same real click/keyboard techniques their own gates already
   use, e.g. `e2e/mouseSelect.ts`'s `clickThenShiftClick` for the comment
   phrase selection, gate H's own real Mod-K "Remove link" flow for the
   unverifiable-block banner). One real bug found and fixed while building
   the "two named cursors" screenshot (not guessed): the first attempt
   placed Bob's caret via a bare `.click()` + `End` with no poll in
   between, and it landed in the HEADING, not the target paragraph --
   confirmed by reading the actual screenshot (per the orchestrator's own
   instruction to look at every screenshot); fixed by polling the real
   model selection after each click before sending further keys, the same
   discipline every other gate's own caret-placement helper in this suite
   already uses. All ten screenshots read back and visually confirmed
   clean (not just "test passed") -- sizes 35KB-186KB, comfortably under
   the 300KB budget. One pre-existing, non-blocking cosmetic note: two of
   `collab.md`'s own badge images (`img.shields.io/badge/one-blue.svg`
   etc., inline syntax, not reference-style -- this brief's reference-URL
   fix does not apply) don't resolve to real images and show their alt
   text instead, visible at the bottom of `two-named-cursors.png` below
   the two carets that screenshot is actually about; a pre-existing gate D
   fixture used elsewhere unchanged, not something this brief's scope
   covers, noted here rather than silently left out.

Verification: `npx tsc --noEmit` clean; `npx vitest run` 26 files,
187/187; `npm run gates` (full suite, default parallelism, gates A-K):
**95/95 passing**. Screenshots directory:
`spikes/2026-09-27-web-editor-tiptap/screenshots/` (10 files).

Next: Firefox/WebKit projects + cross-browser reporter table, then final
commands (fresh-clone check).
