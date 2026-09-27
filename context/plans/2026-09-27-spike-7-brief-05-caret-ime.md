# Brief 05: the local caret under remote edits, input methods, and flaky gates (gates D, E, G, I)

Status: dispatched
Author: spike 7 orchestrator (Opus 5.5)
Updated: 2026-09-27
Plan: [spike 7 plan](2026-09-27-spike-7-plan.md). Charter: [spike 7 charter](2026-09-27-spike-7-charter-web-editor.md), gates D, E, G and I.
Model: Sonnet (builder)

## Goal

Fix a data-placement bug the orchestrator confirmed in the binding, make the collaboration and offline tests deterministic, and test input-method composition while another user types in the same paragraph. Serves D5.

## What the orchestrator found

1. **The local caret does not follow remote edits in its own paragraph.** Probe: Bob's caret at the end of a paragraph; Alice types `AAA ` at the start of the same paragraph; Bob's `editor.state.selection` stays at the same absolute position, so Bob's next keystroke lands four characters early, inside a word. Cause, read in `node_modules/@tiptap/y-tiptap/dist/y-tiptap.js` (3.0.9): `_typeChanged` resolves the saved relative selection correctly, then `restoreRelativeSelection` passes it through `recoverSelectionEndpoint`, whose `isMisresolvedAfterStructuralChange` treats any change of the paragraph's `textContent` as a misresolution and "recovers" the old offset inside the block. The heuristic was added in 3.0.6 and 3.0.7 for drag-and-drop block moves (3.0.5 does not have it). This is what brief 04's builder saw as "an idle remote user's selection is not remapped".
2. **Gate E's "type alternately into the same paragraph" test is flaky**: 2 failures in 18 runs, text in the wrong place. Likely the same bug.
3. **Gate I's test is flaky and shows a real local-loss window**: 6 failures in 24 runs under parallel load. After typing ` EDIT-C` offline and immediately closing the page, the reopened page has only part of it (`EDIT-A EDIT-`). The last keystrokes had not reached IndexedDB when the page closed.

## Inputs

- `AGENTS.md`; the charter's "Rules for every agent in this spike"; the plan.
- The spike directory as briefs 01 to 04 left it: README, `web/src/main.ts`, `src/collab/`, `e2e/gateD-*.spec.ts`, `e2e/gateE-undo.spec.ts`, `e2e/gateI-offline.spec.ts`. The builder log `context/logs/2026-09-27-builder-spike-7-collab-offline.md`.
- `node_modules/@tiptap/y-tiptap/dist/y-tiptap.js`: `restoreRelativeSelection`, `recoverSelectionEndpoint`, `isMisresolvedAfterStructuralChange`, `ProsemirrorBinding` (`beforeAllTransactions`, `_typeChanged`).

## Scope, in order

1. **Reproduce finding 1 as a failing test first**, titled `[D] the local caret stays in place while the other user types before it in the same paragraph`: Bob's caret mid-paragraph, Alice types before it, Bob types; Bob's text lands where his caret was. Also the concurrent variant: both carets placed first, then both type several words interleaved (alternate short `keyboard.type` calls between the two pages), and each user's words land contiguously at their own caret.
2. **Fix it without patching `node_modules` and without changing the pinned versions**: a third workaround plugin in `src/collab/workarounds/` that, for a transaction the binding dispatches for a remote change, sets a text selection resolved purely from the Yjs relative positions (what upstream y-prosemirror does), using the binding's own exported helpers and the binding instance from the sync plugin's state. Keep node and all-selections as the binding leaves them. Document the plugin order it needs relative to the other two and add it to the plugin-order unit test. If a plugin cannot do it cleanly, say why in the log and pin `@tiptap/y-tiptap` 3.0.5 instead, re-running every gate; record which you chose. Write the upstream issue text (title, minimal repro, cause) into the log for the lead to file; do not file it.
3. **Gate E**: with the fix in place, run `gateE-undo.spec.ts` with `--repeat-each=10`; if anything still fails, find the cause and fix it; do not add sleeps to hide it.
4. **Gate I, local persistence**: track pending IndexedDB writes; the status shows "Saving on this device" until they finish, then "Offline, changes kept on this device". Flush on `pagehide` and `visibilitychange`. When offline with changes that the relay has not acknowledged, register a `beforeunload` prompt, as Google Docs does. The test waits for the status to say the changes are kept before closing the page, which is what a user sees. Add a test that measures the window: type then close at once, and report in the log how many characters survive over 10 repetitions; this is a finding, not a gate. Run `gateI-offline.spec.ts` with `--repeat-each=10` and fix what fails.
5. **Gate G, input methods**, Chromium only, driven through the DevTools protocol (`page.context().newCDPSession(page)`, `Input.imeSetComposition`, `Input.insertText`), tests titled `[G] ...`:
   - Alice composes Japanese (`にほんご` in steps, then commits `日本語`) in a paragraph while Bob types in the same paragraph before and after her caret during the composition; afterwards both editors and the Markdown show `日本語` once, at Alice's caret, and Bob's text intact;
   - the same with a Chinese pinyin sequence (`zhong` then `中`) and with a composition that is cancelled (empty commit);
   - a composition across a remote update that changes the paragraph's marks (Bob bolds a word in that paragraph);
   - a composition at the start of an empty paragraph and in a table cell;
   - record every breakage precisely: duplicated or lost characters, the composition being committed early, the caret jumping. A scenario that fails because of the stack is marked `test.fail` with the observed result, so the gate reports it honestly, and described in the log. Try one fix per breakage (for example deferring remote updates while `view.composing`), and keep it if it works.
6. **Flake sweep**: run the whole suite with `--repeat-each=5`; fix every failure at its cause; list what you fixed.

Not in scope: comments, styling, performance, screenshots, other browsers.

## Definition of done, and stopping point

Stop when `npm test` passes; `npm run gates` passes A, B, C, D, E, G, H and I in Chromium (G may contain `test.fail` scenarios for real stack breakage, each explained); the whole suite passes five repeats in a row with default workers; `npx tsc --noEmit` passes; nothing listens on 4400 to 4499; work committed with explicit paths, not pushed; README updated.

## Constraints

- Work only inside `/Users/skk/code/phraise/.claude/worktrees/agent-a40b6e74050a061e9`; absolute paths. Do not launch other agents. npm, not pnpm. Tests on 127.0.0.1, ports 4400 to 4449.
- No new nodes or marks. Do not edit `node_modules`.
- Log to `context/logs/2026-09-27-builder-spike-7-caret-ime.md` at every task boundary, timestamps from `date`.

## Handback

Under 300 words: the caret fix and its evidence; E and I flake causes and fixes with repeat counts; the IME results per scenario; the offline close-at-once measurement; paths of log and README.
