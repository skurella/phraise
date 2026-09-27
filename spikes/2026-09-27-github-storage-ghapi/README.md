# Spike 4: GitHub storage mechanics, `gh api` approach

Status: done (2026-09-27). Findings: [spike 4 findings](../../context/docs/2026-09-27-spike-4-findings-github-storage.md).
Charter: [spike 4 charter](../../context/plans/2026-09-27-spike-4-charter-github-storage.md).

## Goal

Measure, against the real repository `skurella/phraise`, the storage operations Phraise needs: drafts in hidden refs, attributed commits, race detection, change detection by polling, and the API cost of each.

## How it works

Bash over `gh api`, no dependencies beyond `gh`, `jq`, `perl`, `git`. The token stays in `gh`'s keyring; no script reads, prints or stores it. `lib.sh` is the only path to GitHub and enforces the charter's safety rules in code:

- repository fixed to `skurella/phraise`;
- writes only to `git/{blobs,trees,commits,refs}` and two fixed GraphQL mutations (`createCommitOnBranch`, `updateRefs`), matched by exact string;
- refs only under `refs/phraise-spike/` or `refs/heads/spike-scratch/github-storage-*`, checked on the URL and in the body;
- at most 300 writes, serial, at least 1.1 s apart; `git push` goes through the same counter;
- any 403 or 429 writes `.state/STOP` and every later call refuses to run.

Every call appends one line to `evidence/calls.jsonl`: gate, method, path, status, duration, rate-limit headers, ETag, request ID. Request headers are never recorded.

## Scripts

| Script | Writes | What |
|---|---|---|
| `selftest.sh` | 0, offline | 31 allow/deny cases for the safety allow-list |
| `run-nondestructive.sh` | 0 | **The single read-only command:** selftest, smoke, gate B snapshot, gate H retention check, cleanup dry run, `git ls-remote` of spike refs |
| `smoke.sh` | 0 | ETag 304 on `main`, GraphQL read |
| `introspect.sh` | 0 | GraphQL schema of the ref mutations |
| `gate-h-retention-probe.sh` | 4 once | Creates `refs/phraise-spike/retention-probe`; idempotent |
| `check-retention-probe.sh` | 0 | Later retention check: API and `git fetch` of the probe |
| `gate-a-hidden-ref.sh` | ~65 | Draft ref lifecycle, clone and refspec checks, delete |
| `gate-b-side-effects.sh <label>` | 0 | Snapshot of events, activity, Actions, notifications, hooks, rulesets; `compare` prints all |
| `gate-c-attributed-commit.sh` | 5 | REST Git Data vs GraphQL commit with two `Co-authored-by` trailers |
| `gate-d-race.sh` | ~15 | Stale-head writes on a branch and on a hidden ref, both routes plus `updateRefs` |
| `gate-e-polling.sh` | 7 | 304 cost, write-to-visible delay for GraphQL commits and `git push` |
| `gate-g-size.sh` | ~25 | 1 MB Markdown + 1 MB binary flush timing |
| `extra-git-push-flush.sh` | 4 to 5 | Draft flush as one `git push` with `--force-with-lease` CAS on a hidden ref |
| `cleanup.sh [--dry-run]` | 1 per ref | Deletes every spike ref except the retention probe, lists what remains |
| `gate-d-finish-first-run.sh` | 2 | One-off continuation of the first gate D run; kept for the record |

Gate F (cost model) is computed in the findings doc from the evidence of A, C, E and G.

## Run

```
./run-nondestructive.sh                 # read-only, safe any time
./gate-a-hidden-ref.sh                  # each write gate cleans up after itself except H
./cleanup.sh                            # afterwards, to be sure
```

Write gates refuse to start if their ref already exists. Scratch branches from C, D and E are left for `cleanup.sh`. State (write counter, STOP file, temp files) lives in `.state/`, which is git-ignored.
