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
