Status: done
Author: builder (Sonnet 5)
Updated: 2026-09-27
Plan: [spike 6 plan](../plans/2026-09-27-spike-6-plan.md) section 5; [brief 02](../plans/2026-09-27-spike-6-brief-02-git-storage.md)

All timestamps local machine time (CEST), from `date`.

## 16:41 — task received

Brief 02: build `src/git/` (GitStore) plus `src/testkit/remote.ts` and unit
tests, against local bare git repos. Read AGENTS.md, brief, plan sections 2
and 5, charter rules, spike-4 findings section D, existing package
(`README.md`, `package.json`, `src/testkit/*`, `test/import-boundary.test.ts`),
and the spike-3 daemon reference (`src/daemon/git.ts`, `src/testkit/temp-repo.ts`)
for subprocess-wrapper style.

## 16:45 — pre-implementation experiments (bash sandbox forbids compound git
commands, so these ran as a Node script under `os.tmpdir()`, not touching the
Phraise repo)

Two of the brief's stated git behaviours turned out not to hold, verified
with a throwaway script:

1. **Brief says "no `+` on the draft ref is fine for fetch since fetch into
   the cache mirrors the remote."** Tested: create draft1 (parent = base),
   fetch it into a fresh bare cache with a plain (no `+`) refspec — works.
   Then force-push draft2, a *sibling* of draft1 (same base, different
   content, as a real relay's second draft flush would produce), and fetch
   again with the same plain refspec: git rejects it
   `! [rejected] ... (non-fast-forward)`, exit 1, and the cache's local ref
   stays on draft1. **Deviation:** `fetch()` uses `+refs/phraise/drafts/<branch>:...`
   (force) for the draft ref. The branch ref is force-fetched too for
   symmetry/robustness (the cache is a disposable mirror, never a push
   target, so there is no lease/CAS reason to insist on fast-forward reads).
2. **A single `git fetch` with two explicit refspecs is all-or-nothing.**
   Fetching `refs/heads/<branch>` and `refs/phraise/drafts/<branch>` in one
   command when the draft ref does not yet exist on the remote (the normal
   "no draft written yet" case) fails the whole command
   (`fatal: couldn't find remote ref refs/phraise/drafts/<branch>`, exit 128)
   and **also leaves the branch ref unfetched**, even though that ref did
   exist and was fetchable. **Deviation:** `fetch()` issues two separate
   `git fetch` calls, one per ref. The branch-ref fetch failing is a real
   error (thrown). The draft-ref fetch failing with "couldn't find remote
   ref" is treated as "no draft" (not thrown); the local cached draft ref is
   then explicitly deleted (`update-ref -d`) so a previously-fetched, since-
   deleted draft can't be read back as if it still existed.

Both recorded as decisions below; will note them in `src/git/README.md` and
mention to the orchestrator in the handback.

## 16:48 — implementation and verification complete

Built, only adding new files (plus the three edits the brief allows):

- `src/git/gitProcess.ts` -- sandboxed `git`/`gitTolerant`/`gitBuffer` exec
  wrappers (`GIT_TERMINAL_PROMPT=0`, `GIT_CONFIG_GLOBAL=/dev/null`,
  `GIT_CONFIG_NOSYSTEM=1`, argument arrays, timeout, binary stdin/stdout).
- `src/git/plumbing.ts` -- `hashObject`, `buildTree` (scratch
  `GIT_INDEX_FILE` per call: `read-tree`/`update-index --add
  --cacheinfo`/`write-tree`), `commitTree` (author/committer via env).
- `src/git/index.ts` -- `GitStore`: `init`, `remoteHead`, `fetch`,
  `readFile`/`readBlob`, `commitInfo`, `changedPaths`, `isAncestor`,
  `writeDraft`, `readDraft`, `deleteDraft`, `commit`,
  `composeCommitMessage` (exported for a direct unit test of trailer
  dedup/exclusion).
- `src/git/README.md` -- API, the two deviations (below), what it may
  import.
- `src/testkit/remote.ts` -- `makeRemote`, `makeClone` (explicit
  path-by-path staging, never `add -A`/`add .`).
- `test/git.polling.test.ts`, `test/git.draft.test.ts`,
  `test/git.commit.test.ts` -- 15 tests covering every brief bullet:
  `remoteHead` sees a clone's push; a plain clone's `git fetch` +
  `git diff --name-only` of the draft ref lists exactly the Markdown path,
  no `.phraise/`, and `git diff` shows the changed lines; `readDraft`
  round-trips files and byte-identical (including 0x00/0xFF bytes) sidecar
  data; draft commit's first parent is `base`; stale/null-when-exists
  writeDraft rejections leave the remote draft unchanged, correct
  `expected` succeeds; `deleteDraft` lease behaviour; `commit` succeeds
  with the given author and trailers (verified independently via
  `composeCommitMessage` unit test and via a plain clone's
  `git log --format=%(trailers:key=Co-authored-by)`); `commit` after
  someone else pushed is rejected `stale`, branch unchanged; a `pgrep -x
  git` check that nothing is left running.
- Edited (as permitted): package `README.md` layout section for `src/git`
  and the new-files note; `src/testkit/README.md` for `remote.ts`;
  `test/import-boundary.test.ts` gained a test that `src/git` imports
  nothing (by relative specifier) that resolves into `src/crdt`.

Two deviations from the brief's stated fetch behaviour, found by
experiment (see 16:45 entry) and written up in `src/git/README.md`:
force-fetch (`+`) the draft ref (and, for symmetry/robustness, the branch
ref too), and fetch the branch ref and draft ref as two separate `git
fetch` calls rather than one call with two refspecs.

**Verified:**
- `npm run typecheck` -- clean, no errors.
- `npm test` -- 9 files, 26 tests, all pass (15 new git tests + 11
  pre-existing). Full output captured; no failures, no skips.
- `pgrep -x git` after the full suite -- exit 1 (no match): no leaked git
  process.
- `git status --porcelain` -- only new files under `src/git/`,
  `src/testkit/remote.ts`, the three new `test/git.*.test.ts` files, this
  log, and the brief itself (already present before this session) are
  untracked; the only modified tracked files are the three the brief
  permits (`README.md`, `src/testkit/README.md`,
  `test/import-boundary.test.ts`).

No blockers. Not committing per the brief. Handing back to the orchestrator.
