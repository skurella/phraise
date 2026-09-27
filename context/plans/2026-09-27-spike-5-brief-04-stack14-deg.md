# Brief 04: stack 14 on Hocuspocus, gates B3, G, E, D

Status: dispatched
Author: spike 5 orchestrator (Opus 5.5)
Updated: 2026-09-27
Plan: [spike 5 plan](2026-09-27-spike-5-plan.md). Charter: [spike 5 charter](2026-09-27-spike-5-charter-collab-stack.md), "Rules for every agent in this spike" binds you.
Model: Sonnet, builder. Serves D5.

## Goal

Move the stack 14 package onto Hocuspocus 4.7 (the orchestrator showed it works once `yjs` and `lib0` are deduplicated), then answer gates B3, G, E (with Yjs 14's own attribution machinery and suggestion mode) and D (Tiptap 3) for stack 14, mirroring stack 13 so the two are directly comparable.

## Starting points

- Stack 14: `/Users/skk/code/phraise/.claude/worktrees/agent-a9ca7fc64553beeea/spikes/2026-09-27-collab-stack-yjs14-rc/`. Read its README, `src/`, `gates/`, the previous builder's log `context/logs/2026-09-27-builder-spike-5-stack14-core.md`, and the orchestrator's evidence `scratch/hocuspocus-dedupe-smoke.ts` and `scratch/hocuspocus-dedupe-package.json.txt`, and `scratch/probe-atom-mark-change.ts`.
- Stack 13, finished, all gates pass: `/Users/skk/code/phraise/.claude/worktrees/agent-a9ca7fc64553beeea/spikes/2026-09-27-collab-stack-yjs13-hocuspocus/`. Its gates B3, D, E, G (`gates/`, `src/attribution.ts`, the Tiptap schema converter) are your templates. **Copy**, never import across directories.
- Yjs 14 attribution references, downloaded from GitHub (read-only), in `/private/tmp/claude-501/-Users-skk-Library-Application-Support-Claude-scratch-workspaces-92acd837-26ab-4632-a512-01d178a06808-3d728634-4a64-405d-b4d8-e171544ef5b7-scratch-2026-09-26-c82a4d/8ff8ca9f-bda4-46ee-967d-cafcb461e5a1/scratchpad/ref/`: `yjs-attributing.md` (yjs repo, `IdSet`, `IdMap`, `createContentAttribute`), `yp-ATTRIBUTION.md` and `yp-CAVEATS.md` (y-prosemirror repo, suggestion mode and schema hardening), and `yhub-tiptap-demo/` (the upstream Tiptap 3 demo: `main.js` shows suggestion mode as a second `Y.Doc` named `<doc>--suggestions` with `Y.createDiffRenderer(ydoc, suggestionDoc, { attributions: Y.createContentMap() })` and `configureYProsemirror({ ytype, renderer })`; `extensions.js` shows how it wires `@y/prosemirror` into Tiptap; `schema.js` shows a hardened schema). Note that names in the docs may lag the rc.26 exports; trust the installed package.

## Ordered tasks

Stopping point: task 7 done.

1. **Hocuspocus relay.** Make Hocuspocus 4.7 server and provider the stack 14 relay: npm `overrides` with `"lib0": "$lib0"` plus the existing `yjs`/`y-protocols` aliases, and an install step (a `postinstall` script) that replaces `node_modules/yjs` and `node_modules/y-protocols` with symlinks to `@y/y` and `@y/protocols`, then asserts that `(await import('yjs')).Doc === (await import('@y/y')).Doc`. It must work from `npm ci`. Same relay CLI, SQLite persistence, `onAuthenticate`, `/state` route and seeding as stack 13. Keep the custom relay as an alternative behind a flag (for example `--relay custom`) and run gate A on both. Re-run A, B, C on Hocuspocus and report any difference from the custom relay.
2. **Gate B3**, as stack 13 did it from `scratch/probe-atom-mark-change.ts`. Expected: cases 4 and 5 fail (a replace that changes an inline atom's attrs and its marks keeps the old mark). Report it as FAIL with the detail; do not work around it. Point at the responsible code in `@y/prosemirror` if you can find it cheaply.
3. **Gate G**, the same four scenarios and checks as stack 13 (G1 SIGTERM restart, G2 SIGKILL before and after the store debounce, G3 edits while the relay is down, G4 offline editor with overlapping edits and link-on-image edits on both sides).
4. **Gate E, attribution.** Two parts.
   a. The same server-side mapping as stack 13 (user from `onAuthenticate`, client IDs and clock ranges from each incoming update, recorded with receive time, persisted, collision flagged), ported to `@y/y`. Where `@y/y` offers a native structure for this (an `IdMap`/`ContentMap` of `createContentAttribute('insert', user)` and similar, built from each update's content ids), use it instead of a hand-rolled map, persist it, and say which you used and why. Same listing (ranges with user, time, text), same reconnect, reload and restart checks.
   b. **Suggestion mode.** Following the upstream demo: alice edits the live document; bob works in suggestion mode on the suggestion document through a `DiffRenderer`: he inserts text, deletes a word and adds a link to an image. Alice's view of the suggestions shows `y-attributed-*` marks with bob as author. Accept one suggestion and reject another with `@y/prosemirror`'s accept/reject API; check the live document, the relay's stored live document and the serialized Markdown afterwards. Report exactly what hardening spike 1's schema needed (the four marks, `marks` expressions, variants), whether the attributed marks can leak into serialization, and whether suggestion mode is usable for Phraise. If it cannot be made to work, stop at a clear account of why after two genuinely different attempts.
5. **Gate D, Tiptap 3.** Tiptap 3.31.3 core (`@tiptap/core`, `@tiptap/pm`, exact same version) with **custom** extensions wrapping `syncPlugin`, `yCursorPlugin` and `yUndoPlugin` from `@y/prosemirror` (Tiptap's own Collaboration extensions require Yjs 13; check npm for any Tiptap package that supports Yjs 14 and say what you found). Same checks as stack 13's gate D: single prosemirror instance, schema equivalence via the generic converter, gate B's script through two Tiptap editors converging, carets both ways, undo isolation. List what had to be written in place of Tiptap's extensions, with line counts.
6. **Gate C addition**: confirm the encoded state size on Hocuspocus (18.70 MB on the custom relay).
7. **Runner and README.** Rows B3, D, E, G in `npm run gates`; `gates:quick` includes short versions. README: relay decision and the dedupe step, results, attribution design, suggestion-mode findings, constraints.

## Definition of done

`npm ci && npm run gates:quick` passes except rows that fail for a documented upstream reason (B3; anything in E or D you could not make work, with its account); `npx tsc --noEmit` clean; `npm run gates` documented. After every run `lsof -nP -iTCP:4240-4269 -sTCP:LISTEN` is empty.

## Constraints

- Working directory `/Users/skk/code/phraise/.claude/worktrees/agent-a9ca7fc64553beeea`, absolute paths. Ports 4240 to 4269 on 127.0.0.1.
- Touch only the stack 14 directory and your own log. Commit with explicit paths, no push. Do not launch further agents.
- Log: `context/logs/2026-09-27-builder-spike-5-stack14-deg.md`, timestamps from `date` only.

## Handback, under 300 words

Per gate: pass or fail with numbers; Hocuspocus versus custom relay; attribution design; suggestion-mode verdict and hardening cost; what replaced Tiptap's extensions; failures and skips with reasons; commits; no relay running.
