# Brief 06: fresh-context review of spike 2

Status: done
Author: spike orchestrator (Opus 5.5)
Updated: 2026-09-27
Related: [plan](2026-09-27-spike-2-plan.md), [charter](2026-09-27-spike-2-charter-crdt-rebase.md)
Assignee: reviewer (Sonnet, fresh context)

## Goal

Find what is wrong, overstated or untested in spike 2 before the orchestrator writes the findings doc. You report; you do not fix.

## Scope, in priority order

Stop after item 5.

1. **Gate honesty in `spikes/2026-09-27-crdt-rebase-yjs-fork/`.** For each gate A to H, G2 and idempotence, read the gate code and say whether it actually tests the charter's requirement (the charter's gate table is the reference). Look especially for checks that are vacuous, circular (the expected value computed by the code under test), or narrowed so they cannot fail.
2. **The orchestrator's revisions** listed in the README section "Orchestrator revision": the per-transaction relay and causal-delivery hold-back in `src/replica.ts`, the loss classifier in `src/fuzz/lossCause.ts`, the anchoring changes in `src/comments.ts` (`fuzzyAnchor`, `contextOnlyAnchor`), and the G2 measurement changes in `src/gates/gate-g2.ts`. Is each change sound, or does it hide a real failure? Could the classifier label a rebase-caused loss as `human-delete`?
3. **Algorithm correctness** against plan sections 1 to 7: fork at base, deterministic peer, records, integration (needs-review, resurrection), comments, attribution. Construct at least three adversarial scenarios the tests do not cover (for example a rebase back to an earlier commit id, two different rebases from the same base racing, a human editing a block after acknowledging a rebase, mark-only upstream changes, resurrection inside nested lists) and run them as throwaway scripts in your scratch area or under `/private/tmp`, not committed. Report what happens.
4. **Loro spike** `spikes/2026-09-27-crdt-rebase-loro-fork/`: are its gates comparable to the Yjs ones, and are the README's comparative claims (LOC, sizes, simpler/harder) supported by the code?
5. **Binding probe** `spikes/2026-09-27-crdt-rebase-binding-probe/`: do the tests show what the README table claims?

Run `npm test` in each of the three directories (after `npm install` if needed). Do not run `npm run fuzz`; the orchestrator runs long commands.

## Definition of done

A findings list in your handback, each item with severity (blocker, major, minor), file and line, evidence (command and output, or code excerpt), and what a fix would involve.

## Constraints

- Model Sonnet, fresh context. Budget is the ordered list above; there is no time budget.
- Working directory `/Users/skk/code/phraise/.claude/worktrees/agent-afb20bfe01387fcb2`, absolute paths. No agents. Do not modify or commit any file except your log.
- Log: `context/logs/2026-09-27-reviewer-spike-2.md`; headings from `date '+%H:%M'` at the moment of writing; entries at every milestone. Commit only the log, staged by explicit path.

## Handback

Under 300 words, most severe first. Put full detail in your log.
