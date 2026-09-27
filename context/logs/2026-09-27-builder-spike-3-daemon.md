# Builder log: spike 3 daemon (brief 02)

Status: in progress
Author: builder (Sonnet 5)
Updated: 2026-09-27
Plan: [spike 3 plan](../plans/2026-09-27-spike-3-plan.md)
Brief: [brief 02](../plans/2026-09-27-spike-3-brief-02-daemon.md)
Timezone: local machine time as printed by `date` (system local time zone)

## 08:50 — task received

Read AGENTS.md, brief 02, plan sections 2/4/5 (and 3 for context), and the charter's
"Rules for every agent in this spike". Inspected existing spike code from brief 01:
src/core/docsync.ts, src/core/versions.ts, src/core/diff.ts, src/testkit/remote-editor.ts,
src/testkit/tokens.ts, test/helpers.ts, src/md/*. Inspected @hocuspocus/server and
@hocuspocus/provider .d.ts and .esm.js (for Server.listen/destroy behavior; noted
`stopOnSignals` defaults to true, which must be disabled for the relay so tests/daemons
control their own lifecycle and so many relays in one process don't each install a
process.exit(0)-on-SIGINT/SIGTERM handler).

Plan: implement in order (1) src/relay/relay.ts + src/relay/cli.ts, (2) testkit additions
(temp-repo, remote-client, save-styles, wait-for), (3) src/daemon/git.ts, (4)
src/daemon/daemon.ts, (5) src/daemon/cli.ts, (6) integration tests test/daemon.*.test.ts +
vitest.config.ts, (7) three consecutive clean vitest runs, fixing any flakes found.

Key design decision for restart (gate H) and git-rebase (gate G row 3): DocSync's
version ring is private, but `importText(text, {author, base})` accepts an explicit
`Version` object as `base` without requiring it to be in the ring. This lets the daemon
reconstruct a persisted/last-known version manually (a decoded `Y.Snapshot` plus text)
and pass it directly as `base`, so no changes to src/core/*.ts are needed for restart or
for git-driven rebase.
