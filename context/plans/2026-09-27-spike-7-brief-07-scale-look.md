# Brief 07: scale, the look, screenshots, other browsers, and the fix list (gates J and K)

Status: dispatched
Author: spike 7 orchestrator (Opus 5.5)
Updated: 2026-09-27
Plan: [spike 7 plan](2026-09-27-spike-7-plan.md). Charter: [spike 7 charter](2026-09-27-spike-7-charter-web-editor.md), gates J and K, and the "Deliverables".
Model: Sonnet (builder)

## Goal

Measure the editor on the 240 KB document, make the page look like a clean document to a non-technical reader, commit the screenshots the owner will judge, run the cheap gates in Firefox and WebKit, and close the orchestrator's fix list. Serves the vision's first requirement.

## Inputs

- `AGENTS.md`; the charter's "Rules for every agent in this spike" and "Constraints" (screenshots are the only binary files, each under 300 KB); the plan.
- The spike directory as briefs 01 to 06 left it: README (read its notes for this brief), `web/src/`, `playwright.config.ts`, `e2e/gateReporter.ts`, `corpus/needed.json`, `scripts/start.ts`.

## Scope, in order

1. **Fix list from the orchestrator's review of earlier briefs:**
   - Copy test: copy a selection containing bold, a link and a two-item list; assert the clipboard's `text/plain` contains the Markdown syntax (`**`, `[..](..)`, `- `) and `text/html` the tags. The current test copies plain words only.
   - Gate A "select across two paragraphs and type over the selection": select with Shift+Arrow (poll until the selection settles), not `setTextSelection`. Where other gate A and B tests set selections programmatically, switch those that a user would make with the keyboard or mouse.
   - Gate H: unlink through the UI. Mod-K on a link opens the link field with the current address and a "Remove link" button; the gate H test uses it instead of `unsetMark`.
   - `npm start` always runs the build first (it is quick), so a stale `dist/` is never served.
   - Styling, seen in the orchestrator's screenshots: consecutive paragraphs have no space between them in several places, including after source-block cards; the table header row is neither bold nor shaded; footnote definitions and link reference definitions show their Markdown source in monospace in normal view (render them as "1. The footnote text" and "reference link: https://…"); a footnote reference renders as a chip saying "FOOTNOTE REF" (render a superscript number); front matter shows `---` delimiters (render key-value rows); badge images from the network show as broken, find out whether the service worker, the headless browser or the network is the cause.
2. **Gate K, scale**, tests titled `[K] ...`, on `corpus/fetched/nodejs-node-docapinapimd.md` (245,936 bytes). Measure and report, writing the numbers to `results/scale.json` and printing them:
   - load: from navigation start to the editor showing the document's last block, first visit (seeded from the relay) and repeat visit (IndexedDB), and the size of the relay's Yjs state;
   - key press to paint, at p50, p95 and max, for 200 characters typed by Alice in the middle of the document while Bob types continuously into another paragraph 50 blocks away and into Alice's paragraph. Use the Event Timing API (`PerformanceObserver` with type `event`, `durationThreshold: 16`, plus `first-input`) for keydown and input durations, and cross-check with a `requestAnimationFrame` measurement taken from the keydown handler; say which you report. Measure with the Markdown panel closed and open;
   - in-page costs: `parseMarkdown` of the whole file, full `serializeDoc`, the gate H per-block check after one edit (cold and warm), and the comment re-anchoring pass with 20 comments;
   - the same key-to-paint measurement on a small README for comparison;
   - pass criteria for the gate: load under 5 s first visit, p95 key-to-paint under 50 ms with the panel closed. Report the numbers whatever the outcome; do not tune the test to pass. If a threshold fails, find the main cost with a Chromium trace or `performance.now()` spans and write it in the log.
3. **Gate J, feel**, tests titled `[J] ...`:
   - an automated check that in normal editing no Markdown syntax is visible: on the express README and on a design doc, the rendered editor text outside code blocks and outside a source block's open source editor contains no `**`, `__`, backtick, `](`, `![`, a line starting with `#` followed by a space, or `[^`;
   - screenshots into `spikes/2026-09-27-web-editor-tiptap/screenshots/`, PNG, 1280 by 800 viewport, device scale 1, each under 300 KB (assert it): the express README top; a design doc with a table and a code block (add a design doc from `corpus/manifest.json` with at least one GFM table and one fenced code block to `corpus/needed.json`; `kubernetes-enhancements-kepssigapps4017podindexlabelreadmemd` or similar, check it has both); a comment thread with a reply, two users; two named cursors in one paragraph; a source block (front matter or HTML) with its preview and one with its source editor open; a rendered Mermaid diagram; the unverifiable-block banner; the offline status; the Markdown panel open beside the document. Use real content, not lorem ipsum. Screenshots are regenerated by `npm run gates`; commit them.
4. **Firefox and WebKit** where cheap: add `firefox` and `webkit` projects that run gates A, B and C (and D if it works without change). The reporter prints a second table, cross-browser results by gate and browser, marked informational; the gate verdict and the exit code stay on Chromium. Record every scenario that fails in another browser and why, without special-casing tests to hide it.
5. **Final commands**: `npm run gates` builds, runs everything, prints both tables, writes `results/gates.md` and `results/gates.json`, and exits non-zero if any Chromium gate fails. Check `npm ci && npm run setup && npm test && npm run gates` from a fresh clone of the branch into `$TMPDIR` (clone from the local worktree path), and `npm start` there, then delete the clone.

Not in scope: new features beyond the fix list, a design system.

## Definition of done, and stopping point

Stop when `npm test` passes; `npm run gates` passes every Chromium gate A to K, or a gate fails for a measured reason you could not fix, recorded in your log with the numbers; the screenshots are committed and each is under 300 KB; the fresh-clone check passed; `npx tsc --noEmit` passes; nothing listens on 4400 to 4499; work committed with explicit paths, not pushed; README updated with the final commands and the scale numbers.

## Constraints

- Work only inside `/Users/skk/code/phraise/.claude/worktrees/agent-a40b6e74050a061e9`; absolute paths. Do not launch other agents. npm, not pnpm. Tests on 127.0.0.1, ports 4400 to 4449.
- No new nodes or marks. Do not edit `node_modules`. Do not normalize away characters or hide retries in tests; log any retry with `console.log` as the existing helpers do.
- Log to `context/logs/2026-09-27-builder-spike-7-scale-look.md` at every task boundary, timestamps from `date`.

## Handback

Under 300 words: the scale numbers; gate J result and the screenshot list with sizes; cross-browser results; what from the fix list was done; the fresh-clone check result; paths of log and README.
