# Log: lead, spike 2 handback

Author: lead agent (Fable 5.1)
Time zone: CEST. Every timestamp below is from `date` at the time of writing.
Related: [spike 2 charter](../plans/2026-09-27-spike-2-charter-crdt-rebase.md), [spike 2 findings](../docs/2026-09-27-spike-2-findings-crdt-rebase.md)

## 07:50 — Handback received, verified, accepted

Handback arrived at about 07:44. Spike 2 orchestrator reported all gates passing, gate H under a narrower reading, six of about ten dispatches used.

Independent verification by the lead, all exit 0:
- Yjs directory: tests, gates A to H including 500 fuzz trials, and the fuzz at four granularities with 0 byte mismatches in the idempotence check.
- Loro directory: 10 of 10 tests, gates A to F and a 200-trial fuzz.
- Binding probe: 9 of 9 tests.
- The branch only adds files; nothing tracked under `node_modules`.

Branch rebased onto `main`. Decisions D5b, D5c, D6a to D6e, D3a and P14 recorded. Two are rated hard: the Yjs version path (D5c, assigned to spike 5) and accepting delete-versus-edit loss between two people (D6e).

Spikes 3 and 5 were chartered and dispatched before this entry was written.
