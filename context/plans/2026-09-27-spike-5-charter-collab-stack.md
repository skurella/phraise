# Charter: spike 5, the live collaboration stack: Yjs 13 with workarounds or Yjs 14

Status: dispatched
Author: lead agent (Fable 5.1)
Updated: 2026-09-27
Owner of this spike: one spike orchestrator (Opus 5.5)
Serves: decision D5 in [architecture decisions](../docs/2026-09-27-architecture-decisions.md)

## Why this spike exists

Spikes 1 and 2 settled that Phraise stays on Yjs rather than Loro, and found that the stable editor binding, y-prosemirror 1.3.7, silently drops the root node's attributes and all marks on atom nodes. In 134 of 294 real files a linked image would lose its link. The Yjs 14 release candidate keeps both, and also brings the attribution and suggestion features Phraise wants. Everything so far was headless. Nobody has yet run the real stack: a relay, two live editors, the Phraise schema. This spike does that and decides which Yjs version the integration is built on.

## What you may reuse

You may **copy** code from finished spikes, noting origin branch and commit:

- Schema, parser, serializer, Yjs codec: branch `origin/spike/2026-09-27-markdown-round-trip` at `1e1f4a6`, directory `spikes/2026-09-27-markdown-core-remark-splice/`.
- Rebase algorithm, comment anchors, and the binding probe with Yjs 14 tests: branch `origin/spike/2026-09-27-crdt-rebase` at `88bd85c`, directories `spikes/2026-09-27-crdt-rebase-yjs-fork/` and `spikes/2026-09-27-crdt-rebase-binding-probe/`.

Read their findings with `git show <branch>:context/docs/<file>`: `2026-09-27-spike-1-findings-markdown-round-trip.md` and `2026-09-27-spike-2-findings-crdt-rebase.md`.

## Goal

Run two candidate stacks end to end with live editors and the Phraise schema, and recommend one:

- **Stack 13:** Yjs 13 stable, y-prosemirror 1.x, Hocuspocus 4, Tiptap 3, with workarounds for the two losses.
- **Stack 14:** the Yjs 14 release candidate with its ProseMirror binding, and whatever relay and Tiptap integration can be made to work with it.

Live editors means real ProseMirror `EditorView` instances with the sync plugin, in jsdom or in a real browser through Playwright. Your choice; say which and why.

## Success gates

Each gate is answered for both stacks unless it says otherwise.

| Gate | Requirement |
|---|---|
| A. Relay | Two live editors and a relay exchange edits. For stack 14, establish whether Hocuspocus 4 works with it, and if not, which relay does. |
| B. Schema fidelity while editing | With a schema shaped like spike 1's (attributes on the root node, `src` and `gap` attributes on top-level blocks, raw source blocks, inline atoms, an image inside a link), typing, pasting, splitting and joining blocks in one editor leaves the other editor and the relay's stored document with nothing lost. For stack 13 this is with the workarounds. |
| C. Workaround cost, stack 13 | Implement both workarounds for live editing: root attributes outside the fragment, and links on images without marks on atoms, by schema change or by patching the binding. Report what each costs in code and in constraints on the schema, and whether spike 1's serializer still passes its round-trip gate with the changed schema on a sample of at least 50 corpus files. |
| D. Tiptap | Tiptap 3 with its collaboration and cursor extensions works on the stack, or state what has to be replaced by custom extensions. |
| E. Attribution | For a document edited by two users, list who wrote which ranges and when. State where the mapping from client identity to user is kept and how it survives reconnects. For stack 14 use its attribution API and report whether suggestion mode is usable. |
| F. Rebase port | Spike 2's rebase scenario, its gates A to D, runs on the stack with live editors connected during the rebase. For stack 14 this requires the fork-at-snapshot and deterministic client ID techniques to exist there; report what had to change. |
| G. Persistence and reconnect | The relay persists a document, restarts, and clients reconnect without loss. An editor that was offline during edits reconnects and converges. |
| H. Maturity | For stack 14: release cadence, breaking changes across the last release candidates, open issues that would affect Phraise, and whether documents written by 13 can be read by 14 and the reverse. Evidence, not impressions. |

## Recommendation required

One of: build the integration on stack 13 with workarounds and migrate later; build on stack 14 now; or build on 13 behind an interface narrow enough to swap. State what would change your mind and what the migration would cost.

## Constraints

- All code under `spikes/2026-09-27-collab-stack-<approach>/`, one directory per stack, each self-contained with a README stating goal, status, origin of copied code, and how to run.
- Ports 4200 to 4299.
- If you use Playwright, install its browser into the spike directory's cache, not globally, and do not commit it.

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

Branch `spike/2026-09-27-collab-stack` exists, is based on `main`, and contains this charter. Check it out in your worktree. Push at milestones and before handback. Do not open a PR and do not merge.

## Authority, escalation, budget

You decide everything within this charter. Escalate by handing back early only if a locked decision needs to change, neither stack can pass gate B, or you have used twice the budget. Budget: about ten worker dispatches. Sonnet for implementation and fresh-context review, Haiku for mechanical work, your own effort for planning, design and judging results.

## Deliverables

1. Spike code and tests, with one command per stack that runs its gates and prints a results table.
2. `context/docs/<date>-spike-5-findings-collab-stack.md`: gate results for both stacks side by side, what was tried and abandoned, the Decisions table, open risks, and the recommendation for D5.
3. Briefs in `context/plans/` and one log per agent session in `context/logs/`, names starting `<date>-spike-5-` or `<date>-<role>-spike-5-`.
4. Everything committed and pushed.

## Handback to the lead

Under 400 words: gate results as a table with one column per stack, the recommendation, decisions the lead should review first, what was left out and why, and the paths of the findings doc and your log.
