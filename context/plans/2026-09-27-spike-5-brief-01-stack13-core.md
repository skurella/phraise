# Brief 01: stack 13 foundation, gates A, B, C

Status: done
Author: spike 5 orchestrator (Opus 5.5)
Updated: 2026-09-27
Plan: [spike 5 plan](2026-09-27-spike-5-plan.md) (read the "Choices" and "Common gate harness" sections; they are part of this brief)
Charter: [spike 5 charter](2026-09-27-spike-5-charter-collab-stack.md), section "Rules for every agent in this spike" binds you.
Model: Sonnet, builder. Serves D5.

## Goal

Build the stack 13 package: Yjs 13.6.33, `@tiptap/y-tiptap` 3.0.9 as the ProseMirror binding, Hocuspocus 4.7 as the relay with SQLite persistence, two live ProseMirror editors under jsdom, and spike 1's schema, parser and serializer. Answer gates A, B and C of the charter for this stack, with both Yjs 13 workarounds implemented for live editing.

## Directory

`spikes/2026-09-27-collab-stack-yjs13-hocuspocus/` (create it). Self-contained: its own `package.json`, `package-lock.json`, `tsconfig.json`, `.gitignore` (at least `node_modules/`, `corpus/fetched/`, `data/`, `results/*.sqlite`), README.

## Inputs

- Spike 1 code, already extracted for you (read-only reference, do not edit there): `/private/tmp/claude-501/-Users-skk-Library-Application-Support-Claude-scratch-workspaces-92acd837-26ab-4632-a512-01d178a06808-3d728634-4a64-405d-b4d8-e171544ef5b7-scratch-2026-09-26-c82a4d/8ff8ca9f-bda4-46ee-967d-cafcb461e5a1/scratchpad/ref/spikes/2026-09-27-markdown-core-remark-splice/`. Origin: branch `spike/2026-09-27-markdown-round-trip`, commit `1e1f4a6`. Read its `README.md`, `src/schema.ts`, `src/yjs.ts` (the header comment explains both losses and the `leafMarks` idea), and skim `src/index.ts` for the public API.
- Spike 2's binding probe test for how a live `ySyncPlugin` editor is set up under jsdom: same scratch dir, `ref/spikes/2026-09-27-crdt-rebase-binding-probe/test/y-prosemirror.spec.ts`.

## Ordered tasks

Stopping point: task 7 done, or a blocker you cannot get past after two genuinely different attempts (log both and hand back).

1. **Scaffold and copy.** Copy spike 1's `src/*.ts`, `scripts/fetch-corpus.mjs`, `corpus/manifest.json`, `corpus/specs.json` and `corpus/handwritten/` into the new directory, same relative paths. Replace spike 1's `yjs` / `y-prosemirror` dependencies with `yjs@13.6.33` and `@tiptap/y-tiptap@3.0.9` and adjust `src/yjs.ts` imports accordingly. Add `@hocuspocus/server@4.7.0`, `@hocuspocus/provider@4.7.0`, `@hocuspocus/extension-sqlite` (matching 4.x version), `ws`, `prosemirror-view`, `prosemirror-commands`, `global-jsdom` and `jsdom`, `vitest`, `tsx`, `typescript`. Pin exact versions. `npm install`, then `npm run fetch` to fetch the corpus. Verify spike 1's no-edit round trip still holds on the copied code for the real corpus files (a small script or test; report the count).
2. **Relay** `src/relay.ts`: a Hocuspocus server started as a child process, `tsx src/relay.ts --port <n> --db <path> --seeds <dir>`, bound to 127.0.0.1 only. SQLite persistence. `onLoadDocument`: if nothing is persisted for a document name `file:<relpath>`, seed it from `<seeds>/<relpath>` with spike 1's `parse` and the codec in `src/yjs.ts` (root attrs to the `phraise-doc` map, leaf marks to `leafMarks`); for a name `plain:<relpath>`, seed with plain `prosemirrorToYXmlFragment` and no codec (negative control). `onAuthenticate`: accept a token and put `{ user: token }` into the context; brief 03 builds attribution on this. An HTTP route on the same port, `GET /state/<docName>`, returns `Y.encodeStateAsUpdate` of the relay's in-memory document, so gates can inspect the relay's stored document. Print a ready line on stdout. A harness helper `startRelay()` / `stopRelay()` spawns and kills it and must kill it on every exit path.
3. **Live client** `src/client.ts`: creates a `Y.Doc`, a `HocuspocusProvider` over `ws` to the relay, and a ProseMirror `EditorView` under jsdom with `ySyncPlugin` from `@tiptap/y-tiptap` on the `prosemirror` fragment, plus (option) the two workaround plugins. Helpers: wait until synced, wait until two clients and the relay are equal, destroy.
4. **Workarounds** `src/workarounds/rootAttrs.ts` and `src/workarounds/leafMarks.ts`, as described in the plan's Choices table. Root attrs: local `doc.attrs` changes (`setDocAttribute`) go to the `phraise-doc` Y.Map; remote map changes and the initial load set `doc.attrs`. Leaf marks: `appendTransaction` keeps `leafMarks` equal to the JSON of the leaf's marks for local changes; for transactions that come from the sync plugin (remote changes and the initial render) it restores marks from `leafMarks`. Guard against update loops and count them: after a settled gate B run, the number of Yjs updates must stop growing. Record lines of code of each workaround and every constraint it puts on the schema.
5. **Gate A:** two editors connected to one relay type into different paragraphs and each sees the other's text; report round-trip latency (median of 20 single-character edits).
6. **Gate B:** the scripted edit sequence in the plan, on `fixtures/live.md` (write this fixture as the plan describes). Pass means editor 1, editor 2 and the relay's `/state` document are equal by the plan's equality check, including `doc.attrs` and the link mark on every linked image, and serialization succeeds and matches. Run the same script on the `plain:` document with no workaround plugins; it must detect the loss (report what was lost). Use `view.pasteHTML` for paste, `prosemirror-commands` `splitBlock` and `joinBackward` for split and join, and `insertText` transactions one character at a time for typing.
7. **Gate C:** the plan's gate C, two paths: (a) server-seeded through the codec, read by a live editor; (b) loaded client-side into editor 1 through a transaction that replaces the document and sets its attrs, so the live `ySyncPlugin` path writes the Yjs doc; read by editor 2 and the relay. For each path report files byte-identical out of N (at least 50 real corpus files; use all real fetched files if the run stays under a few minutes, and say how long it took). List every failure with its cause.
8. **Gate runner** `scripts/gates.ts`: `npm run gates` runs A, B, C and prints the table (leave rows D to H as "not run" for later briefs), writes `results/gates.md` and `results/gates.json`; `npm run gates:quick` runs A, B and C on 5 files. README with goal, status, origin of copied code (branch and commit), how to run, and the workaround costs.

## Definition of done

`npm ci && npm run fetch && npm run gates:quick` passes from the spike directory; `npm run gates` is documented (the orchestrator runs the full version). `npx tsc --noEmit` is clean. No relay process is left running after any command, including a failing one: check with `lsof -nP -iTCP:4210-4239 -sTCP:LISTEN` and say so in your handback.

## Constraints

- Working directory: `/Users/skk/code/phraise/.claude/worktrees/agent-a9ca7fc64553beeea`. Use absolute paths everywhere.
- Ports 4210 to 4239 only, 127.0.0.1 only.
- Commit your work to the current branch with explicit paths (never `git add -A` or `.`, never `node_modules` or fetched corpus). Do not push.
- Do not launch further agents.
- Log to `context/logs/2026-09-27-builder-spike-5-stack13-core.md`, timestamps from `date` only.

## Handback, under 300 words

Outcome per task; gate A, B, C numbers; workaround costs in lines and schema constraints; what failed or was skipped and why; commit hashes; confirmation that no relay process is running.
