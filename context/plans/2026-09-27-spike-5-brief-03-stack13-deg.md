# Brief 03: stack 13 gates G, E, D (persistence, attribution, Tiptap)

Status: dispatched
Author: spike 5 orchestrator (Opus 5.5)
Updated: 2026-09-27
Plan: [spike 5 plan](2026-09-27-spike-5-plan.md). Charter: [spike 5 charter](2026-09-27-spike-5-charter-collab-stack.md), "Rules for every agent in this spike" binds you.
Model: Sonnet, builder. Serves D5, and the attribution part of D5 ("record the Yjs client ID to user and timestamp mapping at the server's authentication hook from day one").

## Goal

Extend the verified stack 13 package with gates G (persistence and reconnect), E (attribution) and D (Tiptap 3 with its collaboration and caret extensions), and fold an existing probe into gate B. Same package, same harness, same relay child process.

## Starting point

`/Users/skk/code/phraise/.claude/worktrees/agent-a9ca7fc64553beeea/spikes/2026-09-27-collab-stack-yjs13-hocuspocus/`. Read its README, `src/relay.ts`, `src/client.ts`, `src/harness.ts`, `src/workarounds/`, `gates/`, `scripts/gates.ts`, and `scratch/probe-atom-mark-change.ts` (an orchestrator probe). Gates A, B, C pass (C 266/266 on both paths after an orchestrator fix to `rootAttrs.ts`; the README still says 265/266, correct it).

## Ordered tasks

Stopping point: task 6 done.

1. **Gate B3.** Turn `scratch/probe-atom-mark-change.ts` into a gate row "B3. Inline atom link edits" run by `scripts/gates.ts`: five cases (change the href of a linked image; unlink it; whole-document replace where the image's url and href change; replace one image node with one whose url and link differ; plus the initial state), through the live binding with the workaround plugins, checked in both editors. Pass means every case shows the new value in both editors. Keep the scratch file.
2. **Gate G, persistence and reconnect.** Scenarios, each with the equality check from the plan:
   - G1 restart: two editors make edits; wait for the relay to store (Hocuspocus debounces stores; find its setting and state it); stop the relay with SIGTERM; start a new relay process on the same port and database; both providers reconnect by themselves; the content is intact; a new edit propagates.
   - G2 hard kill: same with SIGKILL, once right after edits (before the store debounce) and once after it. Report what, if anything, is lost on the relay and whether the clients restore it on reconnect (they hold the full state and sync it back).
   - G3 edits while the relay is down: both editors edit while no relay runs; start the relay; everything converges.
   - G4 offline editor: editor 2 disconnects its provider; both editors edit, including overlapping edits to the same paragraph and a link added to an image by each side; editor 2 reconnects; both editors and the relay converge; nothing is lost except what CRDT semantics define (say what).
3. **Gate E, attribution.** Design and implement, then measure:
   - Where the mapping is kept: at authentication the relay knows the user (token). In `onChange` (or the hook that sees each incoming update and its connection context) decode the update's structs and record, for each client ID, the user, and for each clock range, the server receive time. Persist this so it survives relay restarts; choose between a Y.Map inside the document (replicates to clients, persists with the doc) and a relay-side table (SQLite), justify the choice, and measure its size.
   - Reject or flag a client ID already mapped to a different user (a forged or colliding ID); test it.
   - Listing: for a document edited by alice and bob (plus the seed), list visible ranges with user, time and text, by walking the Yjs items.
   - Reconnects: a provider reconnect keeps the same `Y.Doc` and client ID; a page reload is a new `Y.Doc` and a new client ID mapped to the same user. Test both, and a relay restart between edits (the mapping must survive it).
4. **Gate D, Tiptap 3.** Tiptap 3.31.3 (`@tiptap/core`, `@tiptap/extension-collaboration`, `@tiptap/extension-collaboration-caret`, `@tiptap/pm`, all the same exact version) with `@tiptap/y-tiptap` 3.0.9 and `HocuspocusProvider`. Build Tiptap node and mark extensions from spike 1's schema with a generic converter (name, content, group, inline, atom, attrs, marks, parseDOM, toDOM), so Tiptap's generated schema is equivalent to `src/schema.ts` (check equality of node and mark specs). Wrap the two workaround plugins in a Tiptap `Extension`. Watch for two copies of `prosemirror-model` or `prosemirror-state` (Tiptap requires a single instance; check `npm ls prosemirror-model` and dedupe). Then: two Tiptap editors run the gate B script and converge by the plan's equality check; each sees the other's caret (awareness state present and the caret decoration rendered in the DOM); undo in one editor undoes only its own change. Report anything that had to be replaced by custom extensions.
5. **Gate C addition.** Report the encoded Yjs state size summed over the corpus for path A (stack 14 reports 18.70 MB, same measure: `encodeStateAsUpdate` bytes).
6. **Runner and README.** Rows B3, D, E, G in `npm run gates`; `gates:quick` includes B3 and a short version of D, E and G. README updated with results, the attribution design and its storage cost, and every constraint found.

## Definition of done

`npm ci && npm run gates:quick` passes; `npx tsc --noEmit` clean; `npm run gates` documented (the orchestrator runs it). After every run `lsof -nP -iTCP:4210-4239 -sTCP:LISTEN` is empty.

## Constraints

- Working directory `/Users/skk/code/phraise/.claude/worktrees/agent-a9ca7fc64553beeea`, absolute paths. Ports 4210 to 4239 on 127.0.0.1.
- Touch only the stack 13 directory and your own log. Commit with explicit paths, no push. Do not launch further agents.
- Log: `context/logs/2026-09-27-builder-spike-5-stack13-deg.md`, timestamps from `date` only.

## Handback, under 300 words

Per gate: pass or fail with numbers; the attribution design and where the mapping lives; what Tiptap needed replaced; anything that failed or was skipped and why; commits; no relay running.
