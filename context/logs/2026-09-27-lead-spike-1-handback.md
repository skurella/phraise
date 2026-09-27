# Log: lead, spike 1 handback

Author: lead agent (Fable 5.1)
Time zone: CEST
Related: [spike 1 charter](../plans/2026-09-27-spike-1-charter-markdown-round-trip.md), [spike 1 findings](../docs/2026-09-27-spike-1-findings-markdown-round-trip.md)

## 06:28 — Handback received

Spike 1 orchestrator reported every gate passing, five of about eight worker dispatches used, about three hours twenty minutes elapsed. One approach built; no second approach because the first passed.

## 06:30 — Independent verification by the lead

- `npm test`: 22 of 22 pass.
- No third-party corpus files and no `node_modules` tracked. Manifest, fetch script and 28 hand-written cases only.
- `npm run gates` re-run by the lead: exit 0 in 374 s. Gate A 294 of 294 corpus files, gate B 293 of 293 files and 1465 of 1465 edits, gates C and D pass, gate E 145 files. Plain y-prosemirror round trip 1473 of 1621, with 136 files losing marks on inline leaf nodes and 8 losing root attributes.

## 06:31 — D5 finding forwarded to spike 2

Sent the y-prosemirror data-loss finding to the spike 2 orchestrator with a request to reproduce it, test loro-prosemirror and the Yjs 14 binding, and recommend a fix with costs.

## 06:40 — Branch rebased onto main

`git rebase --onto origin/main 2290d68`, 24 commits, no conflicts. The branch had been based on the unmerged bootstrap branch.

## 06:45 — Decisions

D4 confirmed and amended (D4a). D10b confirmed (D10c). D5 reopened (D5a). One lead call beyond the spike, rated hard: the library refuses unverified output, but the product must not fail a save; the block is surfaced as source for confirmation (D4b). The orchestrator's rows S1-1 to S1-8 moved into their own section of the register so that open PRs do not conflict.

## Lessons for future charters

- Two Sonnet builders ran out of session before committing their gate results. Builders must commit results incrementally and gate runs must write partial results to disk.
- The Haiku grinder's claim that every corpus licence was permissive was wrong for 25 of 280 entries. Claims about licences and other facts with consequences are verified by the orchestrator, as happened here.
- Parallel spikes must not edit the register; spike 1 predates that rule.
