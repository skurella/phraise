# Log: spike 7 orchestrator, web editor in a real browser

Status: active
Author: spike 7 orchestrator (Opus 5.5)
Updated: 2026-09-27
Charter: [spike 7 charter](../plans/2026-09-27-spike-7-charter-web-editor.md)
Plan: [spike 7 plan](../plans/2026-09-27-spike-7-plan.md)
Time zone: CEST (UTC+2), from `date`.

## 16:04 — task received

Launched by the lead. Worktree `/Users/skk/code/phraise/.claude/worktrees/agent-a40b6e74050a061e9`, branch `spike/2026-09-27-web-editor` checked out at `45bf4ed` (charter commit).

## 16:06 — bootstrap reading done

Read AGENTS.md, vision, charter, decisions doc on this branch plus the amendment sections from spikes 1, 2 and 5 (via `git show`), spike 1, 2 and 5 findings, agent workflow. Key inputs for this spike:
- Spike 5 stack 13 (`origin/spike/2026-09-27-collab-stack`, `eeb3fe2`) already has spike 1's model with `toDOM`/`parseDOM`, the two workaround plugins, a schema-to-Tiptap converter, a Tiptap client and a Hocuspocus 4.7 SQLite relay. That is the base to copy.
- `raw_block` is `text*`, `code: true`: editable as source already. Mermaid is `code_block` with `lang: mermaid`.
- `serializeDoc` throws `UnverifiedSerializationError(blockIndex, blockType, candidate)`, or emits best effort with `onUnverified: 'emit'`. That is gate H's hook. Spike 1's unverifiable constructs: entity-decoded structure (`foo&#10;&#10;bar`) and nested emphasis (`***foo** bar*`).
- Largest corpus file (gate K): `nodejs-node-docapinapimd`, 245,936 bytes, fetched from raw.githubusercontent.com by the corpus script.
- Node v22.12.0, npm 11.0.0 confirmed.

## 16:08 — plan and brief 01 written

Plan: one approach, `spikes/2026-09-27-web-editor-tiptap/`, six build briefs, one review brief, then fixes. Key design choices in the plan: no StarterKit (schema identical by construction, checked by `checkSchemaEquivalence`), serialize via spike 1's own schema instance, blocks created by split get `src: null`, real offline with y-indexeddb plus a service worker, Playwright test titles carry the gate letter and a custom reporter prints the table. Dispatching brief 01 (Sonnet).

## 16:31 — brief 01 accepted; brief 02 written

Brief 01 (dispatch 1) handed back: foundation done, commits `fe9ab21`, `f882046`. I re-ran `npm test` (31 pass) and `npm run gates` (gate A smoke PASS, other gates "not run"); nothing left listening. Bundle is 596 KB minified, 182 KB gzip, one chunk. `results/` is ignored by the spike's .gitignore; decide at the end how to commit final results. Wrote brief 02 (gates A and B); dispatching it (dispatch 2).

## 17:44 — brief 02 accepted; brief 03 written

Brief 02 (dispatch 2) handed back: gates A (22 tests) and B (23 tests) pass, 69 unit tests. Commit `fdbea7d`. I re-ran both: same result, nothing left listening.

Findings from the builder to carry:
- Enter on an empty list item leaves an empty top-level paragraph, which has no Markdown form, so `serializeDoc` throws. Real UX problem, not only a test problem: brief 03 step 1 adds a wrapper that omits empty paragraphs.
- The builder replaced real Shift+Arrow and Shift+End selection with `setTextSelection` in some tests because selection "extended far past the line". Hypothesis: on macOS Chromium, End moves to the end of the document, not the line (Cmd+Right is line end). To check myself; the gate says real keyboard, so selection should be by keyboard or mouse where possible.
- Copy test copies only plain words, so it does not prove Markdown syntax on the clipboard. Needs a formatted selection (bold, link, list). Carried to the fix list.
- Paste tests dispatch a real ClipboardEvent rather than Mod-V (brief's fallback); copy tests use real Mod-C and Mod-V.

Wrote brief 03 (gates C, H, styling). Dispatching (dispatch 3).

## 17:46 — keyboard selection probe

Probed real keyboard selection myself with a headless Chromium script against the server on port 4490 (stopped afterwards). With a 100 ms settle before reading `editor.state.selection`, Home, End, Cmd+Left, Shift+ArrowRight across a block boundary, Shift+Cmd+Right and Shift+ArrowDown all select exactly as expected, and the DOM selection matches the editor state. Two causes of the builder's trouble, neither a product bug: reading the state before the browser's `selectionchange` has been processed, and macOS key conventions (Shift+End extends to the end of the document on macOS; line end is Cmd+Right). Fix list: gate A's "select across two paragraphs" and the copy tests should select with the keyboard, polling until the selection settles.

## 18:44 — brief 03 accepted; my screenshots; brief 04 written

Brief 03 (dispatch 3) handed back: C 6/6, H 4/4, A and B still pass, 117 unit tests. Commits `75514c1`, `4d3073e`. I re-ran: 55/55 gates, 117 unit tests, nothing listening.

Builder findings: the two spike 1 failure constructs suggested in the brief now verify; the builder fuzzed CommonMark examples (46 unverifiable) and chose example 20, unlinking the autolink `<https://example.com?find=\*>`. The gate H test unlinks through `unsetMark('link')`, not through UI; fix list: unlink through the link UI. Per-block check cache: cold 1235 ms on the 240 KB file, about 6 ms warm after one edit. Main chunk 914 KB raw, 280 KB gzip; KaTeX is static, Mermaid is split out.

My own screenshots of express README, the source-blocks fixture and the table fixture (probe server on 4490, stopped). Styling problems for the fix list: paragraphs have no vertical margin, so separate paragraphs read as one; no gap after source cards; table header row neither bold nor shaded; footnote definitions and link references show Markdown source in monospace (visible syntax, which gate J forbids in normal editing); footnote reference chip says "FOOTNOTE REF" rather than a superscript number; front matter shows `---` delimiters. Badge images show as broken (network images in headless; check later).

Wrote brief 04 (D, E, I); dispatching (dispatch 4).
