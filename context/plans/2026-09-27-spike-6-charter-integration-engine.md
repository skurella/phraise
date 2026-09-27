# Charter: spike 6, integration: the headless engine

Status: dispatched
Author: lead agent (Fable 5.1)
Updated: 2026-09-27
Owner of this spike: one spike orchestrator (Opus 5.5)
Serves: every architecture decision; this is the feasibility gate named in [agent workflow](../docs/2026-09-27-agent-workflow.md)

## Why this spike exists

Five spikes each proved one part in isolation, with their own copies of a schema and their own harnesses. None proves the parts work **together**. This spike builds one codebase in which they do, headless, and runs the whole loop: open a file from a git remote, edit it together, comment, flush drafts, commit, absorb an external commit, return from offline, and edit the same document as a file through the daemon. If it passes, the owner decides whether to open a production tree, and this code is the candidate to be promoted. Write it accordingly: clear module boundaries, unit tests, no harness-only shortcuts in the modules themselves.

## What you build on

Five spikes are finished. **Copy** what you need from them, never import across spike directories, and note origin branch and commit in your README. If a branch below no longer exists on origin, its PR was merged and the same files are on `origin/main`.

| Spike | Branch and commit | Directory | Findings doc in `context/docs/` |
|---|---|---|---|
| 1. Markdown round trip | `origin/spike/2026-09-27-markdown-round-trip` at `1e1f4a6` | `spikes/2026-09-27-markdown-core-remark-splice/` | `2026-09-27-spike-1-findings-markdown-round-trip.md` |
| 2. CRDT rebase, comment anchors | `origin/spike/2026-09-27-crdt-rebase` at `ab552ed` | `spikes/2026-09-27-crdt-rebase-yjs-fork/` | `2026-09-27-spike-2-findings-crdt-rebase.md` |
| 3. Daemon file sync | `origin/spike/2026-09-27-daemon-file-sync` at `9343b62` | `spikes/2026-09-27-daemon-file-sync-fork-import/` | `2026-09-27-spike-3-findings-daemon-file-sync.md` |
| 4. GitHub storage | on `origin/main` | `spikes/2026-09-27-github-storage-ghapi/` | `2026-09-27-spike-4-findings-github-storage.md` |
| 5. Collaboration stack | `origin/spike/2026-09-27-collab-stack` at `eeb3fe2` | `spikes/2026-09-27-collab-stack-yjs13-hocuspocus/` | `2026-09-27-spike-5-findings-collab-stack.md` |

Read findings with `git show <branch>:context/docs/<file>`. The architecture decisions doc on each branch carries the lead's amendments made after that spike; read the amendment sections on all four branches, because `main` does not have them all yet.

## Decisions already made that you implement

Read them in the architecture decisions doc and its amendment sections. The ones that shape this spike:

- Stack: Yjs 13.6, y-tiptap 3.0, Hocuspocus 4.7 with SQLite, behind the five-point CRDT interface from spike 5. No other module touches Yjs types.
- One mechanism, fork at base then diff then merge, for external commits, offline returns and file saves, using spike 3's block alignment.
- Drafts: one ref per branch, `refs/phraise/drafts/<branch>`, written by `git push --force-with-lease`. The draft commit is parented on its base commit and overwritten. Its tree mirrors the repo, with draft Markdown at its real path and Phraise's own data under `.phraise/`.
- Re-seeding is compaction at quiet points with generations and a grace period, D1 as amended. **This is untested and you test it.**
- A save never fails and never silently changes meaning: best effort plus a flag on the block.

## Goal

One spike directory with modules along these lines: document model, CRDT interface, engine (rebase, import, comments, review flags), git storage, relay, daemon, test kit. The remote is a **local bare git repository**. Live editors are ProseMirror `EditorView` instances in jsdom, as in spike 5.

## Milestones and gates

Work in this order. Push at each milestone.

**Milestone 1, the loop without surprises**

| Gate | Requirement |
|---|---|
| A. Open | The relay opens a path on a branch at the remote's head commit and seeds the document deterministically. Two live editors connect and see it. |
| B. Edit and attribution | Both edit. Ranges are listed per user. A forged client identity is **rejected** by the relay before the update is applied. |
| C. Comments | A comment store in shared state: create, reply, resolve, list. Anchors as fixed under D3. Comments survive the other user's edits. |
| D. Drafts | The relay flushes to the draft ref as decided. `git diff <branch> refs/phraise/drafts/<branch>` on a plain clone shows exactly the uncommitted changes. A relay restarted with its local storage deleted restores the document from the draft ref with comments and attribution intact. A stale flush is rejected by the lease. |
| E. Commit | A user-triggered commit writes the serialized Markdown to the branch, with `Co-authored-by` trailers for everyone who edited since the last commit, only if the head is the expected one. The commit's diff touches only edited blocks, measured on at least 50 corpus files with one to three edits each. |

**Milestone 2, surprises**

| Gate | Requirement |
|---|---|
| F. External commit | Someone pushes a commit that changes the file. The relay detects it by polling the ref and rebases the live document while an editor keeps typing. Comments survive or are orphaned. Blocks changed on both sides are flagged. A commit attempted after the head moved rebases first and then succeeds. |
| G. Offline return | An editor that was offline through a rebase and a commit returns and converges with nothing lost. |
| H. Serializer and parser fixes | Best effort plus flag instead of refusal; composition across blocks checked; no numeric character references from concurrent formatting; the footnote-continuation bug from spike 3's gate F fixed; parse cache kept across calls. Spike 1's gates A and B still pass on the full corpus with the integrated schema. |

**Milestone 3, long-lived replicas**

| Gate | Requirement |
|---|---|
| I. Daemon | The daemon attaches to the same relay document. File saves and live editors interleave. Spike 3's gates A to H pass in the integrated code. The exact-tie case behind spike 3's two fuzz failures is fixed or bounded, with evidence. |
| J. Reported base | The daemon accepts an explicit base version for a save over a local interface, as an editor extension would send it. With reported bases, spike 3's hostile fuzz shows 0 wrong-base imports. |
| K. Generations | The relay compacts at a quiet point and starts a new generation. An offline editor and a stopped daemon, each holding edits from the previous generation, return within the grace period and are merged with nothing lost. After the grace period they get a conflict copy and nothing is overwritten. State what the relay retains and for how long. If the design as amended under D1 does not work, say so and propose what does. |

**Milestone 4, the whole system**

| Gate | Requirement |
|---|---|
| L. System fuzz | At least 300 randomized trials mixing two editors, daemon saves, external commits, commits, relay restarts, offline periods and compaction: no exception, convergence, no text lost other than the accepted delete-versus-edit case, which is counted separately, and every commit's diff confined to edited blocks. Failures categorized with replayable seeds. |
| M. Scale | On the 240 KB document: memory of relay, editor and daemon separately, and latency of edit to file, save to editor, flush, commit and rebase. Spike 3 measured about 730 MB in one process; find where it goes and reduce it if cheap. |

## Out of scope

GitHub and its API. A web page or real browser. The MCP server. Mermaid. Authentication beyond a stub that names the user.

## Constraints

- All code under `spikes/2026-09-27-integration-engine/`, with a top-level README and one per module.
- Ports 4300 to 4399.

## Rules for every agent in this spike

- **Only add new files.** Do not edit `AGENTS.md`, the decision register, other docs, or anything belonging to another spike. Record decisions in a "Decisions" table in the findings doc with impact and difficulty ratings; the lead transfers them to the register.
- **No wall-clock budgets.** Agents cannot perceive elapsed time. Briefs budget by an ordered task list with a stated stopping point. Nobody stops or cuts scope because they believe time ran out.
- **Timestamps come only from the output of `date`** at the moment of writing. Never estimated.
- **Long verification runs belong to the orchestrator.** A builder is done when the quick subset passes and the full command is documented.
- **Verify claims that have consequences** by running the check yourself.
- **Report failing gates as failing.** If the gate command exits with a failure, say so in the first line of the handback, whatever the reason.
- **Unit tests are required.** `npm test` must find and pass real tests. Gate scripts are in addition to unit tests, not instead of them.
- Commit incrementally. Stage paths explicitly; never `git add -A` or `git add .`. Do not commit `node_modules`, databases, browser binaries or fetched corpora.
- Log at every milestone and at every task boundary.
- TypeScript on Node 22.12.0 with npm 11. **pnpm is broken on this machine; use npm.** The Bash sandbox is off.
- Local servers bind to 127.0.0.1 only, on ports in the range this charter assigns, and are stopped when a run ends.
- Tests use temporary directories and temporary git repositories under `$TMPDIR`. Never use the Phraise repository or any of the owner's directories as test data. No GitHub API calls and no pushes other than pushing this branch.

## Branch and commits

Branch `spike/2026-09-27-integration-engine` exists, is based on `main`, and contains this charter. Check it out in your worktree. Do not open a PR and do not merge.

## Authority, escalation, budget

You decide everything within this charter. You may change a design from an earlier spike when integration shows it is wrong; record it as a decision and say which spike's decision it replaces. Escalate by handing back early only if a locked decision needs to change in a way that alters the product, a milestone looks unachievable, or you have used twice the budget. Budget: about eighteen worker dispatches. If you reach the budget with milestones unfinished, hand back at the last completed milestone with the rest described.

## Deliverables

1. The code, unit tests, and one command that runs all gates and prints a results table.
2. `context/docs/<date>-spike-6-findings-integration-engine.md`: gate results with numbers, the architecture as built with a module diagram in text, what changed relative to the five spikes and why, the Decisions table, open risks, and a verdict: is the product feasible as designed, and what must be true before a production tree is opened.
3. Briefs in `context/plans/` and one log per agent session in `context/logs/`, names containing `spike-6`.
4. Everything committed and pushed.

## Handback to the lead

Under 400 words. First line: whether the gate command passes. Then gate results as a table, the feasibility verdict, decisions the lead should review first, what was left out and why, and the paths of the findings doc and your log.
