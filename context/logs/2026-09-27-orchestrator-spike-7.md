# Log: spike 7 orchestrator, web editor in a real browser

Status: done
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

## 22:22 — brief 06 verified; brief 07 written

Brief 06 (dispatch 6) handed back: gate F 6 tests, comments model in `src/comments/`, sidebar and highlight in `web/src/comments/`; 175 unit tests. My check: whole suite `--repeat-each=4`, 312/312 pass; one logged retry (`placeCaret-retry`, a click landing at offset 37 instead of 53 in gate F), a harness-level click placement, not a lost keystroke.

Wrote brief 07: the fix list (formatted copy test, keyboard selection, unlink through UI, always build on start, styling problems from my screenshots), gate K measurements with stated thresholds (first load under 5 s, p95 key-to-paint under 50 ms with the Markdown panel closed), gate J syntax-visibility check and screenshots, Firefox and WebKit as an informational second table, fresh-clone check. Dispatching (dispatch 7).

## 23:50 — brief 07 handed back early; finished cross-browser work myself; screenshots reviewed

Brief 07 (dispatch 7) handed back early, citing that it was forced to stop, with tasks 4 and 5 unfinished: the WebKit numbers, README, fresh-clone check and cleanup. Its manual server on 4490/4491 (PID 81354) was still running; I killed it and removed its temporary seeds directory. Done by the builder and committed: the fix list, gate K (first load 1.5 to 1.8 s, repeat 130 to 150 ms, p95 key-to-paint 13 to 15 ms with a second user typing, relay state 845 KB, parse and full serialize about 1.2 s each on the 245 KB file), gate J (syntax-visibility check and 10 screenshots).

Finished myself:
- Committed the builder's uncommitted cross-browser work (`scripts/gates.ts` wrapper, reporter's second table, WebKit project). Changed it: Firefox is opt-in with `PHRAISE_FIREFOX=1` because it cannot launch on this machine (the builder's diagnosis: macOS sandbox refuses Firefox's helper processes); the wrapper deletes `results/gates.json` before running so a stale file can never pass, and a gate with no tests now fails the command.
- `npm run gates`: every Chromium gate A to K PASS (A 22, B 24, C 6, D 6, E 3, F 6, G 6, H 4, I 2, J 11, K 5), exit 0.
- WebKit first run: 38 of 58 failed. Two causes, both in tests: WebKit on macOS maps Home and End to scrolling, as Safari does, so caret-placement helpers never moved; and Playwright WebKit has no clipboard permissions. Added `e2e/keys.ts` (Cmd+Left and Cmd+Right on macOS, Home and End elsewhere), used it in all 14 spec files, and skipped the two copy tests on WebKit with the reason. Then WebKit: 3 failed, 3 skipped, 52 passed; again with `--repeat-each=2`: 6 failed of 116, different tests each time, all at caret placement off by one after a click then ArrowRight presses. Every A to D scenario passed in WebKit in at least one run. Unexplained whether this is the harness or a WebKit selection-mapping issue in the editor; recorded as informational.

Looked at all 10 screenshots myself. A non-technical reader sees a clean document: headings, spaced paragraphs, shaded table header, code as grey cards, KaTeX formula, rendered Mermaid, key-value page properties, footnote as superscript and "1. text", comment thread with highlight and reply, named carets, offline status, gate H banner. Minor: the HTML preview card has empty space above its text; the Markdown panel shot is missing the network logo image; the gate H banner shows escaped Markdown (`https\://example.com?find=\\\*`), which a non-technical user will not understand.

## 00:19 — review blocker fixed; gate K long tasks measured

Review (dispatch 8, Sonnet, fresh clone from the pushed branch) found a blocker: `npm run gates` failed gate E on the clean clone, 5 of 5 in isolation. The reviewer was right, and the cause was mine: I switched every test's line keys to Cmd+Left and Cmd+Right on macOS for WebKit and only re-ran WebKit afterwards, not Chromium. In gate E's "type alternately" test, Chromium's Cmd+Right after a click left Alice's caret three characters short of the line end, deterministically (instrumented: the click left the selection at 33, Cmd+Right did not move it to 36; Bob's caret widget sat at the line end). A standalone probe of the same situation (probe server on 4490, stopped) did not reproduce it, so it is recorded as an open item, not a proven product bug. Fix: `e2e/keys.ts` now gives Home and End for Chromium, Cmd+Arrow only for WebKit on macOS. Reviewer's other results: clean-clone `npm ci`, `setup`, `test` (187), `tsc`, `npm start` all fine; vacuity proven for gates A, D, H by disabling one extension each; rules clean; minor: README origin table says `serialize.ts` is byte-identical to spike 5 but brief 03 refactored it (behaviour-preserving, adds `serializeBlock`); gate J rewrites committed screenshots every run.

After the fix: `npm run gates` exit 0, Chromium A to K all PASS; WebKit A 22/22, B 19/21 (2 skipped for clipboard), C 6/6, D 5/6. Chromium suite `--repeat-each=3`: 285/285, 2 logged caret-placement retries.

Gate K reported only the rAF measure. Added an Event Timing summary per event type to the test and `results/scale.json`: keydown p95 16 ms, max 24 ms (8 ms granularity) with a second user typing, matching rAF p95 13.7 ms. But the gate K typing never pauses, so the 250 ms debounced work never runs during it. Measured myself in the page on the 245,936-byte file (probe server 4490, stopped): full `serializeDoc` in the browser 900 to 970 ms (express README about 20 ms); with typing paused, the first edit triggers one 972 ms long task (the cold gate H check over all 1,619 blocks), later edits none; with the Markdown panel open, every pause costs a 930 ms long task. The page freezes for about a second at those moments on this file. This belongs in the findings: the per-edit path is fine in the page, whole-document serialize is not.

## 00:25 — findings written; fresh-clone check passed; handback

Wrote the findings doc (`context/docs/2026-09-27-spike-7-findings-web-editor.md`) and a "Final state" section at the top of the spike README (commands, and corrections to the builders' sections: the U+00A0 cause, line keys, visible retries, the origin of `serialize.ts`). Pushed `23d736e`.

Fresh-clone check of the pushed branch into `$TMPDIR` (script in my scratchpad): `npm ci` 0, `npm run setup` 0, `npm test` 187 passed, `tsc` 0, `npm run gates` exit 0 with Chromium A to K all PASS (WebKit informational: 5 failed, 3 skipped of 58, caret placement as before), `npm start` printed `http://127.0.0.1:4480/?doc=hello.md&user=Alice`, `curl` 200, SIGINT stopped it, nothing listening on 4400 to 4499 afterwards, no leftover server, Playwright or Vite process; clone removed.

Budget: 8 worker dispatches (7 Sonnet builders, 1 Sonnet reviewer) against about 14. Brief 07's builder handed back early; I finished its remaining tasks myself.

## Handback summary

Gate command passes (Chromium, A to K). Verdict: the vision's editing experience is within reach on this stack; shortfalls are product surface (toolbar, table rows and columns, image insertion) and whole-document serialization on large files, not architecture. Decisions S7-1 to S7-13 in the findings doc; the lead should look first at S7-2 (third Yjs workaround, upstream regression in `@tiptap/y-tiptap` 3.0.6 and later), S7-1, S7-7 and S7-11. Not verified: Firefox (does not launch here), real input methods and real displays (headless only), a lost keystroke during a remote composition seen once in 360 runs, a Chromium Cmd+Right anomaly in one scenario.
