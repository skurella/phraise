# Brief 06: forgery fix, head polling and rebase with live editors, gates F and G

Status: dispatched
Author: spike 6 orchestrator (Opus 5.5)
Updated: 2026-09-27
Plan: [spike 6 plan](2026-09-27-spike-6-plan.md), sections 5 and 6.
Charter: [spike 6 charter](2026-09-27-spike-6-charter-integration-engine.md): "Milestone 2" gates F and G, and "Rules for every agent in this spike", which binds you.
Review that prompted task 1: [milestone 1 review log](../logs/2026-09-27-reviewer-spike-6-m1.md).

## Goal

Close the forged-identity bypass found in review, then make the relay absorb external commits: poll the branch head, rebase open documents while editors type, rebase before a commit when the head moved, restore a draft whose base is behind the head, and prove offline return. Serves D6 (one mechanism; never a merge dialog; needs-review flags), D2 (restore), D5 amendment 5 (forged identities rejected, not flagged).

## Inputs to read

- `AGENTS.md`, this brief, plan sections 5 and 6, the charter's milestone 2 table, the review log above (blocker section).
- The package: `README.md`, `src/relay/` (all), `src/engine/rebase.ts`, `integrate.ts`, `commit.ts`, `src/git/index.ts`, `src/testkit/editor.ts`, `edits.ts`, `remote.ts`, `gates/b.ts`, `gates/e.ts` (for structure).
- For the scenario content: `$REF/2026-09-27-collab-stack-yjs13-hocuspocus/gates/gateF.ts` (plan section 1 gives `$REF`).

## Tasks, in order. Stop when task 7 is done.

1. **Forgery rule, all message types.** Replace the message-type exemption in `src/relay/forgery.ts` with a clock rule that applies to sync step 2 and update messages alike: for each client range in an incoming update, if the client id is mapped to another user or is a synthetic peer (seed, git, generation), the message is a forgery unless the relay already holds every clock in that range (then it adds nothing and is harmless) **or** the document is in a recovery window. A document is in a recovery window after its state was restored from a draft or re-seeded because local state was lost, for a configurable time (default 60 s); during it, other users' clocks the relay lacks are accepted without re-attribution and counted as `relayedDuringRecovery`. Unmapped ids are mapped to the connection's user as before. Document the residual (forgery during a recovery window). Extend gate B with the reviewer's attack (a sync-step-2 message carrying a clock extension of the victim's id over the forger's socket): rejected, counted, connection closed, victim and relay unaffected. Add a unit test for the recovery-window acceptance.
2. **Head poller.** Per branch with open documents, `remoteHead` every `pollMs` (option; gates use 100 to 250 ms) and `POST /poll` on demand. On a new head: fetch; for each open document of the branch, through its queue, run `engine.rebase` to the new head's content (the git author from `commitInfo` as the rebase author), then `engine.ackOwnRebase`. A file the commit did not change still advances its base through the same call. Expose counters and the last rebase duration.
3. **Commit after the head moved.** `POST /commit` compares the remote head with the document's base; if it moved, poll-and-rebase first, then commit. On a lease rejection, rebase and retry, up to 3 attempts, then `409`.
4. **Restore behind the head.** A document restored from a draft whose base is behind the branch head is restored and then rebased to the head in the same open; the draft is never silently dropped. Unit test it.
5. **Gate F** (`gates/f.ts`), on a document with at least 8 blocks including a list and a table:
   - alice and bob connected; comments planted on an untouched paragraph, on a paragraph the external commit rewrites, and on a paragraph it deletes;
   - someone else commits and pushes a change touching several blocks, including one alice is concurrently editing;
   - while the poller detects it and the relay rebases, alice keeps typing (a burst of at least 40 single-character inserts spanning the rebase);
   - after settling: all three replicas (alice, bob, relay) converge to identical state and identical `listReview`; every inserted character of alice's burst is present; every block nobody touched equals the new head's block; the block changed on both sides is flagged on all replicas and no other block is; comments: untouched one resolves by CRDT, rewritten one recovered or orphaned with its quote, deleted one orphaned;
   - then bob commits: the commit's parent is the external commit, the committed file equals the relay's render, and its diff against the external commit is confined to the blocks alice and bob edited;
   - then another external commit lands and alice commits immediately, before the poller runs: the relay rebases first and the commit succeeds on top of it.
   Record rebase latency (head pushed to all replicas converged) and print it.
6. **Gate G** (`gates/g.ts`): bob goes offline (provider disconnected, the editor keeps working locally); while he is offline, an external commit lands and is rebased, alice edits and commits; bob edits offline: in a block the external commit changed, in a block it deleted, and in an untouched block. Bob reconnects. Pass: all replicas converge; every token bob typed offline is present (the deleted block is resurrected once and flagged `deleted-upstream-edited-locally`); upstream changes and alice's committed text are present; the next commit includes bob's offline text and lists bob as a co-author. Run a second variant where bob stays offline through two external commits and two commits.
7. Add F and G to the runner; `npm test`, `npm run typecheck`, `npm run gates:quick` pass. Document new relay options and endpoints in `src/relay/README.md`. Do not run the full `npm run gates`.

## Definition of done

`npm test`, `npm run typecheck` and `npm run gates:quick` pass, with gates A to G all passing in the quick run, or the handback states exactly which check fails and why.

## Constraints

- Only add new files, except files inside the spike package created by earlier briefs.
- Log: `context/logs/2026-09-27-builder-spike-6-rebase.md`. Do not commit.
- Ports 4300 to 4399 through `testkit/ports.ts`; every server stopped; check with `lsof -nP -iTCP:4300-4399 -sTCP:LISTEN` before handing back.
- Bash refuses commands that mention `git` inside pipes, loops, `cd &&` chains or heredocs; run git commands as single plain commands. Prefer the Write tool for files.
- If a charter requirement cannot be met by the design, say which and why; never weaken a check silently.
- Handback under 300 words.
