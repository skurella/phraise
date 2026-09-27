Status: in-progress
Author: builder (Sonnet 5), spike 3
Updated: 2026-09-27
Plan: [brief 03](../plans/2026-09-27-spike-3-brief-03-gates-fuzz.md), [spike 3 plan](../plans/2026-09-27-spike-3-plan.md), [charter](../plans/2026-09-27-spike-3-charter-daemon-file-sync.md)

Local time zone: CEST (Europe, UTC+2). Timestamps from `date`.

## 09:56 — task received

Read AGENTS.md, brief 03, charter rules + gate table, plan section 6. Explored
existing spike code: `src/daemon/daemon.ts`, `src/relay/relay.ts`, `src/core/docsync.ts`,
`src/core/versions.ts`, `src/daemon/git.ts`, `src/testkit/*`, `test/daemon-helpers.ts`,
`test/helpers.ts`, all `test/daemon.*.test.ts` (reusing their scenarios), and
`gates/f-roundtrip.ts` (gate F core, already done).

Baseline before any change: `npx tsc --noEmit` clean, `npx vitest run` 32/32 passing.

Plan: build `gates/lib/` (prng, fixture re-export, quiesce, report), gates A-E/G/H as
functions, `gates/fuzz.ts` (gate I), `gates/index.ts` wiring everything with `--quick`.

## 10:10 — tasks 1-4 committed

Built:
- `gates/lib/{prng,fixture,quiesce,types,blocks,stats,report,fuzz-doc,fuzz-edits}.ts`.
- Added `Daemon#idle` (queue-depth counter + the three debounce timers) to `src/daemon/daemon.ts`
  so `quiesce()` has something real to poll instead of a guessed sleep. Bug-fix-adjacent, small,
  logged here per the brief.
- `gates/fixture.ts` re-exports `test/daemon-helpers.ts`'s `setupFixture` rather than
  duplicating it: that file has no vitest dependency, so it works unchanged outside vitest.
- Gates A-H as `runGateX(opts)`, sized per plan section 6; D, G, H reuse the scenarios from
  `test/daemon.d-stale-save.test.ts` / `daemon.g-git.test.ts` / `daemon.h-restart*.test.ts` per
  the brief's explicit instruction to do so. F combines `gates/f-roundtrip.ts`'s core numbers
  (run as a child process) with a daemon-level "no re-fight" check reused from
  `test/daemon.f-no-refight.test.ts`.
- Gate I (`gates/fuzz.ts` + `gates/i.ts`): seeded trial with a plain-string local "editor"
  buffer and the real `RemoteEditor` for the remote actor. Concurrency rule for
  delete-vs-edit vs lost is documented at the top of `gates/fuzz.ts` (only remote does
  whole-block deletes in this harness, so only a local-inserted token gets the benefit of the
  doubt when a remote whole-block delete happened at/after its insertion step; this is
  deliberately coarse, not paragraph-identity-exact, as the brief allows ("decide concurrency
  conservatively")).
- `gates/index.ts` runs A-I plus a placeholder J row ("see brief 04"), writes
  `results/gates.md` / `.json`.

Verified before commit: `npx tsc --noEmit` clean, `npx vitest run` 32/32 passing (no
regressions from the `Daemon#idle` addition). Committed as 410c6d4.

Next: run `npm run gates:quick`, diagnose and fix real failures, log each one.

## 10:34 — first `gates:quick` run, real failures diagnosed

First `npx tsx gates/index.ts --quick` run: A FAIL, I FAIL, everything else PASS (see
run log excerpt below). Diagnosed each:

1. **Gate A, harness bug (fixed).** `gates/a.ts` assumed the edited paragraph was
   top-level block index 0. Wrong: `RemoteEditor.replaceWord`'s first argument indexes
   PARAGRAPH nodes only, while `topLevelBlocks()` indexes every top-level block including
   the `# Corpus doc` heading -- paragraph 0 is top-level block 1. Fixed by learning the
   touched index from round 0 instead of hardcoding it.

2. **Gate H CLI case, orphaned grandchild process (fixed, gates/h.ts only).** The
   cli-sigkill case left a real daemon process running after the whole `gates:quick` run
   finished (found via `ps`, PPID 1, matched fixture #39 = gate H's 4th case). Root cause,
   confirmed with a minimal repro script: `node_modules/.bin/tsx` is a wrapper that spawns
   a SEPARATE node process (with the actual `--require`/`--import` loader flags) to run the
   target script -- a different pid, not the same process re-exec'd. `SIGTERM` to the
   wrapper is forwarded to that grandchild by tsx itself (confirmed by repro), but
   `SIGKILL` gives the wrapper no chance to forward anything: the kernel kills it
   instantly, orphaning the grandchild (the actual daemon process this "crash" case
   exists to kill). Fixed by spawning with `detached: true` and signaling the whole
   process group (`process.kill(-pid, signal)`) instead of just the one pid. This is the
   SAME pattern `test/daemon.h-restart.test.ts`'s own CLI variant test uses, so it likely
   has the same latent leak; out of scope to fix there (not this brief's file to edit),
   flagging for the lead/orchestrator.

3. **Gate I, real design-level finding (NOT fixed, reported below).** See "Finding:
   stale-buffer base selection can silently drop or resurrect concurrent edits".

Also fixed one harness-only bug in `gates/fuzz.ts` itself: `client.synced()` only means
the client's OWN handshake with the relay finished, not that the daemon's `adopt()`
update (sent over a separate websocket slightly earlier) has already arrived and been
rebroadcast. Losing that race left the client's Y.Doc fragment briefly empty at trial
start -- schema-invalid (`doc` requires `block+`), so the very first `currentDoc()` call
threw `RangeError: Invalid content for node doc: <>`. Fixed by calling `quiesce()` (real
state-vector equality) right after `client.synced()`, before the step loop starts.
Verified: seed 439041102 failed with this exact exception 2 of 6 tries before the fix,
0 of 10 tries after.

## Finding: stale-buffer base selection can silently drop or resurrect concurrent edits

Not fixed -- this is a core-algorithm question (`chooseBase` in
`src/core/versions.ts`), not a small clear fix, per the brief's "stop and report" guidance.

**Reproducing seeds (deterministic, not timing-flaky):**
`npx tsx gates/fuzz.ts --trials 1 --seed 439041105` -- 3 tokens lost, every time.
`npx tsx gates/fuzz.ts --trials 1 --seed 439041110` -- 1 token lost, every time.
(Seed 439041102 also reproduces this family but is timing-sensitive -- reruns sometimes pass.)

**Mechanism**, confirmed by temporarily instrumenting `DocSync.importText` to log the
chosen base's origin/cost against every candidate (reverted after use, not committed):
`chooseBase` picks whichever ring candidate has the lowest `diffCost` against the new
saved text, ties going to the newest. A `write`-origin version (recorded whenever the
daemon exports a REMOTE change to disk) is a normal, eligible candidate. When the
simulated editor's own buffer is stale by only a little (its own pending edit is small),
a `write` version capturing a remote change that landed in between is very often
textually closer to the editor's new save than the true anchor is -- especially once
the remote change itself was small. `chooseBase` then picks that newer, remote-updated
version as the base. From that base's perspective, the (unaware) stale editor's save
"doesn't have" the remote's token -- indistinguishable, by text alone, from the editor
having deleted it. The diff applies that as a real deletion. Symmetric case observed too
(seed 439041130): a real local deletion gets ignored ("resurrected") when the chosen
base predates the insertion the delete was targeting.

This is not a rare edge case in the fuzz results: of 60 trials, 38 failed with `lost`
and/or `resurrected` (61 lost-token instances, 12 resurrected). Gate D's own scripted
test passes because in that specific scenario the true anchor is *unambiguously*
cheaper (reverting two whole remote diffs costs more than the one small local edit), so
`chooseBase`'s heuristic happens to land correctly there; it is not guaranteed to in
general, and the fuzz found the general case.

Recommendation for the orchestrator/lead: this is a real limitation of pure
text-similarity base selection and worth a design conversation for D7 (see the findings
doc) -- e.g. whether the daemon should track the editor's actual last-known-read version
explicitly (a real editor could report it, unlike this synthetic harness) rather than
inferring it from text similarity alone. Note this is not a purely academic corner case:
it is the SAME scenario gate D's own requirement covers ("an editor saves a buffer based
on an older version... the remote edits are not reverted"), just with more accumulated
history than gate D's own scripted 2-remote-edit case -- gate D's test passes because in
that specific scenario the true anchor happens to be unambiguously cheaper, not because
the underlying mechanism is robust in general.

## 10:36 — re-verified after fixes, tasks 5-6 done

Re-ran `npm run gates:quick`: A-H all PASS (numbers below), I FAILS on the design-level
finding above (not worked around, per the brief's own instruction). This is the deliberate
stopping point for task 5.

Quick-gate numbers (this run):
- A: 20/20, latency median 38ms / p95 46ms.
- B: 10/style; in-place median 80ms/p95 106ms, rename-over 96ms/116ms, truncate-then-write 100ms/111ms.
- C: 20 rounds, 0 echoes, 0 imports-of-own-bytes.
- D: 10/10 cases.
- E: 10/10 cases.
- F: 30 corpus files (quick), pass rate 100%, 5 coarse-textblock fallbacks, 0 repairs, 0 forks; daemon-level no-refight also clean.
- G: 8/8 rows (harmless commit, branch-changed detach, fast-forward rebase, non-ff reset detach, stash detach, index.lock detach, reattach, negative control).
- H: 4/4 cases (persisted-base merge, conflict-on-deleted-state, restart-no-changes-then-save, CLI SIGKILL variant).
- I: 30 trials, 13 passed; exception=5, fileNotRender=2, lost=19, deleteVsEdit=1, resurrected=6, echo=0, detach=0. forks=80, coarseTextblocks=0, repairs=0, noops=3.

Task 6, `npx tsx gates/fuzz.ts --trials 60` (once, as instructed): 23/60 passed.
Categories: exception=6, divergence=0, fileNotRender=3, lost=60, deleteVsEdit=1,
resurrected=13, echo=0, detach=0. Import counters: forks=172, coarseTextblocks=0,
repairs=0, noops=4. Every `exception` inspected resolves to `UnverifiedSerializationError`
(daemon `error` event) on real, richly-formatted corpus READMEs -- an accepted, expected
outcome per gate F's own pass-rate characteristic and per the brief's own category
definition ("exception ... including unverified serialization"), not a new bug. The
`lost`/`resurrected`/`file-not-render` majority is the one finding above.

Verified clean after every run in this session (gates:quick x2, fuzz --trials 60 x2,
repro loops): `ps aux` shows no lingering `tsx`/daemon/cli process, `lsof` shows nothing
listening on 4100-4199.

`npx tsc --noEmit` and `npx vitest run` (32/32) both still pass after all changes.

Handback follows.
