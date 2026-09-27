# Brief 04: relay, live editor client, gates A to E and the gate runner

Status: dispatched
Author: spike 6 orchestrator (Opus 5.5)
Updated: 2026-09-27
Plan: [spike 6 plan](2026-09-27-spike-6-plan.md), sections 5, 6 and 9 are the spec.
Charter: [spike 6 charter](2026-09-27-spike-6-charter-integration-engine.md): read "Milestone 1" gates A to E and "Rules for every agent in this spike", which binds you.

## Goal

Build `src/relay/` (Hocuspocus 4.7 with SQLite, as a library plus a CLI), the jsdom live editor client in `src/testkit/`, and gates A to E with the gate runner, so that milestone 1 of the charter can be judged: open, edit with attribution and forged-identity rejection, comments, drafts with lease and restore, commit with trailers and confined diffs.

## Inputs to read

- `AGENTS.md`, this brief, plan sections 4, 5, 6 and 9, the charter's milestone 1 table.
- The package `spikes/2026-09-27-integration-engine/`: `README.md`, module READMEs, `src/engine/index.ts`, `src/crdt/index.ts`, `src/git/index.ts`, `src/testkit/`.
- Source to port (under `$REF`, plan section 1): `2026-09-27-collab-stack-yjs13-hocuspocus/src/relay.ts`, `src/harness.ts`, `src/client.ts`, `gates/lib/edits.ts`, `gates/gateA.ts`, `gates/gateE.ts` (forgery test technique, see its README section "Attribution design"); `2026-09-27-markdown-core-remark-splice/gates/lib/diffHunks.ts`, `topSpans.ts`, `words.ts`, `prng.ts` (for gate E's containment check).

## Design points fixed by the orchestrator

- The relay calls only `engine`, `git` and the opaque `crdt` handles; it never calls Yjs APIs (the boundary test must extend to `src/relay`: it may import `@hocuspocus/server`, `@hocuspocus/extension-sqlite`, but not `yjs`, `y-protocols`, `lib0`). If you need a Yjs-level operation, add it to `src/crdt` with a narrow function.
- Document name `<branch>:g<generation>:<path>` (generation 0 for now). `GET /resolve?branch=&path=`.
- Seeding on first open: `engine.seedFromCommit` from the branch head, deterministic.
- **Forged identity rejection** (plan section 6): before Hocuspocus applies an incoming update message, decode its client ids with `crdt.inspectUpdate`; a client id already mapped to another user, or any seed, git, import or generation peer id registered in `phraise-authors`, is a forgery: drop the message (not applied, not broadcast), close that connection, and count it. Unmapped ids are mapped to the connection's user. Find the right Hocuspocus 4.7 hook by reading `node_modules/@hocuspocus/server` source, and note in the relay README which hook and why. Treat sync step 2 per the plan: other users' ids already known to the relay are accepted from a sync step 2 without re-attribution; document this residual.
- Attribution: the relay records ranges per update (`crdt.recordAttribution`) and marks `editorsSinceCommit` for users whose updates changed document content (not comment-only or ack-only updates).
- Integration: the relay attaches `engine.attachIntegration` to each document it loads; editors attach it with their provider as the remote origin.
- Per-document operation queue on the relay: flush, commit, and (next brief) rebase are serialized per document.
- **Drafts:** flusher per branch with trailing debounce and maximum interval (options; gates use small values) plus `POST /flush`. The draft holds every open document of the branch (Markdown at its path, `.ydoc` and `.json` sidecar per plan section 5) and carries over draft files of documents not currently open from the previous draft. On a lease rejection: fetch, and if the remote draft's sidecar for a document has the same docId and generation, apply its CRDT state to the live document (a CRDT merge of the other writer's state), then retry once with the new expected value; otherwise report a conflict and do not overwrite. Count and expose both outcomes.
- **Restore:** a document with no SQLite state is restored from the draft ref's sidecar if the draft's base equals the branch head (the rebase case comes in brief 06).
- **Commit:** `POST /commit {branch, path, user, message?}`: `engine.prepareCommit`, `git.commit` with `expectedHead` = the document's base commit, author = the user, co-authors = everyone else in `editorsSinceCommit`, then `engine.recordCommit`, then flush the draft (or delete it if nothing uncommitted remains). A stale head returns `409 {reason: 'stale'}` for now; brief 06 adds rebase-then-retry.
- `startRelay(opts) -> RelayHandle` in-process; `src/relay/cli.ts` runs it as a child process that prints a ready line; `src/testkit/relayHarness.ts` starts either kind and always stops it (`finally`, plus a process-exit safety net as spike 5 has).

## Tasks, in order. Stop when task 8 is done.

1. `src/relay/` per the above, with `README.md`. Extend the import-boundary test.
2. `src/testkit/editor.ts`: port spike 5's `createLiveClient` onto `crdt.editorPlugins`, with `engine.attachIntegration` wired, user token, `disconnect()`/`connect()` for offline periods, `destroy()`, and edit helpers (type text at a position, replace a word, split, join, delete range, add a comment through `engine`). Port `gates/lib/edits.ts` as `src/testkit/edits.ts`.
3. Unit or integration tests (`test/relay.*.test.ts`) for: open and seed; two editors converge; forged update rejected; flush then restore after deleting the relay's data dir; lease rejection path; commit with trailers. Keep each test short; the gates do the heavy measurement.
4. Gate A (`gates/a.ts`): open a path at the remote's head; the seeded relay state equals, byte for byte, an independent `seedFromCommit` of the same inputs; two live editors connect and their documents serialize byte-identically to the file.
5. Gate B (`gates/b.ts`): both edit (typing through transactions in different and in the same paragraph); `listAttribution` lists each user's typed text under that user; a forged update (spike 5's technique: an authenticated client applies a raw update under the victim's client id to its own doc so its provider forwards it) is rejected: the relay's and the victim's documents never contain the forged text, the forger's connection is closed, the rejection counter is 1.
6. Gate C (`gates/c.ts`): through the editors: create, reply, resolve, list comments; the other user edits inside, before and after the quoted ranges; every replica lists the same comments with CRDT or fuzzy anchors on the right text; a comment whose text is deleted is orphaned with its quote.
7. Gate D (`gates/d.ts`): after edits and comments, flush; in a plain clone, `git fetch origin refs/phraise/drafts/main:refs/d` then `git diff --name-only main refs/d` lists only the edited Markdown path, and `git show refs/d:<path>` equals the relay's render; the draft commit's first parent is the head. Stop the relay, delete its data directory, start a new relay on the same remote: the document restores with identical text, identical `listComments`, identical `listAttribution`. Stale flush: write a competing draft directly (from the testkit or a second relay), then flush from the first relay: the push is rejected by the lease (count it), the remote draft is not overwritten blindly, and the merge-and-retry outcome is reported.
8. Gate E (`gates/e.ts`) and the runner:
   - E1: alice and bob edit, alice commits: the branch head is the new commit, its author is alice, its message has a `Co-authored-by` trailer for bob and not for alice, its parent is the previous head; a commit attempted with a stale expected head (someone pushed first) is refused and the branch is unchanged.
   - E2: at least 50 corpus files (from `corpus/fetched/real`, seeded choice, printed), each with 1 to 3 random word edits in paragraphs made through an editor transaction; commit each; measure that every changed line of the commit's diff lies inside the edited blocks' original line spans (use spike 1's `diffHunks`/`topSpans` approach). Report files, edits, violations. Pass = 0 violations.
   - `gates/index.ts` runs A to E (and later gates as they are added), prints a table (gate, pass or fail, key numbers), writes `results/gates.md` and `results/gates.json`, exits non-zero on any failure, and checks at the end that nothing listens on ports 4300 to 4399. `--quick` reduces E2 to 10 files. Each gate also runs alone: `npx tsx gates/<x>.ts [--quick]`.
   - Run `npm run gates:quick`, `npm test`, `npm run typecheck`. Do **not** run the full `npm run gates`; the orchestrator runs it. Document the full command in the README.

## Definition of done

`npm test`, `npm run typecheck` and `npm run gates:quick` pass; A to E each report pass in the quick run, or the handback says exactly which check fails and why.

## Constraints

- Only add new files, except files inside the spike package created by earlier briefs.
- Log: `context/logs/2026-09-27-builder-spike-6-relay.md`. Do not commit.
- Ports 4300 to 4399 through `testkit/ports.ts`, 127.0.0.1 only; every server stopped; check with `lsof -nP -iTCP:4300-4399 -sTCP:LISTEN` before handing back.
- Bash refuses commands that mention `git` inside pipes, loops, `cd &&` chains or heredocs; run git commands as single plain commands. Prefer the Write tool for files.
- Handback under 300 words.
