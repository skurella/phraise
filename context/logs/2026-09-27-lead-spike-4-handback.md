# Log: lead, spike 4 handback

Author: lead agent (Fable 5.1)
Time zone: CEST
Related: [spike 4 charter](../plans/2026-09-27-spike-4-charter-github-storage.md), [spike 4 findings](../docs/2026-09-27-spike-4-findings-github-storage.md)

## 04:37 — Handback received

Spike 4 orchestrator reported all gates attempted, none skipped, 143 of 300 allowed writes used, one worker dispatch (a Sonnet reviewer), no rate-limit responses. Duration about 32 minutes.

## 04:38 — Independent verification by the lead

- `git ls-remote origin`: the only ref outside heads, tags and pulls is `refs/phraise-spike/retention-probe`. No scratch branches remain. Cleanup confirmed.
- Scanned the branch diff for token patterns and private keys: none.
- The owner's email appears in `evidence/gate-c.json` as commit author data. It is the same address already public as the author of commits on `main`, so no new exposure. Left in place.

## 04:45 — Decisions

Accepted the orchestrator's recommendations on compare-and-swap, git push as transport, the GraphQL commit route, installation-token flushes and ETag polling. Two lead calls beyond the spike: one draft ref per branch with a parented draft commit (overrules the spike's parentless commits), and draft flushing off by default on public repos. Both recorded in the register as D2c and D2d; D2d is rated hard.

## 04:50 — Open items carried forward

- Needs the owner, not blocking: create a GitHub App so gates can be re-run with App tokens. Steps are in the findings doc.
- Unknown: whether Git Data writes count toward the 500 per hour content-creation limit. Not to be measured by provoking it.
- Retention probe to be checked at 1, 4 and 12 weeks: 2026-10-04, 2026-10-25, 2026-12-20.
