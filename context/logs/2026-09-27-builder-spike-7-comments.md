# Builder log: spike 7, brief 06 (comments, gate F)

Status: in progress
Author: builder (Sonnet 5)
Updated: 2026-09-27
Plan: [brief 06](../plans/2026-09-27-spike-7-brief-06-comments.md). Charter: [spike 7 charter](../plans/2026-09-27-spike-7-charter-web-editor.md), gate F.
Timezone: Europe (machine local time, from `date` at each entry).

## 21:43 -- task received, read inputs

Read `AGENTS.md`, brief 06, the charter's "Rules for every agent in this
spike", the plan, and skimmed brief 05's log
(`2026-09-27-builder-spike-7-caret-ime.md`) for Playwright lessons (real
keyboard selection via Shift+Arrow/Cmd+Left/Right, poll
`editor.state.selection` until it settles, `bringToFront()` before typing
into a background page, the `typeAndVerify` retry pattern, and the U+00A0
space-substitution normalization).

Read D3's amendment (`git show origin/spike/2026-09-27-crdt-rebase:context/docs/2026-09-27-architecture-decisions.md`,
section "D5, D6 and D3 amendments after spike 2"): the anchor record (CRDT
relative position pair assoc 0/-1, exact quote, 32-char prefix/suffix,
character offsets) and the fuzzy acceptance rule (context agreement or a
long unique quote; reject when a second location scores nearly as well;
orphan rather than mis-anchor).

Read spike 2's `src/rebase/comments.ts` (via `git show
origin/spike/2026-09-27-collab-stack:spikes/2026-09-27-collab-stack-yjs13-hocuspocus/src/rebase/comments.ts`,
commit `eeb3fe2`, 316 lines) and its `text.ts`/`ids.ts` helpers: `addComment`/
`resolveComment`/`fuzzyAnchor`/`contextOnlyAnchor` operate over a SINGLE
`Y.XmlText` per textblock (spike 2's toy schema always has exactly one
child). This editor's schema is richer (table cells, list items, inline
atoms: image/hard_break/raw_inline as sibling `Y.XmlElement`s next to
`Y.XmlText` runs inside a textblock), so spike 2's `docPlainText`/
`offsetToPosition` cannot be copied unchanged; ported the *algorithm*
(fuzzy scoring, ambiguity guard, context-only fallback) but rebuilt the
plain-text projection over a real ProseMirror `Node` tree instead (see
below).

Read `src/collab/workarounds/localCaretFollow.ts` (brief 05) for the
established pattern of using `@tiptap/y-tiptap`'s exported
`absolutePositionToRelativePosition`/`relativePositionToAbsolutePosition`
against a live binding's `(doc, type, mapping)`. Confirmed
`@tiptap/y-tiptap` also exports `initProseMirrorDoc(yXmlFragment, schema)`
-> `{ doc, mapping }`, which builds a headless ProseMirror `Node` + the
same `ProsemirrorMapping` a live binding would have, straight from a
`Y.XmlFragment` -- no `EditorView`, no DOM. This is the key building
block for a comments model that is both: (a) pure and unit-testable with
two headless `Y.Doc`s (task 1/6), and (b) reusable live against the
editor's real binding without duplicating the position math (task 2).

Design decision (to record in the findings doc later): anchor building and
resolution take an `AnchoringContext { ydoc, fragment, mapping, doc }`.
Headless tests build it via `initProseMirrorDoc`; the live decoration
plugin builds it from `ySyncPluginKey.getState(state).binding`'s own
`doc`/`type`/`mapping` (same fields `localCaretFollow.ts` already reads),
so "resolve through the binding's mapping" is literal, not simulated.
Plain-text projection (for quote selectors and the fuzzy fallback) is a
new, from-scratch walk of the PM `Node` tree (`doc.descendants`, stopping
at `node.isTextblock`), joining textblocks with a `\n\n` separator and
representing each inline atom (image/hard_break/raw_inline) as one
`￼` placeholder character, so offsets stay 1:1 with PM position
deltas.

Starting on task 1 (data model + anchor builder), pure, under
`src/comments/`.

## 21:54 -- task 1/2/6 done: pure model, anchor builder/resolver, unit tests (22 new, 170/170 total)

Added `approx-string-match@^2.0.0` (`npm install`, confirmed available on
the registry first) -- spike 2's own dependency for the fuzzy search
(Myers' bit-vector algorithm), not previously in this spike's
`package.json`.

`src/comments/textProjection.ts`: `projectDocText(doc: PMNode)` walks a
ProseMirror `Node` tree (`doc.descendants`), stopping at `node.isTextblock`
(covers paragraph/heading/code_block/raw_block/table_cell automatically,
since PM derives `isTextblock` from the content expression, not a
hand-maintained list) and manually laying out that textblock's own
children -- correctly handling inline atoms (image/hard_break/raw_inline)
as one `￼` placeholder character each, interspersed with real
`Y.XmlText` runs, which spike 2's own `docPlainText` (one `Y.XmlText` per
textblock, guaranteed by its toy schema) could not have handled unchanged.
Textblocks are joined by `\n\n`. `posToOffset`/`offsetToPos` convert
between a PM position and a projected-text offset via the run table; both
return `null` outside any run (e.g. inside the block separator).
`test/comments/textProjection.spec.ts` (4 tests): plain paragraphs, nested
textblocks (list item, table cell), an inline atom's placeholder character
and its position-delta-1 property, and the null cases.

`src/comments/anchor.ts`: `AnchorRecord` (CRDT relative position pair as
`Y.relativePositionToJSON`, D3's quote selector, and the creation-time
character offsets) and `AnchoringContext` (`{ydoc, fragment, mapping, doc,
projection}`), built two ways -- `contextFromYDoc` (headless, via
`@tiptap/y-tiptap`'s own exported `initProseMirrorDoc(fragment, schema)`,
confirmed exported with types at
`node_modules/@tiptap/y-tiptap/dist/src/lib.d.ts`) and `contextFromBinding`
(for the live plugin, from the editor's own `ySyncPlugin` binding's
`doc`/`type`/`mapping` -- the exact fields
`src/collab/workarounds/localCaretFollow.ts` already reads, confirmed by
that file's own file comment and by
`node_modules/@tiptap/y-tiptap/dist/y-tiptap.js`'s `absolutePositionToRelativePosition`/
`relativePositionToAbsolutePosition` signatures). `buildAnchorRecord`/
`resolveAnchor` don't care which constructor built their context, so the
"resolve through the binding's mapping" the brief asks for is literal for
the live path, without duplicating position math for the headless one.
`resolveAnchor`: CRDT position first (`relativePositionToAbsolutePosition`
returning non-null, non-collapsed); on failure, the fuzzy quote-selector
match; on that failing too, orphaned.

Fuzzy matching (`fuzzyAnchor`/`contextOnlyAnchor`/`contextSimilarity`/
`levenshtein`/`charSimilarity`, plus the acceptance-rule constants) is
ported from spike 2's `src/rebase/comments.ts`
(`origin/spike/2026-09-27-collab-stack` at `eeb3fe2`), operating on this
file's own text projection instead of spike 2's `Y.XmlText`-segment one.

Real finding while writing `test/comments/anchor.spec.ts` (task 6's
ambiguity-guard hand case): the ported `contextOnlyAnchor` (the "quoted
text was edited in place" fallback -- prefix and suffix found close
together, anchor to whatever now sits between them) scored each candidate
gap on its own small scale (`-errors*10 - lenPenalty*5 + posProximity*2`)
and simply picked the best one, with NO guard against a second,
equally-plausible gap -- unlike the main quote-search path, which does
have the ambiguity margin. Reproduced concretely: two byte-identical
copies of one sentence, far enough apart that their 32-character
prefix/suffix context windows never overlap each other, both scoring
==nearly identically (91.24 vs 91.33, verified with a throwaway `tsx`
script against the real `approx-string-match` output before writing the
fix -- deleted after, not committed) -- the old code silently picked the
second occurrence every time regardless of which one the user's comment
actually belonged to. This is a genuine correctness gap for gate F's own
scenario class (two structurally identical paragraphs, e.g. a duplicated
section), not just a test artifact, so fixed rather than test-adjusted
around: rewrote `contextOnlyAnchor` to score every candidate gap with the
SAME weighted formula the quote-search path uses (quote similarity of the
gap's own text + prefix/suffix similarity + position proximity) and apply
the SAME `AMBIGUITY_MARGIN` guard against the best non-overlapping
alternative. Documented in the function's own comment, pointing at the
reproducing test. Also had to correct two of my own test's original
scenarios after they exposed *my test's* design flaws rather than a real
bug (logged so the reasoning is visible, not silently rewritten): a
"moved short quote, new neighbours" case first asserted `fuzzy` but
correctly resolves to `orphaned` per the acceptance rule (a short quote
with NEITHER supporting context NOR standalone length has no basis to
accept) -- fixed by using a long (>=24 char) unique quote, which IS the
rule's own "long unique quote" exception for a genuinely moved comment;
and the ambiguity test's first draft placed two similar sentences right
next to each other, so their 32-char context windows leaked into each
other and accidentally became distinguishing -- fixed by separating them
with an unrelated filler paragraph.

`src/comments/model.ts`: `THREADS_MAP_NAME = 'phraise-comments'`, a
top-level `Y.Map` (outside `FRAGMENT_NAME`'s fragment, so comments never
reach `serializeDoc`/the Markdown). Each thread is a nested `Y.Map` (not a
plain object) specifically so `messages` can be a `Y.Array` -- concurrent
replies from two replicas both survive Yjs's own array-CRDT insertion
ordering (proven in `test/comments/model.spec.ts`, two real `Y.Doc`s
exchanging `Y.encodeStateAsUpdate`/`Y.applyUpdate`, no relay, no
EditorView). `anchor` and the resolved fields are plain values on the
thread's own map (last-write-wins under ordinary `Y.Map` semantics is the
right merge behaviour for those single-fact fields; only `messages` needs
CRDT-array merge). `createThread`/`addReply`/`setResolved`/`getThread`/
`listThreads`/`observeThreads` (a deep observer, since replies live in the
nested array). 8 tests: lifecycle (create/reply/resolve/reopen/list/
observe) plus 3 concurrent-merge scenarios (two offline replies both
survive in a stable, identical order on both replicas; a reply concurrent
with a resolve elsewhere isn't lost; two independently-seeded docs
converge after sync).

`npx vitest run` -> 23 files, 170/170 (148 previous + 22 new), all green.
`npx tsc --noEmit` -> clean.

Next: task 3 (decoration/highlight plugin), task 4 (sidebar, composer,
floating Comment button, Mod-Alt-M), then gate F's Playwright tests.

## 22:10 -- tasks 2/3/4/5 done: highlights, sidebar, composer, gate F all green

`web/src/comments/liveContext.ts`: `liveAnchoringContext(state)` reads
`ySyncPluginKey.getState(state).binding`'s `doc`/`type`/`mapping` -- the
exact fields `localCaretFollow.ts` already reads -- and calls
`contextFromBinding` (exported from `src/comments/anchor.ts` alongside
`contextFromYDoc`), so the live path and the headless-test path share one
constructor.

`web/src/comments/highlightPlugin.ts`: `commentHighlightPlugin` (a plain
ProseMirror plugin, wrapped as a Tiptap `Extension` in
`highlightExtension.ts`, same pattern as `PhraiseWorkarounds`). Its plugin
state recomputes fully on any `docChanged` transaction OR a meta-only
"refresh" transaction (`refreshCommentHighlights`, called from the
controller after a local thread action); resolves every unresolved
thread's anchor via `resolveAnchor`, skips resolved and orphaned threads
(no decoration at all), and paints the rest with
`Decoration.inline(start, end, {class, 'data-thread-id'}, {threadId})`,
`--active` for whichever thread the sidebar has selected.

`web/src/comments/sidebar.ts` (`renderSidebar`, rebuild-from-scratch DOM),
`web/src/comments/commentTrigger.ts` (`CommentTrigger`: the floating
"Comment" button, positioned via `editor.view.coordsAtPos`, same
lazy-DOM-element pattern as `imagePopover.ts`; Mod-Alt-M via
`addKeyboardShortcuts`), and `web/src/comments/controller.ts`
(`CommentsController`: owns the only per-tab-local state -- active thread,
pending composer selection, show-resolved toggle -- and wires the Y.Map
observer, the highlight plugin's refresh, and the sidebar's rerender
together). Wired into `web/src/main.ts` via a `commentsRef` mutable
holder (the two extensions need the `CommentsController`, which itself
needs the built `Editor` -- a chicken-and-egg problem solved by populating
the ref right after `new Editor(...)`). `web/index.html` gained
`#comments-sidebar`; `web/src/style.css` gained the highlight/sidebar/
composer/floating-button styles (plain, matching brief 03's own choice).

Two real bugs found and fixed while writing `e2e/gateF-comments.spec.ts`
(`e2e/fixtures/comments.md`, verified byte-identical round-trip before
use), both confirmed as true failures against the real app first, not
guessed:
1. `Decoration.inline(from, to, attrs, spec)` takes attrs and spec as TWO
   SEPARATE constructor arguments (confirmed by reading
   `node_modules/prosemirror-view/dist/index.d.ts`'s own signature) -- the
   first version put `data-thread-id` only in `attrs` (so it would render
   into the DOM) and tried to read it back off `.spec` in `handleClick`,
   which is always empty unless a spec object is passed explicitly. Fixed
   by passing `{threadId: thread.id}` as the fourth argument and reading
   `.spec.threadId`. Symptom: clicking inside a highlight never activated
   its thread.
2. Two separate "the sidebar didn't update" gaps, since the threads
   `Y.Map` lives OUTSIDE the ProseMirror-bound fragment (by design, so
   comments never touch the Markdown): (a) a remote thread change (new
   comment/reply/resolve arriving from another replica) produces no
   ProseMirror transaction on its own, so nothing told the highlight
   plugin to recompute -- fixed by calling `refreshCommentHighlights` from
   the `observeThreads` callback too, not only from this tab's own local
   actions; (b) a thread becoming ORPHANED is purely a consequence of a
   DOCUMENT edit (the quoted text being deleted), with no write to the
   threads map at all -- the highlight plugin already recomputes on every
   `docChanged` transaction, but the sidebar's own "which group is this
   thread in" computation only ran from thread-map-triggered or
   locally-triggered renders, so an orphaning edit left the sidebar
   showing the thread as still-active until an unrelated action happened
   to rerender it. Fixed by also calling `render()` (debounced 250ms, same
   figure `main.ts`'s own Markdown-panel refresh already uses) on every
   `docChanged` editor transaction. Debouncing this, plus a rerender
   rebuilding the sidebar's DOM from scratch on every call, meant a third,
   related fix: `sidebar.ts`'s `captureDraftFocus`/`restoreDraftFocus`
   preserve whichever reply/composer textarea has focus (its value and
   caret) across a rebuild, so a document edit arriving elsewhere while a
   user is mid-reply does not wipe their draft.

Also found while writing the "highlight follows the text" test (not a
bug): a single logical `Decoration.inline` range can legitimately render
as MORE than one `<span>` in the DOM once an edit lands strictly inside
it -- ProseMirror renders one wrapper element per contiguous pre-existing
inline text node rather than merging adjacent ones under one decoration.
The test's own `highlightedText()` helper joins `allTextContents()` across
however many spans exist, in document order, rather than asserting a
single element.

Gate F (`e2e/gateF-comments.spec.ts`, 6 tests, titled `[F] ...`, two
contexts (Alice/Bob) + a third (Carol) for the reload/fresh-context test,
real keyboard (`Shift+ArrowRight` for phrase selection -- the
orchestrator's own confirmed-working technique, polling
`editor.state.selection` via `expect.poll` until it settles before
reading) and mouse (clicks, a real triple-click for "select the whole
paragraph") only:
1. Alice selects a phrase, adds a comment via the floating button; the
   highlight and sidebar thread appear for Alice AND (once synced) Bob;
   clicking inside the highlight activates the thread; Mod-Alt-M opens a
   composer for a second selection and Escape cancels it cleanly.
2. Bob replies; Alice sees it; Alice resolves; the highlight disappears on
   both; the thread only reappears once "Show resolved" is checked, now
   showing "Reopen" instead of "Resolve".
3. The highlight follows the text: Bob types before the phrase in the
   same paragraph, inserts a new empty paragraph directly above it (caret
   at position 0, Enter, then types into the new paragraph), and types
   INSIDE the phrase -- the highlighted text (joined across however many
   spans) stays exactly the phrase, then exactly the phrase WITH his
   insertion, on both Alice's and Bob's pages, throughout.
4. Bob selects the whole paragraph (triple-click) and deletes it
   (Backspace twice: clears the text, then joins the empty paragraph away)
   -- both sidebars show the thread under "Orphaned" with its original
   quote and the note "The text this comment referred to was deleted.";
   no highlight remains.
5. The Markdown is byte-identical to the original fixture after adding,
   replying to, and resolving a comment (comments never touch
   `FRAGMENT_NAME`'s `Y.XmlFragment`, so this was expected, not a close
   call, but is asserted directly per the brief).
6. A comment survives `page.reload()` (same browser, same relay/SQLite
   persistence every other gate already relies on) and appears, with its
   highlight, for a fresh third context (Carol).

`PLAYWRIGHT_BROWSERS_PATH=.pw-browsers npx playwright test
e2e/gateF-comments.spec.ts --repeat-each=5 --workers=1` -> 30/30 passing.
`npm run gates` (the full suite, gates A-I) -> 78/78 passing, gate F shows
"6 PASS" alongside every gate that passed before (A 22, B 23, C 6, D 6, E
3, G 6, H 4, I 2); J/K not run (out of this brief's scope). `npx vitest
run` -> 24 files, 175/175 (170 previous + 5 new `relativeTime` tests).
`npx tsc --noEmit` -> clean. `lsof -nP -iTCP:4400-4499 -sTCP:LISTEN` ->
empty.

Not chased further (documented, not silently dropped): comments spanning
two blocks are not specially handled -- `buildAnchorRecord` builds
whatever quote/offsets a cross-block PM range actually has (the quote
would contain the `\n\n` block separator), and `resolveAnchor` treats it
like any other range; no test exercises this directly, per the brief's own
"not in scope: comments spanning two blocks beyond what falls out
naturally (record the behaviour)". Reply/composer drafts are only
preserved across a rerender triggered by ANOTHER user's edit or a resolve
elsewhere in this SAME tab, not across a full page reload (expected;
nothing asks for that).

## 22:18 -- full-suite flake found and fixed at the cause (matching the established discipline)

`npm run gates` (default worker parallelism, ALL gates A-I together, not
just gate F in isolation) failed once: `placeCaret`'s final poll (caret
offset after `Home` + N `ArrowRight` presses) timed out inside gate F's
first test's Mod-Alt-M section, under real contention from several other
gates' browsers/relays running concurrently. Never reproduced running
gate F alone (30/30 at `--repeat-each=5`, `--workers=1`, twice).

Same class of flake brief 05 already root-caused twice for `typeAndVerify`
(a real, rare CDP input-delivery miss under parallel load, not application
logic) -- diagnosed the same way rather than assumed: the failure's own
error showed the offset simply never reached the wanted value within the
15s suite-wide `expect.poll` timeout, consistent with a dropped/delayed
keystroke rather than a wrong position. Fixed at the cause, following the
established pattern exactly: `placeCaret` now retries its whole
click+Home+ArrowRight-N sequence up to 3 times if a SHORTER (3s) poll
doesn't converge, logging every retry via `console.log`
(`[placeCaret-retry] ...`) per the charter's own instruction not to retry
silently; `selectPhrase`'s `Shift+ArrowRight` extension loop got the same
treatment (retries the whole placeCaret-then-extend sequence). A
successful attempt still returns in single-digit milliseconds, so this
never slows the common case -- confirmed by two consecutive clean
`npm run gates` runs afterward (78/78 both times, default worker
parallelism) plus a third `--repeat-each=5` run of gate F alone (30/30).
No retry has actually fired in any of these post-fix runs (no
`[placeCaret-retry]`/`[selectPhrase-retry]` lines in the output), matching
the "rare" characterization -- this hardens against a flake proven to
happen under full-suite load, not one currently reproducing on demand.

Final state: `npx vitest run` -> 24 files, 175/175. `npx tsc --noEmit` ->
clean. `npm run gates` -> 78/78 (A 22, B 23, C 6, D 6, E 3, F 6, G 6, H 4,
I 2; J/K not run), run twice clean. `lsof -nP -iTCP:4400-4499
-sTCP:LISTEN` -> empty. README updated (title/status briefs 01-06, Layout,
Origin of copied code, Commands, Verified, a new "Brief 06" findings
section, and "Notes for the next brief" additions for brief 07).
