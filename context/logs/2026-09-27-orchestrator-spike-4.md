# Log: spike 4 orchestrator, GitHub storage mechanics

Status: active
Author: spike orchestrator (Opus 5.5)
Updated: 2026-09-27
Related: [charter](../plans/2026-09-27-spike-4-charter-github-storage.md), [plan](../plans/2026-09-27-spike-4-plan.md)
Time zone: CEST (UTC+2), times from `date` on the owner's laptop.

Write-request counter: every POST/PATCH/PUT/DELETE and GraphQL mutation against GitHub goes through the wrapper in `spikes/2026-09-27-github-storage-ghapi/lib.sh`, which counts it in a state file; the running total is copied here at milestones.

## 04:05 — task received
Worktree `/Users/skk/code/phraise/.claude/worktrees/agent-a21d44af65d2993ac`, branch `spike/2026-09-27-github-storage` checked out at f142994. Read AGENTS.md, decisions, workflow, charter, platform constraints.

## 04:07 — environment
`gh` 2.96.0 logged in as `skurella` via keyring, OAuth token (scopes `gist, read:org, repo`; no `workflow`). Node 22.12.0, npm 11.0.0. Repo `skurella/phraise` is public; the token has admin permission, which we do not use. Core rate limit 5000/h, 0 used at start. Writes so far: 0.

## 04:08 — plan and safety wrapper
Plan written: [plan](../plans/2026-09-27-spike-4-plan.md). Approach: bash over `gh api` in `spikes/2026-09-27-github-storage-ghapi/`. `lib.sh` is the only path to GitHub and enforces the allow-list (repo, endpoints, ref prefixes), a 300-write cap, 1.1 s spacing, and a STOP file on any 403/429. Offline `selftest.sh`: 26 of 26 allow/deny cases pass. Decided to do the work myself; one Sonnet reviewer at the end.

## 04:10 — surprise: rate-limit headers are not one counter
`X-RateLimit-Used` on consecutive calls jumps between unrelated sequences (e.g. 34, 35, 36, then 5, then 37, then 1) with different `X-RateLimit-Reset` values, while `GET /rate_limit` reported used 0. Other spikes share this token, but they cannot explain a drop from 37 to 1. Working hypothesis: the primary limit is counted in several independent buckets. Consequence: a 304's cost must be measured statistically, not from one pair of calls.

## 04:10 — gate H done (4 writes)
Created `refs/phraise-spike/retention-probe` -> orphan commit af14d5fde4657306c05b3a3269ccdb2a9211a9d8, created 2026-09-27T02:10:20Z. Write classes: blob, tree, commit, ref create. Writes total: 4.

## 04:14 — gate B baseline, gate A done (65 writes)
Snapshot "before": 17 events, 0 Actions runs, 0 workflows, 0 hooks, 1 notification, 1 ruleset "main". Gate A: created a draft ref, 10 full overwrites (5 writes each), 3 inline-tree overwrites (3 writes each), then deleted it. Absent from the branches API and from a default clone; advertised by `git ls-remote`; fetched by explicit refspec with identical content; API read-back identical; DELETE 204, then GET ref 404, but the orphan commit is still readable by SHA (200). Snapshot "after": nothing changed. Write classes: blob, tree, commit, ref create, ref update (force), ref delete. Writes total: 69.

## 04:16 — GraphQL `updateRefs` found
Introspection (read-only) shows a GraphQL `updateRefs` mutation with `beforeOid`/`afterOid`/`force` per ref, atomic across refs, able to create (before = zeros) and delete (after = zeros). This is a true compare-and-swap for any ref, which REST lacks. Added it to the lib allow-list as a second fixed mutation string, with repository node ID and ref names validated; selftest now 31 of 31.

## 04:18 — gate C done (5 writes)
Scratch branch `spike-scratch/github-storage-c` from main. REST route: inline tree + commit + PATCH = 3 writes; author and committer both the owner, commit unsigned (`verified: false, reason: unsigned`). GraphQL `createCommitOnBranch`: 1 write; author the owner, committer `GitHub <noreply@github.com>` (web-flow), signed and verified. Both: GraphQL `Commit.authors` lists owner + 2 co-authors; the octocat noreply links to the `octocat` user, the example.com one has no user. Writes total: 74.

## 04:19 — gate D done (15 writes), one surprise
Branch: REST non-force PATCH with a stale parent -> 422 "Update is not a fast forward". `createCommitOnBranch` with stale `expectedHeadOid` -> 200 with error type `STALE_DATA`. `updateRefs` with stale `beforeOid` -> rejected, but only as an opaque "Something went wrong" error; the head was verified unchanged. **Surprise:** on a hidden ref, REST PATCH with `force=false` and a parentless non-descendant commit returned 200 and moved the ref: the fast-forward check does not protect refs outside `refs/heads/`. The first run's assertion stopped the script there; I finished its last two steps with `gate-d-finish-first-run.sh` (CAS delete, then 404) and changed the script to record instead of assert. Write classes added: GraphQL createCommitOnBranch, GraphQL updateRefs. Writes total: 89.

## 04:22 — gate E done (7 writes, of which 3 git pushes over SSH)
25 unconditional GETs of the branch ref raised `X-RateLimit-Used` by 24 within one bucket; 25 conditional GETs (all 304) raised it by 0. `GET /rate_limit` reported used 0 throughout, so it is useless for this. Write-to-visible: in 6 of 6 trials (3 GraphQL commits, 3 `git push`) the very first poll already returned the new head (upper bound 0.65 to 0.80 s after the write returned); the branches API also showed it on the first try. `git push` went through the same counter and spacing via `external_write`. Writes total: 96.

## 04:25 — gate G done (36 writes incl. one aborted run), gate B late snapshot
First G run aborted after one flush (bug: a flag set inside a subshell), second run stopped by SIGPIPE before any write, third run clean. 1 MB random Markdown + 1 MB random binary: full flush 10.1 to 13.2 s wall (includes 4 enforced 1.1 s gaps); 1 MB blob POST 1.4 to 3.9 s; inline-tree flush (2.46 MB tree request) 6.9 to 7.3 s; reading the 1 MB blob back 1.15 s. B "late": events and activity list CreateEvent/PushEvent/branch_creation for all three scratch branches within seconds; nothing for any `refs/phraise-spike/` write. No Actions runs, no workflows, no hooks, no new notifications. Writes total: 132.
