# Brief 07: fresh-context review of both stacks

Status: done
Author: spike 5 orchestrator (Opus 5.5)
Updated: 2026-09-27
Plan: [spike 5 plan](2026-09-27-spike-5-plan.md). Charter: [spike 5 charter](2026-09-27-spike-5-charter-collab-stack.md), gates A to G; "Rules for every agent in this spike" binds you.
Model: Sonnet, reviewer. You report findings; you do not fix them.

## Goal

Decide, for each gate row of both stacks, whether the gate code actually tests what the charter and the plan say it tests, and whether the reported numbers are true. The spike's recommendation on D5 will rest on these rows, so a vacuous pass or an untrue claim is the most important thing you can find.

## Scope

- `spikes/2026-09-27-collab-stack-yjs13-hocuspocus/` and `spikes/2026-09-27-collab-stack-yjs14-rc/`: `gates/`, `scripts/gates.ts`, `src/` (relay, clients, workarounds, attribution, rebase), READMEs, `results/gates.md`.
- Not in scope: spike 1's parser and serializer, spike 2's algorithm as such (both reviewed in their own spikes), style.

## Ordered tasks

Stopping point: task 5 done.

1. From a fresh clone of the pushed branch into your scratch directory (`git clone --branch spike/2026-09-27-collab-stack <origin url> <dir>`; the origin url is in `git -C /Users/skk/code/phraise/.claude/worktrees/agent-a9ca7fc64553beeea remote get-url origin`), in each stack: `npm ci`, `npm run fetch`, `npm run gates:quick`, `npx tsc --noEmit`. Report anything that does not work from a clean checkout (for stack 14 the postinstall dedupe must work under `npm ci`). Use ports 4270 to 4299 for anything you start yourself; the gate runners use their own fixed ports, so do not run the two stacks at the same time.
2. For every gate row (A, B, B2, B3, C, D, E, F, G) in both stacks, read the gate code and answer: what exactly is compared; could it pass while the property is false (for example comparing text only, comparing a document with itself, waiting on the wrong condition, catching and ignoring errors, a negative control that cannot fail); are the two stacks' versions of the gate equivalent in strength. Give file and line for each problem.
3. Check the specific claims the findings will rely on, by running or reading, and say which you verified and how:
   - Stack 13's two workaround plugins are loss-free for the operations gate B and B3 cover, and the claimed plugin-order constraint (leafMarks before rootAttrs) is still real after the orchestrator's fix to `rootAttrs.ts`.
   - Stack 14's B3 failure is in `@y/prosemirror` / `lib0` and not in the spike's own code; `scratch/probe-atom-mark-change.ts` in each stack reproduces the difference.
   - Attribution: where the client-ID-to-user mapping is stored in each stack, that it survives a relay restart, and that forged IDs are flagged (note: flagged, not rejected; say whether the forged update is still applied).
   - Gate F in both stacks: the rebase runs on the relay while editors are connected, and the checks are the spike 2 gates A to D, not weaker versions. Stack 14 uses `lib0` `delta.diff` in place of spike 2's word diff; say whether its gate B still tests anchor survival under rewriting.
   - Stack 14 on Hocuspocus: a single `yjs` and `lib0` instance at runtime.
4. Check that every server the gates start binds to 127.0.0.1 and is killed on every exit path, and that nothing is left listening after your runs (`lsof -nP -iTCP:4200-4299 -sTCP:LISTEN`).
5. Write your findings, by severity (blocker, major, minor), in your log.

## Constraints

- Working directory for reading: `/Users/skk/code/phraise/.claude/worktrees/agent-a9ca7fc64553beeea`; your clone lives in your scratch directory. Absolute paths.
- Do not modify anything in the worktree except your own log. Do not commit. Do not launch further agents.
- Log: `context/logs/2026-09-27-reviewer-spike-5.md`, timestamps from `date` only.

## Handback, under 300 words

Clean-checkout result per stack; findings by severity with file and line; which claims you verified and how; anything left running (should be nothing).
