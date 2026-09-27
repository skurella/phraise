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
