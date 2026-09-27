# Charter: spike 2, rebase a live CRDT document and keep comments anchored

Status: dispatched
Author: lead agent (Fable 5.1)
Updated: 2026-09-27
Owner of this spike: one spike orchestrator (Opus 5.5)
Serves: decisions D1, D3, D5 and D6 in [architecture decisions](../docs/2026-09-27-architecture-decisions.md)
Supersedes: the spike 2 section of [the spikes plan](2026-09-27-derisking-spikes.md) where they differ

## Why this spike exists

Phraise promises that an external git commit, a user returning from offline, and a branch merge are all absorbed into the live document without a blocking merge dialog, and that comments survive. Overleaf documents the opposite: git pushes displace comments. If we cannot deliver this, the mental model of a shared working tree fails. This spike also settles the hardest open decision, D5: Yjs or Loro.

## Independence

This spike runs in parallel with spike 1 and shares nothing with it. **Do not read or use spike 1's code or branch.** Use your own minimal ProseMirror schema: paragraphs, headings, bullet and ordered lists, blockquote, code block, and the marks strong, emphasis, code and link. Convert Markdown to documents with any off-the-shelf parser. Byte-exact Markdown preservation is out of scope; compare documents at the document-model level.

## Goal

Demonstrate, headless and with automated tests, that a live collaborative document based on commit A can be rebased onto commit B while holding comments and unsynced concurrent edits, with a correct and attributable result. Do it with Yjs, and evaluate Loro far enough to make a grounded recommendation.

## Success gates

| Gate | Requirement |
|---|---|
| A. Untouched anchor | A comment on a range in a paragraph that neither side changed resolves to the same text after the rebase, through its CRDT position. |
| B. Rewritten paragraph | A comment in a paragraph that commit B rewrote resolves to the right text when the quoted text survives, through the CRDT position or, failing that, through quote selectors with fuzzy matching. |
| C. Deleted paragraph | A comment in a paragraph that commit B deleted is marked orphaned and keeps its original quote. It is not silently dropped or mis-anchored. |
| D. Concurrent edit | A second client edits a paragraph offline, commit B changes the same paragraph, the rebase happens, then the client reconnects. Both changes survive, the block is flagged "needs review", and all replicas converge to the same document whatever the order of delivery. |
| E. Attribution | After the rebase it is possible to list which peer inserted which ranges: each human user and a synthetic peer named after the git author. State how the mapping from CRDT client identity to user is kept. |
| F. Equality | Every block not concurrently edited equals commit B's version at the document-model level. |
| G. Re-seed | Decision D1 re-seeds a fresh CRDT document from the committed Markdown after each commit, which discards CRDT positions. Show that comments carry across a re-seed through their selectors: 100 percent when the text is unchanged, and measured rates under small edits. |
| H. Fuzz | At least 500 randomized trials of upstream edits against local edits on realistic documents: no exceptions, replicas converge, no local text is lost, and gate F holds. Report failures by category. |
| I. Yjs versus Loro | The same scenario implemented in Loro to the extent needed to judge: is the rebase materially simpler or more correct with `fork`, `diff` and `applyDiff`, how mature is `loro-prosemirror`, and what would switching cost. A reasoned recommendation, not a feature table. |

Stretch, only if cheap: try the Yjs 14 release candidate's attribution API for gate E and report whether it is usable today.

## Design points you must address in the findings

- Granularity of the applied diff: block level, then word or character level inside changed blocks, and its effect on comment survival and on interleaving with concurrent edits.
- How "needs review" is detected and represented.
- What the comment anchor record contains: CRDT position, exact quote, prefix, suffix, offset, and the fuzziness budget used.
- Whether the rebase must run on the server only or can run on any replica, and what happens if two replicas run it at once.

## Constraints

- All code under `spikes/2026-09-27-crdt-rebase-<approach>/`, one directory per approach, each self-contained with a README stating goal, status and how to run. No cross-directory imports.
- TypeScript on Node 22.12.0 with npm 11. **pnpm is broken on this machine; use npm.** Headless only: no browser and no server are needed.
- The Bash sandbox is off; network and git commands work normally.
- **Only add new files.** Do not edit `AGENTS.md`, the decision register, other docs, or anything belonging to another spike. Record your decisions in a "Decisions" table in your findings doc with impact and difficulty ratings; the lead transfers them to the register.
- Stage paths explicitly. Never use `git add -A` or `git add .`. Do not commit `node_modules`.
- Every agent logs at each milestone and at least every 15 minutes.

## Branch and commits

Branch `spike/2026-09-27-crdt-rebase` exists, is based on `main`, and contains this charter. Check it out in your worktree. Commit early and often, push at milestones and before handback. Do not open a PR and do not merge.

## Authority, escalation, budget

You decide everything within this charter. Escalate by handing back early only if a locked decision needs to change, gates A to D look unachievable with both libraries, or you have used twice the budget. Budget: about ten worker dispatches. Sonnet for implementation and fresh-context review, Haiku for mechanical work, your own effort for planning, algorithm design and judging results.

## Deliverables

1. Spike code and tests, with one command per approach that runs all gates and prints a results table.
2. `context/docs/<date>-spike-2-findings-crdt-rebase.md`: gate results with numbers, the algorithm as built, what was tried and abandoned, the design points above, the Decisions table, open risks, and a recommendation for D5 and D6: confirm, amend or replace.
3. Briefs in `context/plans/` and one log per agent session in `context/logs/`.
4. Everything committed and pushed.

## Handback to the lead

Under 400 words: gate results as a table, the recommendation for D5 and D6, decisions the lead should review first, what was left out and why, and the paths of the findings doc and your log.
