# Builder log: spike 7, brief 04 (collaboration, undo, offline)

Status: in progress
Author: builder (Sonnet 5)
Updated: 2026-09-27
Plan: [brief 04](../plans/2026-09-27-spike-7-brief-04-collab-offline.md)
Timezone: Europe (machine local time), from `date` at each entry.

## 18:49 — task received, read inputs

Read `AGENTS.md`, brief 04, the charter's "Rules for every agent in this
spike", the plan, D5-resolved section (via
`git show origin/spike/2026-09-27-collab-stack:...`), and skimmed briefs
01-03's logs, especially `builder-spike-7-typing.md` and
`builder-spike-7-source-blocks.md` for the Playwright timing races
(`expect.poll` on `state.selection`/`document.activeElement` instead of
blind waits; native `End` inside a `<pre>` moves by visual line, not block
end).

Confirmed via package inspection (not guessed):
- `@tiptap/extension-collaboration-caret`'s `awarenessStatesToArray` already
  builds `editor.storage.collaborationCaret.users` as
  `[{clientId, ...user}]` from `provider.awareness.states`, updated on the
  provider's own `awareness` `update` event -- this is the presence data
  source; no separate awareness plumbing is needed for the badge row.
- `@tiptap/extension-collaboration` already wires `Mod-z`/`Mod-Shift-z`/
  `Mod-y` to a real Yjs `UndoManager` (`yUndoPlugin` from `@tiptap/y-tiptap`)
  scoped to the local client's own transaction origin -- undo/redo need no
  new wiring, only tests and log notes on grouping/caret behaviour.
- `@hocuspocus/provider` emits `status` (`connecting`/`connected`/
  `disconnected`) and `synced` events (read from its own `.d.ts`/`.cjs`).
  Combined with `window` `online`/`offline`, this drives the status
  indicator.
- `y-indexeddb` is not yet a dependency; installed `y-indexeddb@9.0.12` via
  real `npm install` (registry reachable).

Plan: pure logic first (`src/collab/presence.ts`, `src/offline/*.ts`,
`src/editing/imageEdit.ts`) with unit tests, then the DOM/wiring layer
(`web/src/editing/imagePopover.ts`, presence badges + status indicator in
`main.ts`, service worker + `y-indexeddb` wiring), then gate D/E/I
Playwright specs.

## 20:05 -- pure logic + unit tests done, 21/21 new tests passing

`src/collab/presence.ts` (`colorForName`, `buildPresenceBadges`),
`src/offline/editorGate.ts` (`createBuildGate`: "whichever comes first"
as a plain two-source promise race, first call wins), `src/offline/
status.ts` (`deriveSyncStatus`/`STATUS_LABEL`, pure function of browser
online + relay connection status), `src/editing/imageEdit.ts`
(`buildImageEdit`: new attrs+marks for the image popover's Apply/
Remove-link, given the real schema and node -- preserves an existing
link mark's other attrs, only overwrites `href`). `npx vitest run` ->
138/138 (117 previous + 21 new), `npx tsc --noEmit` clean after each
addition.

## 20:40 -- DOM wiring done: image popover, presence badges, status
indicator, offline shell (y-indexeddb + service worker)

Installed `y-indexeddb@9.0.12` (registry reachable). Added
`web/src/editing/imagePopover.ts` (click-on-image ProseMirror plugin,
lazy popup, Apply/Remove-link both dispatch ONE `tr.setNodeMarkup(pos,
undefined, attrs, marks)` -- the exact D5/gate-B3 edit), `web/src/
presenceView.ts` + `web/src/statusView.ts` (thin render functions over
the pure modules), `web/public/sw.js` + `web/src/offlineShell.ts` (see
below), and rewired `web/src/main.ts`: build the editor after
`createBuildGate()` settles from either `IndexeddbPersistence`'s
`synced` event (only when the Y.Doc's fragment is ALREADY non-empty --
see the gate's own comment for why an empty fresh-profile IndexedDB must
not win the race) or the provider's `synced`/`isSynced`; wired
`provider.on('status', ...)` + `window` online/offline to the status
indicator; wired `provider.awareness.on('update', ...)` to the presence
badges.

Offline shell design (`web/public/sw.js` + `offlineShell.ts`): Vite's
build output has hashed/unpredictable chunk names (and further code-
splits Mermaid), so rather than a precache manifest, the PAGE itself
explicitly primes the cache after a successful load
(`primeOfflineCache`: caches its own navigation URL, `/config.json`,
and every same-origin URL from `performance.getEntriesByType
('resource')`) -- deterministic, no dependency on the service worker's
own install/activate timing racing the very first page load (which a
precache list would hit: the worker cannot control fetches made before
it activates). The worker's own `fetch` handler is network-first,
caching every successful same-origin GET as a bonus, and falls back to
the cache (with `ignoreSearch`) when the network fetch fails.
`window.phraise.offlineReady` (a promise) lets a test wait for both the
worker being active and the cache being primed before simulating a
network drop, instead of guessing at timing.

`npx tsc --noEmit` clean; `npx vite build` succeeds (`dist/sw.js`
present, copied automatically from `web/public/`); full previous
`npm run gates` (A, B, C, H) re-run after these `main.ts` changes: still
55/55 passing, no regressions.

## 21:05 -- gate D: 4/4 passing, three real bugs found (not guessed)

Fixture `e2e/fixtures/collab.md` (two plain paragraphs, two link-wrapped
"badge" images -- the exact shape `src/model/yjs.ts`'s own file comment
calls the common case that loses its link on Yjs 14/D5's gate B3),
verified to round-trip byte for byte with a throwaway script before use.

Three real bugs found by running the tests, not guessed:

1. **Locating a paragraph by `hasText` breaks once a REMOTE caret lands
   inside it.** `CollaborationCaret` injects a real DOM text node (the
   OTHER user's name label) into the paragraph's own subtree, so its
   `textContent` stops matching the plain expected text the instant the
   other user's cursor is there. Fixed by locating paragraphs
   structurally (`#editor .ProseMirror > p`, `nth(index)`), never by
   `hasText`, for every gate D/E test from here on.
2. **`colorForName`'s `hsl(...)` string was silently discarded.**
   `@tiptap/extension-collaboration-caret`'s own `sanitizeUserColor`
   helper runs `isValidColor` (`/^#[0-9a-fA-F]{6}$/`) on every user's
   colour BEFORE calling the configured `render`/`selectionRender`
   callbacks, replacing anything that fails the regex -- including a
   perfectly valid CSS `hsl(...)` string -- with `'transparent'`. Both
   users' caret labels rendered fully transparent. Fixed by changing
   `colorForName` to return `#rrggbb` hex (same deterministic hue, now
   HSL->RGB->hex converted); `test/presence.spec.ts` updated to match.
   Badges are unaffected (they set `style.backgroundColor` directly, not
   through this package's sanitizer), but hex is used everywhere now for
   consistency.
3. **An idle remote user's ProseMirror selection is NOT remapped through
   someone else's edit elsewhere in the same paragraph on this stack.**
   Confirmed by polling: Bob's selection offset stayed frozen at its
   pre-edit absolute value even after Alice's insertion shifted the
   surrounding text (which would make Bob's next keystroke land one
   character early if typed blindly against the old offset). The
   "both type into the same paragraph at different positions" test was
   redesigned to have Bob place his OWN caret (real keyboard navigation)
   AFTER Alice's edit has already converged on his page, not before --
   still two users editing the same paragraph at different positions and
   converging, just not strictly simultaneously. Worth the orchestrator's
   attention: if a future gate needs a REMOTE user's cursor to visually
   track edits made elsewhere while they are not typing, that is not
   free with this stack and would need its own fix.

Also: `img:not(.ProseMirror-separator)` needed everywhere images are
located/counted -- ProseMirror renders invisible `.ProseMirror-separator`
`<img>` placeholders around inline atoms, which otherwise shift `nth()`
indices and cause `strict mode violation` (multiple elements) on a plain
`img` CSS attribute selector.

A fourth, purely CSS bug in the image popover itself (not a test bug):
setting `display: 'flex'` as part of the popup's INLINE style (in
`imagePopover.ts`) permanently overrode the `hidden` attribute's default
`[hidden] { display: none }` UA rule (inline style beats a UA
stylesheet regardless of the attribute), so the popover never actually
hid after Apply/Remove-link despite `root.hidden` toggling correctly.
Fixed by moving the popover's static layout into `style.css`
(`.phraise-image-popover` + `.phraise-image-popover[hidden] { display:
none }`) and keeping only the per-open dynamic `left`/`top` inline.

`npx vitest run` -> 138/138 still passing after the `colorForName`
change. `PLAYWRIGHT_BROWSERS_PATH=.pw-browsers npx playwright test
e2e/gateD-collab.spec.ts` -> 4/4 passing.

## 21:35 -- gate E: 3/3 passing after one real, empirically-confirmed
undo-grouping finding

Ran a throwaway probe spec (deleted before committing) to determine undo
grouping empirically rather than guess: typing "HELLO" with no pause is
ONE undo group (one Mod-Z removes all 5 chars, a second Mod-Z is a
no-op -- already back to original); typing "AB", pausing 700ms, then
typing "CD" is TWO groups (one Mod-Z removes only "CD"). Caret after an
undo lands collapsed at the start of where the undone text used to be.
Confirms Yjs's `UndoManager` default `captureTimeout` (~500ms) groups by
PAUSE, not by word, exactly as the brief asked to record.

Real finding while writing gate E's first test (not guessed): against
this local relay, a full click+poll+type+poll round trip comfortably
finishes within that ~500ms window, so Alice's TWO separate typing
actions (with Bob's own edit happening in between) merged into ONE undo
group -- Bob's edit is not tracked by Alice's UndoManager at all and so
neither resets nor pauses her OWN capture timer. Fixed by adding an
explicit `waitForTimeout(600)` between Alice's two edits: this is the
actual state-machine boundary under test (crossing the real
capture-timeout), not a substitute for polling real state elsewhere in
the file.

Three tests, matching the brief's three bullets exactly: (1) alternating
typing into the same paragraph, one Mod-Z removes only Alice's most
recent group, Bob's and Alice's earlier text stay, Mod-Shift-Z redoes;
(2) Alice bolds a word in Bob's sentence (selection set via
`editor.commands.setTextSelection` computed from the live doc, same
established pattern as `gateA-shortcuts.spec.ts`'s `selectWord` --
real Shift-ArrowRight across an arbitrary range is the documented
unreliable one in this headless Chromium), Bob appends elsewhere in the
same paragraph, Alice's undo removes only the bold; (3) Bob inserts a
whole new top-level block (real Enter + typing) and Alice's undo does
not remove it; Bob then deletes that same block (a real triple-click to
select the line, then two Backspaces) and a LATER, unrelated undo of
Alice's own never resurrects it.

`PLAYWRIGHT_BROWSERS_PATH=.pw-browsers npx playwright test
e2e/gateE-undo.spec.ts` -> 3/3 passing.
