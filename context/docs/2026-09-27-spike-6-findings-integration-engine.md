# Spike 6 findings: integration, the headless engine

Status: in progress (milestones 1 and 2 done; 3 and 4 pending)
Author: spike 6 orchestrator (Opus 5.5)
Updated: 2026-09-27
Charter: [spike 6 charter](../plans/2026-09-27-spike-6-charter-integration-engine.md). Plan: [spike 6 plan](../plans/2026-09-27-spike-6-plan.md). Log: [orchestrator log](../logs/2026-09-27-orchestrator-spike-6.md).
Code: [`spikes/2026-09-27-integration-engine/`](../../spikes/2026-09-27-integration-engine/README.md)

## Gate results so far

Full `npm run gates` by the orchestrator at 21:20 CEST, exit 0.

| Gate | Result | Numbers |
|---|---|---|
| A. Open | pass | Relay state 830 B, byte-identical to an independent deterministic seed; two editors serialize byte-identically to the file. |
| B. Edit and attribution | pass | Ranges listed per user; 2 forged updates rejected (an update message and a sync-step-2 message), not applied, connection closed. |
| C. Comments | pass | Create, reply, resolve, list; other user's edits in and around quotes; orphan with quote kept. |
| D. Drafts | pass | `git diff --name-only <branch> <draft>` lists only the edited Markdown; restore from the draft ref with a deleted relay store keeps text, comments and attribution; stale flush rejected by the lease. |
| E. Commit | pass | Author and `Co-authored-by` trailers correct; 50 corpus files, 94 edits, 0 changed lines outside edited blocks. |
| F. External commit | pass | Rebase while typing, converged, flags only on the block changed on both sides, comments survive or orphan, commit after head moved rebases first. Rebase latency 712 ms (push to all replicas converged, 250 ms poll). |
| G. Offline return | pass | Two variants; offline edits in changed, deleted and untouched blocks all kept; deleted block resurrected once and flagged; offline author credited in the next commit. |
| H. Serializer and parser | pass | Spike 1 gate A 294/294 (A2, A3b 294/294), gate B 293/293 files, 1465/1465 edits; footnote-continuation fix; 0 numeric references in 200 concurrent-formatting cases (78 with a mark boundary on a space). |

Milestones 3 and 4 (gates I to M): not yet run.

## Defects found by review and fixed

- Forged updates sent as sync step 2 bypassed the check (milestone 1 review). Fixed with a clock rule for every message type.
- Edits landing while a commit was being pushed became part of the stored base snapshot; their author lost co-author credit and a later rebase could drop them without a flag (milestone 2 review). Fixed by extending the prepare-time snapshot with only the commit's own metadata transaction.
- Per-update attribution entries grew the document by 33.8 MB over 2,000 keystrokes; coalesced to 78 KB.
