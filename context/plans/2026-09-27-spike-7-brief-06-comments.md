# Brief 06: comments (gate F)

Status: dispatched
Author: spike 7 orchestrator (Opus 5.5)
Updated: 2026-09-27
Plan: [spike 7 plan](2026-09-27-spike-7-plan.md). Charter: [spike 7 charter](2026-09-27-spike-7-charter-web-editor.md), gate F.
Model: Sonnet (builder)

## Goal

A Google-Docs-like comment experience on the live document: select text, add a comment, see threads in a sidebar, reply and resolve, with highlights that follow the text through the other user's edits and an orphaned state that keeps the quote when the text is deleted. Serves D3.

## Inputs

- `AGENTS.md`; the charter's "Rules for every agent in this spike"; the plan.
- D3 in the [architecture decisions](../docs/2026-09-27-architecture-decisions.md) and its amendment after spike 2 (`git show origin/spike/2026-09-27-crdt-rebase:context/docs/2026-09-27-architecture-decisions.md`, section "D5, D6 and D3 amendments after spike 2": the anchor record and the fuzzy acceptance rule).
- Spike 2's comment anchoring, as ported by spike 5: `git show origin/spike/2026-09-27-collab-stack:spikes/2026-09-27-collab-stack-yjs13-hocuspocus/src/rebase/comments.ts` (316 lines, uses `approx-string-match`). Copy what you need and note the origin (branch and commit `eeb3fe2`) in the README; adapt it from spike 2's schema to this editor's fragment and position mapping.
- The spike directory as briefs 01 to 05 left it: README, `web/src/main.ts`, `src/collab/` (note the three workaround plugins and their order), the e2e helpers in `e2e/gateD-collab.spec.ts` and `e2e/gateE-undo.spec.ts` (`bringToFront`, polling for the selection, `typeAndVerify`).

## Scope, in order

1. **Data model** in the same `Y.Doc`, outside the ProseMirror fragment, so comments never affect the Markdown: a `Y.Map` of threads; each thread a `Y.Map` with the anchor record from D3 as amended (start and end relative positions with assoc 0 and -1, exact quote, 32-character prefix and suffix, character offsets), a `Y.Array` of messages (id, author name, text, time), and resolved state with who and when. Concurrent replies must merge. Pure functions in `src/comments/`, unit-tested headless with two `Y.Doc`s exchanging updates.
2. **Anchoring**: resolve each unresolved thread's range from the relative positions through the binding's mapping on every document change. If the range has collapsed or cannot be resolved, try the quote-selector fuzzy match with spike 2's acceptance rule; if that fails, the thread is orphaned. Orphaned threads keep their quote.
3. **Highlights**: a decoration plugin (no marks, no schema change) that paints the resolved ranges with a soft yellow background, stronger for the active thread. Clicking inside a highlight activates its thread in the sidebar.
4. **Sidebar** to the right of the page column: threads in document order, each showing the quoted text in small grey type, the messages with author and relative time, a reply box, and a Resolve button; a composer when adding a new comment; a "Show resolved" toggle; an "Orphaned" group showing the quote and a note such as "The text this comment referred to was deleted." Adding a comment: select text, then a small floating "Comment" button next to the selection or Mod-Alt-M (Google Docs' shortcut); focus goes to the composer; Enter posts, Shift-Enter makes a new line, Escape cancels.
5. **Gate F tests**, titled `[F] ...`, two contexts (Alice and Bob), keyboard and mouse only:
   - Alice selects a phrase with Shift+Arrow and adds a comment; the highlight appears; the sidebar shows the thread with the quote; Bob sees the same thread and highlight;
   - Bob replies; Alice sees the reply; Alice resolves; the highlight disappears in both and the thread moves under "Show resolved";
   - the highlight follows the text: Bob types before the phrase in the same paragraph, inserts a new paragraph above it, and types inside the phrase; Alice's highlight covers the phrase (with Bob's insertion inside it) each time;
   - Bob deletes the paragraph holding the phrase; both see the thread as orphaned with its quote;
   - the Markdown is byte-identical before and after adding, replying and resolving;
   - a comment survives reload, and appears for a fresh third context.
6. **Unit tests** for the model, the anchor record builder, the resolution order (CRDT, fuzzy, orphaned), and the acceptance rule on a few hand cases, including one where a second location scores nearly as well and must be rejected.

Not in scope: comments spanning two blocks beyond what falls out naturally (record the behaviour), comment permissions, notifications, export to GitHub, styling of anything else.

## Definition of done, and stopping point

Stop when `npm test` passes; `npm run gates` passes F and every gate that passed before (A, B, C, D, E, G, H, I) in Chromium; the gate F file passes `--repeat-each=5`; `npx tsc --noEmit` passes; nothing listens on 4400 to 4499; work committed with explicit paths, not pushed; README updated.

## Constraints

- Work only inside `/Users/skk/code/phraise/.claude/worktrees/agent-a40b6e74050a061e9`; absolute paths. Do not launch other agents. npm, not pnpm. Tests on 127.0.0.1, ports 4400 to 4449.
- No new nodes or marks; `checkSchemaEquivalence` must keep passing. Do not edit `node_modules`.
- Do not normalize away characters or retry actions in tests to make them pass. If you retry a keyboard action, log each retry with `console.log` as the existing `typeAndVerify` helpers now do, so it stays visible.
- Log to `context/logs/2026-09-27-builder-spike-7-comments.md` at every task boundary, timestamps from `date`.

## Handback

Under 300 words: outcome and test counts; what you verified and how; how the highlight follows remote edits and where it does not; orphaning and fuzzy re-anchoring behaviour seen; paths of log and README.
