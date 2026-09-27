# Charter: spike 3, the local daemon: live documents as real files

Status: dispatched
Author: lead agent (Fable 5.1)
Updated: 2026-09-27
Owner of this spike: one spike orchestrator (Opus 5.5)
Serves: decision D7, and D6 where the file system is involved, in [architecture decisions](../docs/2026-09-27-architecture-decisions.md)
Supersedes: the spike 3 section of [the spikes plan](2026-09-27-derisking-spikes.md) where they differ

## Why this spike exists

D7 says a local daemon materializes a live collaborative document as an ordinary file in a git working tree, so that VS Code, Typora, Claude Code and every other file-based tool work unchanged. It is the project's main integration bet and the route by which AI agents edit documents. The risks are all at the boundary between a file, which has no history and is overwritten whole, and a CRDT, which merges operations: echo loops, stale saves that revert other people's edits, editors that fight the daemon for the file, and git operations that change files underneath it.

## What you may reuse

Spikes 1 and 2 are finished. You may **copy** code from them, noting origin branch and commit:

- Document model, parser, block-preserving serializer and Yjs codec: branch `origin/spike/2026-09-27-markdown-round-trip` at `1e1f4a6`, directory `spikes/2026-09-27-markdown-core-remark-splice/`. Its findings: `context/docs/2026-09-27-spike-1-findings-markdown-round-trip.md` on that branch.
- Rebase by fork-at-base, two-way diff, comment anchors: branch `origin/spike/2026-09-27-crdt-rebase` at `88bd85c`, directory `spikes/2026-09-27-crdt-rebase-yjs-fork/`. Its findings: `context/docs/2026-09-27-spike-2-findings-crdt-rebase.md` on that branch.

Read the two findings docs with `git show <branch>:<path>`. Use Yjs 13 stable and Hocuspocus 4. The daemon is headless, so spike 1's Yjs codec covers its conversion path.

## Goal

Build a daemon that connects to a local relay as a Yjs client, writes the document to a file, watches the file, and turns file changes into attributed CRDT operations. Demonstrate with automated tests that it is safe under concurrency and hostile timing. A second headless client stands in for the browser editor.

## Success gates

| Gate | Requirement |
|---|---|
| A. Remote to file | A remote edit reaches the file. Untouched blocks stay byte-identical. Report latency, median and 95th percentile. |
| B. File to remote | A file edit reaches the remote client as operations confined to the changed block, attributed to the local user. Cover the three ways editors save: write in place, write a temporary file and rename over, truncate then write. Report latency. |
| C. No echo | The daemon's own writes never come back as edits. Holds under rapid alternating edits from both sides. |
| D. Stale save | An editor saves a buffer based on an older version of the file, after remote edits have arrived. The remote edits are **not reverted**: the daemon applies only what the user changed relative to what their editor had loaded. State how the daemon knows that base. |
| E. Concurrency | Simultaneous local and remote edits, in different blocks and in the same block: all replicas converge, nothing is lost, and the file ends equal to the serialization of the converged document. |
| F. No fighting the editor | After importing a local save, the daemon does not rewrite the file unless a remote change arrives. That requires importing and re-serializing to reproduce the saved bytes exactly, including half-typed Markdown such as an unclosed fence. Measure on spike 1's corpus and on at least 30 hand-made half-typed states. |
| G. Git underneath | `git commit` of the file is harmless. A branch switch, pull, stash or reset that changes the file must not be imported as the user's edits: the daemon detects that HEAD or the branch moved and detaches or re-bases that document, and says so. |
| H. Restart | The daemon is stopped, both sides change, the daemon restarts. It merges from a persisted base. If it cannot, it writes a conflict copy beside the file and overwrites nothing. |
| I. Fuzz | At least 300 randomized trials interleaving local saves, remote edits, daemon restarts and delays: no exception, convergence, no lost text, no echo. Failures categorized. |
| J. Large file | The 240 KB case from spike 1 took about 2 s to serialize. Measure the daemon on it and, if cheap, cache verification for unchanged nodes. Report before and after. |

Stretch, only if cheap: a minimal MCP server on the daemon exposing read document, list comments, add comment, reply and resolve, with one end-to-end test.

## What to address in the findings

- How real editors behave when a file changes under them: VS Code with a clean buffer, VS Code with unsaved changes, vim, Typora. Cite documentation where you cannot test. State what the user would see and whether a VS Code extension is needed for a good experience or only for comments and presence.
- Debounce values chosen and why.
- What the daemon persists locally, where, and what happens if that state is deleted.
- Whether Node is adequate for the daemon or a compiled daemon is warranted.
- Anything in spike 1's or spike 2's design that the daemon needs changed.

## Constraints

- All code under `spikes/2026-09-27-daemon-file-sync-<approach>/`, self-contained, with a README stating goal, status, origin of copied code, and how to run.
- Ports 4100 to 4199.
- Tests create and delete their own temporary git repositories and directories under `$TMPDIR`. Never operate on the Phraise repository itself as test data, and never on the owner's other directories.

## Rules for every agent in this spike

- **Only add new files.** Do not edit `AGENTS.md`, the decision register, other docs, or anything belonging to another spike. Record decisions in a "Decisions" table in the findings doc with impact and difficulty ratings; the lead transfers them to the register.
- **No wall-clock budgets.** Agents cannot perceive elapsed time. Briefs budget by an ordered task list with a stated stopping point. Nobody stops or cuts scope because they believe time ran out.
- **Timestamps come only from the output of `date`** at the moment of writing, for example `echo "## $(date +%H:%M) — title" >> logfile`. Never estimated.
- **Long verification runs belong to the orchestrator.** A builder is done when the quick subset passes and the full command is documented.
- **Verify claims that have consequences** by running the check yourself.
- Commit incrementally. Stage paths explicitly; never `git add -A` or `git add .`. Do not commit `node_modules`.
- Log at every milestone and at least at every task boundary.
- Copying code from another spike is allowed when the charter says so: copy the files in, never import across spike directories, and note the origin branch and commit in the README.
- TypeScript on Node 22.12.0 with npm 11. **pnpm is broken on this machine; use npm.** The Bash sandbox is off.
- Local servers bind to 127.0.0.1 only, on ports in the range this charter assigns, and are stopped when a run ends.

## Branch and commits

Branch `spike/2026-09-27-daemon-file-sync` exists, is based on `main`, and contains this charter. Check it out in your worktree. Push at milestones and before handback. Do not open a PR and do not merge.

## Authority, escalation, budget

You decide everything within this charter. Escalate by handing back early only if a locked decision needs to change, gates D or E look unachievable, or you have used twice the budget. Budget: about ten worker dispatches. Sonnet for implementation and fresh-context review, Haiku for mechanical work, your own effort for planning, design and judging results.

## Deliverables

1. Spike code and tests, with one command that runs all gates and prints a results table.
2. `context/docs/<date>-spike-3-findings-daemon-file-sync.md`: gate results with numbers, the design as built, what was tried and abandoned, the points above, the Decisions table, open risks, and a recommendation for D7: confirm, amend or replace.
3. Briefs in `context/plans/` and one log per agent session in `context/logs/`, names starting `<date>-spike-3-` or `<date>-<role>-spike-3-`.
4. Everything committed and pushed.

## Handback to the lead

Under 400 words: gate results as a table, the recommendation for D7, decisions the lead should review first, what was left out and why, and the paths of the findings doc and your log.
