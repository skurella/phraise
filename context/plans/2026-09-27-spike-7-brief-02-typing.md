# Brief 02: typing, shortcuts and Markdown affordances (gates A and B)

Status: dispatched
Author: spike 7 orchestrator (Opus 5.5)
Updated: 2026-09-27
Plan: [spike 7 plan](2026-09-27-spike-7-plan.md). Charter: [spike 7 charter](2026-09-27-spike-7-charter-web-editor.md), gates A and B.
Model: Sonnet (builder)

## Goal

Make the editor behave like a word processor under real keyboard input, and prove with Playwright in Chromium that every scenario of gates A and B yields exactly the expected Markdown, with untouched blocks byte-identical. Serves D4.

## Inputs

- `AGENTS.md`; the charter's "Rules for every agent in this spike"; the plan's "Key choices".
- The spike directory `spikes/2026-09-27-web-editor-tiptap/` as brief 01 left it: its README, `web/src/main.ts`, `e2e/fixtures.ts`, `e2e/smoke.spec.ts`, `src/model/serialize.ts` (read the `serializeDoc` ladder and `UnverifiedSerializationError`), `src/collab/tiptapExtensions.ts`.

## Rules for the editing extensions

- Add behaviour only as Tiptap `Extension`s or ProseMirror plugins, never new nodes or marks. The existing schema-equivalence unit test must keep passing with the full extension list.
- Put editing code in `web/src/editing/` (or `src/editing/` if unit tests need it headless), one file per concern.
- Undo and redo stay with the Collaboration extension's Yjs undo manager. Do not add Tiptap's History.
- Use `ControlOrMeta` in tests so they work on macOS and Linux.

## Scope, in order

1. **Fresh `src` for new blocks.** A top-level block created by Enter, by splitting or by an input rule must not inherit another block's `src` and `gap`; give it `src: null` (and `gap: null`). A block joined into another keeps the surviving block's `src`. Unit-test the plugin headless.
2. **Gate A: typing, with real keyboard events** (`page.keyboard`), each as its own test titled `[A] ...`, on fixtures you write under `e2e/fixtures/` with several blocks of each kind so that untouched neighbours are checked. After each scenario assert the full serialized Markdown equals an expected string written out in the test, so that untouched blocks are byte-identical by construction.
   - type a word mid-paragraph; Enter to split a paragraph, then Backspace at the start of the second half to join it back (result byte-identical to the original); Backspace at the start of a paragraph that follows a heading; Delete at the end of a paragraph that precedes a list; select across two paragraphs and type over the selection;
   - Mod-B, Mod-I on a selected word; Mod-E for inline code (Google Docs has no code shortcut; pick Mod-E and document it); Mod-K opens a small in-page link field (no `window.prompt`), Enter applies the link, Escape cancels. Also toggling bold off again;
   - lists: Enter to add an item, Enter on an empty item to leave the list, Tab to nest an item, Shift-Tab to lift it, in bullet and ordered lists;
   - tables: click a cell and type; Tab and Shift-Tab move between cells; Tab in the last cell does not insert a tab character. Adding rows or columns is not required;
   - whatever a scenario reveals as broken, fix it or record it in your log as a finding with the observed Markdown.
3. **Gate B: Markdown affordances**, tests titled `[B] ...`:
   - input rules at the start of an empty or plain paragraph: `# ` to `###### `, `- ` and `* `, `1. `, `> `, and a code fence (typing ```` ``` ```` then Enter, and ```` ```js ```` then Enter giving `lang: js`), `---` then Enter for a thematic break. Backspace right after an input rule undoes it to plain text, as Google Docs and Tiptap do;
   - paste: text/plain that is Markdown (headings, a list, bold, a link, a table, a fence) becomes rich content through spike 1's `parseMarkdown`; text/html from another app goes through the schema's `parseDOM`; a paste into the middle of a paragraph of a single-line Markdown fragment stays inline. Decide the rule for when text/plain is treated as Markdown and document it;
   - copy: a selection puts `text/plain` holding Markdown (serialized through spike 1's serializer from a document built of the slice, with `src` stripped so it re-serializes cleanly) and `text/html` holding the rendered HTML. Test by real Mod-C and reading the clipboard (grant `clipboard-read` and `clipboard-write` in Chromium), then pasting into a second paragraph with Mod-V and checking the Markdown;
   - if real clipboard shortcuts cannot be driven in headless Chromium on this machine, dispatch a real `ClipboardEvent` with a `DataTransfer` instead, and say so in the test title and log.
4. **Unit tests** for the pure parts: the Markdown-or-not paste rule, slice-to-Markdown for copy, the fresh-`src` plugin, the input-rule patterns.

Not in scope: comments, collaboration tests, source blocks and their views, styling beyond what a scenario needs to be clickable, other browsers.

## Definition of done, and stopping point

Stop when:
- `npm test` passes, with the new unit tests.
- `npm run gates` passes gates A and B in Chromium (the gate table shows both PASS), or a scenario is marked `test.fixme` with a one-line reason and the observed Markdown recorded in your log. Use `fixme` only for a limitation you could not fix, never to hide a bug you did not try to fix.
- `npx tsc --noEmit` passes; nothing listens on 4400 to 4499 afterwards.
- Work committed with explicit paths. Do not push. Update the README's layout and commands.

## Constraints

- Work only inside `/Users/skk/code/phraise/.claude/worktrees/agent-a40b6e74050a061e9`; absolute paths.
- Do not launch other agents. npm, not pnpm. 127.0.0.1 and ports 4400 to 4449 for tests.
- Log to `context/logs/2026-09-27-builder-spike-7-typing.md` at every task boundary, timestamps from `date`.

## Handback

Under 300 words: outcome per gate and scenario count; what you verified and how; `fixme`s with reasons; anything the serializer did that surprised you (which ladder path new blocks took, any `UnverifiedSerializationError`); the paste rule you chose; paths of log and changed README.
