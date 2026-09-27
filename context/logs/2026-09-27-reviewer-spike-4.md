# Log: fresh-context review of spike 4

Status: done
Author: reviewer (Sonnet)
Updated: 2026-09-27
Related: [brief](../plans/2026-09-27-spike-4-brief-review.md), [charter](../plans/2026-09-27-spike-4-charter-github-storage.md), [findings](../docs/2026-09-27-spike-4-findings-github-storage.md)

Time zone: Europe (CEST), from `date`.

## 04:31 — task received

Read AGENTS.md, the brief, and the charter's Hard safety rules. Scope: audit `lib.sh` and every script in `spikes/2026-09-27-github-storage-ghapi/` for safety-rule bypass, and check every number/claim in the findings doc against `evidence/`. No writes to GitHub permitted.

## 04:32 — read lib.sh and all *.sh

Read `lib.sh`, `gate-a-hidden-ref.sh`, `gate-b-side-effects.sh`, `gate-c-attributed-commit.sh`, `gate-d-race.sh`, `gate-d-finish-first-run.sh` (not executed), `gate-e-polling.sh`, `gate-g-size.sh`, `gate-h-retention-probe.sh`, `extra-git-push-flush.sh`, `cleanup.sh`, `run-nondestructive.sh`, `selftest.sh`, `smoke.sh`, `introspect.sh`, `check-retention-probe.sh`.

`lib.sh`'s `call()` enforces: ref allow-list (`ref_allowed`, denies `..`, `//`, anything outside `refs/phraise-spike/?*` or `refs/heads/spike-scratch/github-storage-?*`), `validate_write` restricting POST/PATCH/DELETE to the fixed Git Data routes and the two named GraphQL mutations (matched by exact string), write cap `MAX_WRITES=300` checked before every write, `MIN_GAP=1.1` enforced by sleeping the shortfall, and a `STOP` file written and checked (`check_stop`) on any 403/429 — later calls hard-exit 99. Reads are also restricted to `repos/$REPO*`, `graphql`, `rate_limit`, `notifications*`, `user`. No path found that reaches the GitHub API other than through `call()`.

Two scripts (`extra-git-push-flush.sh`, `gate-e-polling.sh`) push over SSH `git push`, which bypasses `call()` by design (git protocol, not `gh api`) — each defines its own `external_write()` that duplicates the ref allow-list check, the write cap, and the 1.1 s spacing against the same shared `$STATE_DIR`, so the global budget and spacing hold across both paths. `external_write()` cannot detect an HTTP 403/429 (git-over-SSH has no such status), so the charter's "stop at first 403/429" has no direct equivalent there — noted as a minor gap, not a rule violation, since GitHub's abuse response for git transport is a different mechanism this spike didn't need to model.

## 04:33 — checked evidence for actual rule compliance

- `calls.jsonl`: 326 lines, 133 writes, 0 occurrences of status 403/429. Consecutive write timestamps never closer than the enforced 1.1 s gap (second-resolution check, 0 violations).
- Total writes across all mechanisms (133 API + 4 `extra-git-push.jsonl` + 3 `extra-git-push-run1-plus-refspec.jsonl` + 3 gate-E git-push trials) = 143, matching the findings doc's "143 writes in total" exactly. Well under the 300 cap.
- `gate-b-*.json`: hidden-ref writes (gates A, D, G, H, the git-push extra) never appear in Events/Activity, even in the `final` snapshot taken after the git-push experiment — verified by reading the actual event/activity arrays, which list only `spike-scratch/github-storage-{c,d,e}` entries.
- Ran `./selftest.sh`: 31 passed, 0 failed (offline, no network).
- Ran `./run-nondestructive.sh` once: selftest, smoke (etag 304, GraphQL read), gate B snapshot, gate H retention check, cleanup `--dry-run`, and `git ls-remote` — all read-only. Confirmed afterward that `calls.jsonl`'s write count was still 133 (unchanged), so my run added no writes.
- `run-nondestructive.sh`'s own read-only run confirms only `refs/phraise-spike/retention-probe` remains on the remote, matching the findings doc's Cleanup section.

## 04:35 — cross-checked findings doc numbers against evidence

Verified: gate A per-call medians (blob 662ms/22, tree 651ms/14, commit 690ms/14, PATCH 957ms/13, POST 902ms/1, DELETE 809ms/1) against `calls.jsonl` — all exact under an upper-median convention. Gate A summary fields (branches API 0 matches, clone has no draft commit, ls-remote advertises then stops, API readback byte-identical, commit still GET-able by SHA after ref delete) match `gate-a-summary.json` exactly. Gate C signature/committer claims (REST unsigned/Seb Kurella, GraphQL signed/valid/web-flow) match `gate-c.json` exactly. Gate D case-by-case table matches `gate-d.jsonl` exactly, including the flagged "no CAS on hidden-ref REST PATCH" (200, not 422). Gate E rate-limit-cost and write-to-visible-delay numbers match `gate-e.json` exactly (24-point rise over 25 unconditional GETs vs 0 over 25 conditional; 6/6 trials first-poll). Gate G wall-clock numbers match `gate-g.jsonl` exactly; blob POST range/median match `gate-g-calls.json`. Gate H probe SHAs match `gate-h-probe.json` and were independently re-verified live via `check-retention-probe.sh`.

Token grep: `grep -rnE "gho_|ghp_|github_pat_|Authorization" spikes/2026-09-27-github-storage-ghapi context` returned only the brief and charter text that *describes* the rule, no actual token or Authorization header value anywhere.

## 04:36 — handback

No blockers found. Handing back to the orchestrator now.
