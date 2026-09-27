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

## 19:34 — brief 04 verified: flaky E and I, binding caret bug; brief 05 written

Brief 04 (dispatch 4) handed back: D 4/4, E 3/3, I 1/1, 138 unit tests, all passing in the builder's runs.

My verification: one full gate run failed gate E once. The whole suite with `--repeat-each=3`: 5 failures in 189 (gate E "type alternately into the same paragraph" and gate I). E and I alone, `--repeat-each=6 --workers=4`: 1 E failure and 6 I failures.

Root causes found:
1. **Binding bug, confirmed by my probe on port 4490 (stopped):** Bob's caret at the end of a paragraph; Alice types `AAA ` at its start; Bob's selection stays at the same absolute position and his next letter lands inside a word ("First paragraph hBere"). Brief 04's builder saw this as "an idle remote user's selection is not remapped" and redesigned the test around it. Cause in `@tiptap/y-tiptap` 3.0.9: `restoreRelativeSelection` resolves Yjs relative positions correctly, then `recoverSelectionEndpoint` / `isMisresolvedAfterStructuralChange` treats any change to the paragraph's text as a misresolution and restores the old in-block offset. Packed 3.0.3 to 3.0.9 to compare: the text check appears in 3.0.6 and the recovery in 3.0.7; 3.0.5 has neither. This would put a collaborator's typing in the wrong place whenever two people type in one paragraph, which is gate G's scenario.
2. **Gate I:** after typing offline and closing the page at once, the reopened page lacks the tail of the typing (`EDIT-A EDIT-` for `EDIT-A EDIT-C`): the last keystrokes had not reached IndexedDB. A real local-loss window when a user closes the tab right after typing.

Wrote brief 05 (caret workaround plugin or pin 3.0.5, E and I flakes, local-save status and beforeunload, gate G IME through CDP, flake sweep). Dispatching (dispatch 5). Comments move to brief 06; scale, screenshots, styling and other browsers to brief 07.

## 21:36 — brief 05 verified; NBSP root cause fixed myself

Brief 05 (dispatch 5) handed back: caret workaround plugin `src/collab/workarounds/localCaretFollow.ts` (third workaround; verified as a true positive by disabling it), gate G 6 IME scenarios all passing, gate I waits for the local-save status, close-at-once measurement 21 of 100 full survival (all or nothing). Gates 72/72.

Two things in the handback I did not accept as stated:
1. **U+00A0 for typed spaces.** The builder normalized NBSP away in the E, G and I tests, calling it a Chromium quirk under load. Cause is ours: the page built Tiptap with `injectCSS: false` and our stylesheet never set `white-space: pre-wrap` on the editable, which ProseMirror requires; without it Chromium inserts U+00A0 for a trailing typed space, and it reaches the Markdown file. A real user who pauses after a space would hit it. Fixed myself: `injectCSS: true` in `web/src/main.ts`, and removed the normalization from the three test files so a stray U+00A0 now fails the gates.
2. **`typeAndVerify` retries** hide dropped keystrokes if the editor ever drops them. I instrumented each retry to print a line. Whole suite `--repeat-each=5`: 360/360 pass with the CSS fix and no normalization; one retry in 360 tests, in gate G, when Bob typed `BEFORE-` at the start of a paragraph while Alice had an active composition: nothing landed within 2 s, and the retype did. Unexplained; recorded as an open risk (a keystroke may be lost while a remote composition is in progress), not proven either way.

`npm test` 148 pass, `tsc` clean, ports clean.
