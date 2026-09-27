# Spike 4 findings: GitHub storage mechanics

Status: active
Author: spike 4 orchestrator (Opus 5.5)
Updated: 2026-09-27
Serves: D2, D6, D9 in [architecture decisions](2026-09-27-architecture-decisions.md). Charter: [spike 4 charter](../plans/2026-09-27-spike-4-charter-github-storage.md). Log: [orchestrator log](../logs/2026-09-27-orchestrator-spike-4.md).
Code and raw evidence: [`spikes/2026-09-27-github-storage-ghapi/`](../../spikes/2026-09-27-github-storage-ghapi/README.md), every call in `evidence/calls.jsonl`.

All measurements were taken on 2026-09-27 between 04:09 and 04:30 CEST against the public repository `skurella/phraise`, with the owner's `gh` OAuth token (scopes `gist, read:org, repo`), from a laptop in Europe (GitHub edge `fra`). 143 writes in total, all serial and at least 1.1 s apart. No 403 or 429 was ever returned.

## Summary

Hidden refs behave as D2 assumes: invisible to the branches API, to default clones, to the Events and Activity APIs and to Actions, yet fetchable by refspec and readable through the Git Data API. Three things D2 does not yet account for:

1. **The REST ref update has no compare-and-swap for hidden refs.** `PATCH /git/refs/...` with `force: false` refuses non-fast-forward updates only on branches. On `refs/phraise-spike/...` it moved the ref to an unrelated parentless commit and returned 200. Safe draft writes need GraphQL `updateRefs` (`beforeOid`) or `git push --force-with-lease`; both were shown to reject stale writers.
2. **Drafts in a public repo are public.** An anonymous `git fetch` of the hidden ref returned the full draft. `git ls-remote` advertises every draft ref name to anyone. Objects of a deleted draft stayed readable by SHA through the API.
3. **Write budget.** A REST draft flush costs 3 to 5 writes. If GitHub counts Git Data writes against the secondary limit of 500 content-creating requests per hour (undocumented either way, and not something we could test without provoking it), one token sustains only about 2 to 3 documents at a one-minute cadence. One `git push` does the whole flush, with CAS, in one request, and it was 2 to 3 times faster for 2 MB.

## Gate results

| Gate | Result | Key numbers |
|---|---|---|
| A. Hidden ref lifecycle | **Pass** | Create + 10 full overwrites + 3 inline-tree overwrites, read, delete. Absent from branches API and default clone; advertised by `ls-remote`; refspec fetch identical. Full flush 5 writes, 8.4 to 9.4 s wall; inline flush 3 writes, 5.1 to 6.2 s wall (both include the enforced 1.1 s gaps). |
| B. Side effects | **Pass, with limits** | Hidden-ref writes: no events, no activity entries, no Actions runs, no notifications. Scratch-branch writes: CreateEvent, PushEvent, DeleteEvent and activity entries within seconds. Webhook deliveries could not be observed (no hooks, and creating one is out of scope). |
| C. Attributed commit | **Pass** | REST: 3 writes, author and committer = the user, **unsigned**. GraphQL `createCommitOnBranch`: 1 write, author = the user, committer = `GitHub` (web-flow), **signed and verified**. Both parse both `Co-authored-by` trailers into `Commit.authors`. |
| D. Race detection | **Pass on branches; REST fails on hidden refs** | REST PATCH stale on branch: 422 "Update is not a fast forward". GraphQL stale `expectedHeadOid`: error type `STALE_DATA`. `updateRefs` stale `beforeOid`: rejected, but with an opaque error. REST PATCH on hidden ref: **no protection** (200). `git push --force-with-lease` stale: rejected "stale info". |
| E. Polling | **Pass** | 25 unconditional GETs raised `X-RateLimit-Used` by 24; 25 conditional GETs returning 304 raised it by 0. Write to visible: first poll saw the new head in 6 of 6 trials, upper bound 0.65 to 0.80 s. |
| F. Cost model | **Done, one unknown** | See below. Binding constraint is the secondary content-creation limit, if it applies to Git Data writes. |
| G. Size | **Pass** | 1 MB random Markdown + 1 MB random binary: REST full flush 10.1 to 13.2 s wall; one 1 MB blob POST 1.4 to 3.9 s; inline-tree flush (2.46 MB request) 6.9 to 7.3 s; `git push` of the same 2 MB 4.4 s. |
| H. Retention probe | **In place** | `refs/phraise-spike/retention-probe` -> orphan commit `af14d5fde4657306c05b3a3269ccdb2a9211a9d8`, created 2026-09-27T02:10:20Z. |

## A. Hidden ref lifecycle

Ref `refs/phraise-spike/drafts/main/5652fe4d85af6b61` (first 16 hex of the SHA-1 of `docs/example.md`), commit tree `{draft.md, draft.crdt}`, parentless commits overwritten with `force: true`. Evidence: `evidence/gate-a.jsonl`, `evidence/gate-a-summary.json`.

- Branches API: 0 matches. `git/matching-refs/phraise-spike/` lists it.
- Default clone (`git clone --no-checkout`, anonymous HTTPS): no `phraise-spike` refs, draft commit not present.
- `git ls-remote`: advertises the ref. Explicit refspec `git fetch origin refs/phraise-spike/drafts/main/<hash>:refs/draft-fetched` returned the last commit; `draft.md` byte-identical.
- API read-back (commit, tree, blob): byte-identical.
- `DELETE` 204, then `GET` the ref 404, `ls-remote` no longer lists it, **but `GET /git/commits/<last draft sha>` still 200.** Unreachable objects remain readable until GitHub's GC.
- Per-call latency (median, n): blob 662 ms (22), tree 651 ms (14), commit 690 ms (14), ref PATCH 957 ms (13), ref POST 902 ms, DELETE 809 ms. Pure API time per full flush is about 3.6 s; the rest of the wall time is our 1.1 s spacing.
- Inline tree: `POST /git/trees` accepts `content` for each entry and creates the blobs itself, so a flush is tree + commit + ref = 3 writes. Content must be a UTF-8 string, so the CRDT binary has to be stored base64-encoded (33 % larger).

## B. Side effects

Snapshots `before`, `after`, `late` and `check-*` in `evidence/gate-b-*.json`.

| Observable | Hidden-ref writes (A, D, G, probe, git push) | Scratch-branch writes (C, D, E) |
|---|---|---|
| Events API | nothing, including in the `final` snapshot after the git-push experiment | CreateEvent, PushEvent, DeleteEvent; a DeleteEvent was listed 17 s after the delete |
| Activity API (`/activity`) | nothing | branch_creation, push, branch_deletion |
| Actions runs | 0 (repo has 0 workflows) | 0 |
| Notifications for the owner | none new | none new |
| Rulesets | ruleset `main` targets branches only; no rule applied to hidden refs | not triggered (names outside the ruleset) |

Not observable: webhook deliveries (no hooks exist; creating one would change settings), and whether push rulesets or branch rules on other repos would match `refs/phraise/*`. A repo with workflows `on: push` without branch filters is the case to re-check: branch writes trigger push events, and for hidden refs we saw no event at all, which suggests no workflow trigger either, but that is inferred.

## C. Attributed commit

Scratch branch `spike-scratch/github-storage-c` from `main` at `a13e92c`. Two trailers: `The Octocat <583231+octocat@users.noreply.github.com>` (a real account's noreply address, to see linking) and `Phraise Example <phraise-example@example.com>`. Evidence: `evidence/gate-c.json`.

| | REST Git Data | GraphQL `createCommitOnBranch` |
|---|---|---|
| Writes | 3 (tree with inline content on `base_tree`, commit, ref PATCH `force: false`); 4 with a separate blob | 1 |
| Wall time incl. spacing | 5.7 s | 2.8 s |
| Author | the token user, primary account email | the token user, primary account email |
| Committer | the token user | `GitHub <noreply@github.com>`, login `web-flow` |
| Signature | none, `verified: false, reason: unsigned` | GitHub PGP signature, `verified: true` |
| Co-authors (`Commit.authors`) | user, octocat (linked to login), Phraise Example (no user) | same |
| Race protection | fast-forward check of the PATCH (branches only) | `expectedHeadOid` |
| Limits | any tree, merge commits, explicit author/committer allowed | one parent only, author always the viewer, file additions and deletions only |

The public commit page contains both co-author names in both cases. The author email came from the account, not from the request; with an App user token the same is expected (re-run gate C).

## D. Race detection

Evidence: `evidence/gate-d.jsonl`, `evidence/extra-git-push.jsonl`.

| Case | Result |
|---|---|
| Branch, REST PATCH `force: false`, commit parented on the stale head | 422 `Update is not a fast forward` |
| Branch, `createCommitOnBranch` with stale `expectedHeadOid` | HTTP 200, `data.createCommitOnBranch: null`, error `type: STALE_DATA`, "Expected branch to point to ... Pull and try again." |
| Branch, `updateRefs` stale `beforeOid`, `force: true` | HTTP 200, `data: null`, error "Something went wrong while executing your query ..." Head verified unchanged. |
| Hidden ref, `updateRefs` create with `beforeOid` = zeros | ok |
| Hidden ref, same create again | rejected, same opaque error |
| Hidden ref, `updateRefs` CAS overwrite to a parentless commit, `force: true` | ok |
| Hidden ref, `updateRefs` stale `beforeOid` | rejected, opaque error |
| **Hidden ref, REST PATCH `force: false` to an unrelated parentless commit** | **200, ref moved.** No fast-forward check outside `refs/heads/`. |
| Hidden ref, `updateRefs` CAS delete (`afterOid` = zeros) | ok, then GET 404 |
| Hidden ref, `git push --force-with-lease=<ref>:` (must not exist) | ok, 2.9 s |
| Hidden ref, `git push --force-with-lease=<ref>:<old>` with 1 MB + 1 MB | ok, 4.4 s |
| Hidden ref, stale lease | rejected `[rejected] (stale info)`, exit 1 |
| Hidden ref, lease delete | ok |

Two pitfalls found along the way: a `+` on the refspec overrides `--force-with-lease` (run 1 of the extra script used `+` and its stale push succeeded; evidence kept in `extra-git-push-run1-plus-refspec.jsonl`), and `updateRefs` reports a CAS miss with the same generic message as a server fault, so a client must re-read the ref after any `updateRefs` error.

## E. Polling

Evidence: `evidence/gate-e.json`.

- Conditional GET of `git/ref/heads/<branch>` with `If-None-Match` returns 304 with the same rate-limit headers, and `X-RateLimit-Used` does not rise: 0 over 25 calls, against 24 over 25 unconditional calls in the same bucket. **304 is free on the primary limit.**
- The rate-limit headers are not one counter. Consecutive responses report unrelated `X-RateLimit-Used` sequences with different reset times (e.g. 34, 35, 36, then 5, then 37, then 1), and `GET /rate_limit` reported `used: 0` all along. Budget checks must read the headers of the response they care about, grouped by `X-RateLimit-Reset`, not `/rate_limit`.
- Write-to-visible delay: 3 GraphQL commits and 3 `git push`es. In every trial the first poll after the write returned the new head: lower bound 0.01 to 0.04 s, upper bound 0.65 to 0.80 s. The branches API also showed it on its first try (within 1.3 to 1.6 s). Measured from the writer's own machine and token; another client or region may see replication lag, not observed here.
- The 404 response to a ref GET carried `X-Poll-Interval: 300`. We found no sign that it is enforced on ref endpoints.

## F. Cost model

Measured costs per operation, primary limit in REST requests, GraphQL mutations 1 point each (observed):

| Operation | Route | Writes | Reads |
|---|---|---|---|
| Draft flush, one doc | REST, separate blobs | 5 | 0 (read-back optional) |
| Draft flush, one doc | REST, inline tree | 3 | 0 |
| Draft flush, one doc, with CAS | REST objects + GraphQL `updateRefs` | 2 REST + 1 GraphQL | 0 |
| Draft flush, any number of docs on one branch | inline tree on `base_tree` with only changed docs, one ref per branch | 3 | 0 (derived, not measured separately) |
| Draft flush, any number of refs | one `git push --atomic --force-with-lease` | 1 git request, 0 REST | 0 |
| Commit | GraphQL `createCommitOnBranch` + delete draft ref | 1 GraphQL + 1 | 1 conditional GET |
| Commit | REST inline tree + commit + PATCH + delete draft ref | 4 | 1 conditional GET |
| Poll branch head | conditional GET | 0 | 1, free when 304 |

Documents sustained per user token at a one-minute flush cadence (60 flushes per hour per document):

| Limit | Per hour | REST full (5) | REST inline (3) | Per-branch ref (3 per branch) |
|---|---|---|---|---|
| Primary REST 5,000/h | 5,000 | 16 docs | 27 docs | 27 branches, any doc count |
| Secondary 80 content-creating/min | 4,800 | 16 | 26 | 26 branches |
| Secondary 500 content-creating/h, **if Git Data writes count** | 500 | **1.6 docs** | **2.7 docs** | **2.7 branches** |
| GitHub guidance of 1 write/s | 3,600 | 12 | 20 | 20 branches |

Where the secondary limits bite: the 500/h content-creation limit, if it covers Git Data writes, caps a user token at about 3 actively edited documents or branches. We could not determine whether it does without deliberately approaching the limit, which the charter forbids. Mitigations, in order of strength: flush through `git push` (not a REST request at all; git transport limits are separate and undocumented); flush drafts with a GitHub App installation token so the user's budget is untouched and the budget scales with the installation; one draft ref per branch with a multi-document tree; lengthen the cadence when idle. Polling costs nothing while nothing changes.

## G. Size

Evidence: `evidence/gate-g.jsonl`, `evidence/gate-g-calls.json`. Random content, the worst case for transfer.

- Full REST flush (2 blobs of 1 MB each as base64 JSON, tree, commit, ref): 10.1, 13.2, 11.5 s wall. Blob POSTs 1.4 to 3.9 s each, median about 1.9 s.
- Inline-tree flush (one 2.46 MB tree request): 7.3, 6.9, 7.3 s wall; the tree POST itself about 2.1 s.
- Reading the 1 MB Markdown blob back: 1.15 s (1.44 MB JSON).
- `git push` of a parentless commit with the same 2 MB: 4.4 s, one request.

Nothing failed or was throttled at this size. The per-flush cost at this size is dominated by upload time, so the relay must never block editing on a flush.

## H. Retention probe

`refs/phraise-spike/retention-probe` points at orphan commit `af14d5fde4657306c05b3a3269ccdb2a9211a9d8` (tree `658b69b2931467e6500101ea7a4bb879062d2250`, blob `49decaea7e037862e9c4785c9896daf8941646f1`), message "phraise retention probe, created 2026-09-27T02:10:20Z". It is reachable from no branch or tag. Check it with `spikes/2026-09-27-github-storage-ghapi/check-retention-probe.sh` (read-only: API and `git fetch`), suggested at 1, 4 and 12 weeks. Delete it with `cleanup.sh` after editing the `KEEP` line, or with `gh api -X DELETE repos/skurella/phraise/git/refs/phraise-spike/retention-probe`.

## Recommendation

**D2: amend.** Hidden refs are the right place for drafts, and retention can be tracked with the probe. Amend:

1. Draft ref writes must be compare-and-swap: `git push --force-with-lease` (preferred) or GraphQL `updateRefs` with `beforeOid`. Never REST `PATCH` for hidden refs.
2. Prefer `git push` over the smart HTTP protocol as the flush transport: one request per flush for any number of documents and refs (`--atomic`), CAS, 2 to 3 times faster at 2 MB, and outside the REST write budget. Keep the REST inline-tree flush as the fallback. A follow-up spike should confirm `git push` over HTTPS with an App installation token.
3. Consider one draft ref per branch or session with a multi-document tree instead of one ref per document, if the write budget turns out to be the 500/h one.
4. Treat draft contents and ref names as public on public repositories. Anyone can `ls-remote` and fetch them, and deleted drafts linger by SHA. Offer an opt-out or encryption of the CRDT blob for public repos, or keep drafts only in relay storage there.

**D9: confirm, with an amendment.** User-to-server tokens for commits: the GraphQL route gives user authorship, parsed co-authors, a verified GitHub signature and a clean `STALE_DATA` race error in one call, so commit via `createCommitOnBranch`. Amend: flush drafts with the App's installation token, not the user's token, since drafts need no attribution and should not spend the user's budget. Re-run C, D, E, F with App tokens before locking.

## Decisions

Made by: orchestrator, spike 4. For the lead to promote into the decision register.

| # | Decision | Impact | Difficulty |
|---|---|---|---|
| S4-1 | Spike approach: bash over `gh api` with a single allow-list wrapper, no TypeScript | Low | Low |
| S4-2 | Draft ref updates must use CAS (`git push --force-with-lease` or `updateRefs`); REST PATCH is unsafe for hidden refs | High | Low |
| S4-3 | Recommend `git push` as the draft flush transport, REST inline-tree flush as fallback; needs an HTTPS + App token follow-up | High | Medium |
| S4-4 | Draft commits stay parentless and are overwritten, not chained; CAS makes chaining unnecessary | Medium | Low |
| S4-5 | Commit through GraphQL `createCommitOnBranch` (1 call, signed, `STALE_DATA`); REST Git Data only when a merge commit or explicit author is needed | Medium | Low |
| S4-6 | Change detection polls `git/ref/heads/<branch>` with ETag; 304 is free, so polling can be frequent for active branches | Medium | Low |
| S4-7 | Budget checks read response headers per `X-RateLimit-Reset` bucket, never `/rate_limit` | Low | Low |
| S4-8 | Flag drafts as public on public repos; product decision needed on opt-out or encryption | High | Medium |
| S4-9 | Leave `refs/phraise-spike/retention-probe` in place for retention checks | Low | Low |

## Open items

**GitHub App (needs the owner).** Steps:

1. github.com -> Settings -> Developer settings -> GitHub Apps -> New GitHub App. Name e.g. `phraise-dev`; homepage `https://github.com/skurella/phraise`.
2. Callback URL `http://127.0.0.1:8765/callback` (any local port; unused if device flow is used). Tick **Enable Device Flow** so an agent can obtain a user token with only the client ID while the owner approves in the browser. Keep **Expire user authorization tokens** ticked.
3. Webhook: untick **Active** (no webhook for now).
4. Repository permissions: **Contents: Read and write**, **Metadata: Read** (mandatory). Later: Pull requests: Read and write. No organization or account permissions.
5. Where can it be installed: **Only on this account**. Create, then **Install** on `skurella/phraise` only (Only select repositories).
6. Give the agent the App ID and client ID (not secret). For installation tokens, generate a private key and keep it out of the repo, exposed to scripts only through an environment variable at run time.

Re-run with an App user token: C (author, committer, signature, "on behalf of" badge), D (`updateRefs` and `createCommitOnBranch` permissions), E and F (rate-limit headers and buckets of user-to-server tokens). Re-run with an installation token: A and G (draft flush), the `git push` flush over HTTPS with `x-access-token`, and F (installation budget, which scales with repos and users).

**Other open items.**

- Whether Git Data writes count toward the 500/h content-creation limit. Ask GitHub support or find it in documentation; do not measure by provoking it.
- Webhook delivery for hidden-ref pushes (would need a webhook, out of scope).
- GitHub Enterprise Server: not tested.
- Retention: run `check-retention-probe.sh` at 1, 4 and 12 weeks.
- How long objects of a deleted draft stay readable by SHA.
- Spike tooling gap, from the fresh-context review: `git push` writes share the write counter and spacing but have no automatic stop on a rate-limit or abuse response over git transport, since there is no HTTP status to inspect. No push failed in this spike except the intended stale-lease rejection. A production flusher over git needs its own back-off on push errors.

## Cleanup

Deleted (all 204 unless noted): `refs/phraise-spike/drafts/main/5652fe4d85af6b61` (gate A), `refs/phraise-spike/drafts/race-test` (gate D, via `updateRefs`), `refs/phraise-spike/drafts/main/size-test` (gate G, twice: aborted run and clean run), `refs/phraise-spike/drafts/git-push-test` (extra, via REST after run 1 and via lease push after run 2), `refs/heads/spike-scratch/github-storage-c`, `-d`, `-e` (`cleanup.sh`, see `evidence/cleanup.jsonl`).

Verified at the end with `cleanup.sh --dry-run` and an anonymous `git ls-remote`: the only remaining ref under `refs/phraise-spike/` or `spike-scratch/github-storage-*` is `refs/phraise-spike/retention-probe`. Unreachable objects from the deleted refs remain on GitHub until its garbage collection; they cannot be deleted through the API.
