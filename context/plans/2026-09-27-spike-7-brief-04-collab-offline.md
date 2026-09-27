# Brief 04: collaboration, undo and offline (gates D, E and I)

Status: dispatched
Author: spike 7 orchestrator (Opus 5.5)
Updated: 2026-09-27
Plan: [spike 7 plan](2026-09-27-spike-7-plan.md). Charter: [spike 7 charter](2026-09-27-spike-7-charter-web-editor.md), gates D, E and I.
Model: Sonnet (builder)

## Goal

Prove in real browsers that two people editing one document through the relay see each other's edits and named, coloured cursors, that undo touches only one's own changes, and that a person can go offline, keep editing across a page reload, and converge with the other person when the network returns. Serves D1, D5 and D6's offline path.

## Inputs

- `AGENTS.md`; the charter's "Rules for every agent in this spike"; the plan's "Key choices" (offline paragraph).
- D5 as resolved after spike 5 (`git show origin/spike/2026-09-27-collab-stack:context/docs/2026-09-27-architecture-decisions.md`, section "D5 resolved after spike 5"): the two workaround plugins, their order, and why the editor is built after the first sync.
- The spike directory as briefs 01 to 03 left it: README, `web/src/main.ts`, `e2e/fixtures.ts`, `src/collab/`. Previous builder logs `context/logs/2026-09-27-builder-spike-7-*.md` (skim for the Playwright timing lessons).

## Scope, in order

1. **Presence.** Carets and selections of other users carry the user's name in a small label and a colour derived from the name (already partly there from brief 01). A row of small name badges in the top bar shows who is here. Test titles `[D] ...`.
2. **Image editing.** Clicking an image opens a small in-page popover with two fields, "Image address" and "Link", and Apply and Remove-link buttons; Apply replaces the image's `url` and its link mark together in one transaction. This is the edit that spike 5's gate B3 showed breaking on Yjs 14; here it must work through the live binding and the `leafMarks` workaround in both browsers.
3. **Gate D tests**, two browser contexts (Alice and Bob) on one document through the relay, all edits by real keyboard and mouse:
   - each types into a different paragraph and each sees the other's text; both serialize to the same, expected Markdown;
   - both type into the same paragraph at different positions; they converge;
   - each sees the other's caret with the right name label and a colour, in the DOM and visibly (a caret element with non-zero size);
   - Alice changes a linked badge image's address and link together through the popover; Bob's editor shows the new `src` and the new `href`; both serialize the new Markdown; then Bob does the same to another badge and Alice sees it; the relay's stored document, read by a fresh third context, agrees.
4. **Gate E tests**, undo and redo by Mod-Z and Mod-Shift-Z (and Mod-Y if bound), titled `[E] ...`:
   - Alice and Bob type alternately into the same paragraph; Alice undoes; only Alice's typing disappears and Bob's remains, in both editors; Alice redoes; everything is back;
   - Alice bolds a word Bob then edits; Alice undoes the bold; Bob's text stays;
   - Alice's undo does not remove a block Bob inserted, nor bring back one Bob deleted;
   - record in the log how undo groups typing (per word, per pause) and whether the caret lands where a user expects after undo.
5. **Offline** (gate I, titled `[I] ...`):
   - persist the document in the browser with `y-indexeddb`, one database per document name;
   - a service worker caches the app shell (HTML, JS, CSS, `/config.json`) so a reload with the network off still loads the page. Hand-written worker registered from the page is fine; localhost is a secure context;
   - build the editor after whichever comes first: IndexedDB loaded with content, or the provider's first sync. Keep spike 5's constraint that the workaround plugins see the document's content when the editor is built;
   - a status indicator in the top bar: "Saved", "Offline, changes kept on this device", "Reconnecting";
   - test: Alice and Bob online; Alice goes offline with `context.setOffline(true)`; Alice types; Bob types elsewhere and does not see Alice's text; Alice reloads the page while still offline, sees her text, types more; Alice goes online; both converge to the same Markdown containing all three edits. Also: Alice's edits made offline survive closing the page and opening a new one while offline. If `setOffline` does not stop the relay's WebSocket in Chromium, find what does (for example routing, or stopping the relay process while the page server stays up) and record which you used and why;
   - check with `lsof` and the relay's own document that no edit is lost.
6. **Unit tests** for any pure logic you add (colour from name, editor-build gating, status state machine, image-edit transaction builder).

Not in scope: comments, source-block changes, IME, performance, screenshots, other browsers.

## Definition of done, and stopping point

Stop when `npm test` passes; `npm run gates` shows A, B, C, D, E, H and I PASS in Chromium, or a test is `test.fixme` with a one-line reason and the observed behaviour recorded in your log; `npx tsc --noEmit` passes; nothing listens on 4400 to 4499; work committed with explicit paths, not pushed; README updated.

## Constraints

- Work only inside `/Users/skk/code/phraise/.claude/worktrees/agent-a40b6e74050a061e9`; absolute paths. Do not launch other agents. npm, not pnpm. Tests on 127.0.0.1, ports 4400 to 4449.
- No new nodes or marks; `checkSchemaEquivalence` must keep passing.
- Log to `context/logs/2026-09-27-builder-spike-7-collab-offline.md` at every task boundary, timestamps from `date`.

## Handback

Under 300 words: outcome per gate with test counts; what you verified and how; `fixme`s with reasons; how offline was simulated; any divergence, lost edit or undo surprise; paths of log and README.
