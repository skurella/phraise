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
