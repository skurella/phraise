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

## 09:45 — tasks 1, 2, 3, 4, 6 (gates A-G) done and committed (e986459)

Implemented, in order: src/relay/relay.ts + src/relay/cli.ts (task 1);
testkit additions makeTempRepo/RemoteClient/save-styles/waitFor (task 2);
src/daemon/git.ts (task 4's read side); src/daemon/daemon.ts (task 3, wired
against task 4's git.ts); src/daemon/cli.ts (task 5); integration tests for
gates A-G (task 6, partial: H still to do).

`npx tsc --noEmit` clean. `npx vitest run` (all 11 test files, 28 tests):
passing repeatedly (checked 3 consecutive full runs of test/daemon.g-git.test.ts
specifically, since it was the flaky one, plus one full-suite run).

### Two real bugs found while making gate G deterministic

1. **Export bypassed git-awareness on a stale-read race.** `runExport`'s guard
   (plan 4.2's "if disk != lastKnown: enqueue import") called
   `processExternalSave(disk)` directly, which imports as an ordinary local
   edit with no `reconcileGit` call at all. Reproduced with: a rebase-import
   completes for one commit, `scheduleExport()` fires per the plan, and
   `git reset --hard` lands *during* that export's guarded read. The export
   sees "disk changed since last read" and imports the reverted content as a
   plain local edit (updating `lastKnown` to match) *before* the next
   `reconcileGit` call ever compares git state -- so gate G's own
   `reconcileGit` correctly sees `fileChanged: false` (the import already
   absorbed it) and records the new HEAD as "harmless", never detaching.
   Root cause: plan 4.2 and 4.5 were specified independently and their
   interaction wasn't addressed. Fix: that branch now calls
   `this.scheduleSettle()` instead, so the save goes through the same
   git-aware pipeline as every other file change. (The narrower
   "in-place writer raced our rename" branch still imports its captured
   fd-snapshot bytes directly, per the plan's own pseudocode -- I judged
   that one lower risk and left it as specified; noted as an open risk
   below.)

2. **`.git/index.lock` is invisible to `fs.watch` for a fast git command.**
   Measured directly: creating and removing `index.lock` 400ms apart, the
   `fs.watch(.git)` callback for it fired *once*, 15ms after the removal
   (macOS FSEvents coalesced the create+delete into one notification
   delivered only after both had happened). A real `git checkout -- file`
   on a tiny repo holds the lock for far less than 400ms, so watch-based
   detection cannot see it at all in practice; only a plain, phase-aligned
   poll tick landing during the hold window can. Fixed two ways: (a)
   `isIndexLocked()` is now checked on every raw watcher/poll signal (not
   only once when the settle debounce finally fires), narrowing the miss
   window to "no poll or watch event happened to land inside the hold";
   (b) discovered in the process, a *second*, distinct race: a git ref
   update (e.g. `refs/heads/<branch>`) is a separate lock from
   `.git/index.lock` and can land a moment after the index lock clears
   (measured with `git reset --hard`: file already reverted and
   `index.lock` gone, but the ref not yet rewritten) -- added one extra
   settle-length grace period after the lock is first seen gone before
   finalizing the git-state comparison.

Test-side consequence: gate G row 6 now holds the simulated lock for 400ms
with `gitPollMs` overridden short enough that at least one poll tick is
guaranteed inside the hold window regardless of phase (pigeonhole: hold
duration > poll period), rather than depending on watch delivery timing at
all. Gate G row 4/row 5 needed a similar fix on the *test* side: waiting for
`readFileSync(...).includes(token)` before a second git operation is
trivially true the instant the test writes those bytes itself, so it proved
nothing about whether the daemon had actually processed the first git
change -- a second op (reset/stash) landing inside the same settle window as
the first can revert net-to-nothing and the daemon correctly reports no
change at all. Fixed by waiting for `daemon.docSync.render()` to actually
reflect the change before proceeding.

### Open risk carried into gate H / findings

- The "in-place writer raced our rename" export branch still imports
  directly without a git check (see bug 1's fix note). Narrower window
  (microseconds between stat and rename) and matches the plan's literal
  pseudocode, but the same class of misattribution is theoretically
  possible there too. Left as-is; flagging for the findings doc.
- `fs.watch(.git)` (non-recursive) cannot observe `.git/refs/heads/**`
  directly (a subdirectory); detection of ref changes on a *quiescent*
  repository (no other trigger) relies entirely on the `gitPollMs` poll
  (default 500ms). This matches plan 4.5's own "or poll every 500ms
  (builder's choice)" wording, so treated as within spec, not a bug -- but
  worth calling out explicitly in the findings doc as the reason detach/
  rebase latency has a ~500ms floor when nothing else about the file
  changed.

Next: gate H (restart, persistence, CLI SIGKILL variant), then three clean
full-suite runs, then the findings doc is the orchestrator's job per the
charter ("long verification runs belong to the orchestrator").

## 09:49 — task 6 gate H, and task 7 (three clean runs) done

test/daemon.h-restart.test.ts: three tests --
1. Stop, edit both sides (remote via RemoteClient, local via direct
   writeFile), start a *fresh* `Daemon` instance (new object, same
   repoDir/file/docName/relayUrl/stateDir) pointed at the same relay:
   merges both edits, file equals the merged render. Passed first try.
2. Stop, delete the state directory, edit the file, start a fresh instance:
   conflict copy beside the file (containing the CRDT's render with the
   token only the CRDT had), original file byte-for-byte untouched,
   `detach` and `conflict` events fired, `status().detached === true`.
   Passed first try.
3. CLI variant: spawn `src/daemon/cli.ts` via the local `tsx` bin (not
   `npx tsx`, to avoid npx's own resolution overhead per spawn) as a real
   child process, wait for its `{"event":"started"}` JSON line, SIGKILL it,
   edit both sides, respawn, wait for the merged content to land in the
   file. Passed first try.

`npx tsc --noEmit`: clean. `npx vitest run` (all 12 test files, 31 tests):
three consecutive full runs, all green (~14s each). After the run:
`lsof -iTCP:4100-4199 -sTCP:LISTEN` prints nothing and no daemon/cli
process remains (checked via `ps aux`).

## Summary for handback

Tasks 1-7 of brief 02 all done: relay, testkit, daemon runtime (file<->CRDT
sync, git-underneath handling, persistence/restart), both CLIs, and
integration tests for every named gate (A-H) plus the negative control and
the CLI SIGKILL variant, three clean full-suite runs.

Deviations from a literal reading of the plan, both already covered above
and worth restating for the handback:
- plan 3.2/4.2's version ring and `recordWrite` are used to derive the
  daemon's restart base, rather than a new core API: a manually
  reconstructed `Version` (decoded snapshot + text, `origin: 'restore'`) is
  passed as `importText`'s explicit `base` option, which the core already
  supports. No changes to src/core/*.ts were needed.
- runExport's stale-read guard branch was changed from "import directly" to
  "defer to the settle pipeline", to close the git-awareness gap described
  above (bug 1). This is a deviation from the plan 4.2 pseudocode's literal
  "enqueue import" wording, in favor of routing through the SAME pipeline
  that already knows about plan 4.5's git checks, since the two sections
  were specified independently of each other.
- The "in-place writer raced our rename" branch (the other reference to
  "enqueue import" in 4.2) was left importing directly, per the plan's
  literal pseudocode, since it has captured bytes that cannot be re-read
  through the ordinary pipeline; flagged as an open risk above for the
  same (rarer) class of misattribution.

Nothing from the brief's task list is missing. The `gates/` harness (spike
section 6's 100-300-trial volume/timing studies) is out of scope for this
brief per its own task 6 wording (functional correctness at modest N, not
the full statistical gate measurement) and per the charter's "long
verification runs belong to the orchestrator".
