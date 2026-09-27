# GitHub platform constraints (verified 2026-09-27)

Status: active
Author: lead agent (Fable 5.1), from a research subagent that checked docs.github.com, github.blog and community discussions
Updated: 2026-09-27

Facts that shape the storage and integration design. Each item has a verdict and the source. Re-verify anything marked "behaviour, not contract" before relying on it.

## 1. PR review comments cannot anchor to arbitrary lines

- The REST create endpoint only accepts lines that appear in the PR diff hunks, including context lines. Files not changed in the PR cannot be commented. File-level comments (`subject_type: file`) and multi-line comments (`start_line`) are supported. [Docs](https://docs.github.com/en/rest/pulls/comments?apiVersion=2022-11-28#create-a-review-comment-for-a-pull-request)
- Since Sept 2025 the web UI allows comments on any line of a changed file, but the API still returns 422 for lines outside hunks as of Feb 2026, per [community discussion 187218](https://github.com/orgs/community/discussions/187218).
- Comments become "outdated" when a later commit changes the line. File-level comments reportedly go outdated on any push, even if the file was untouched. Behaviour, not contract.
- A PR cannot be created with zero diff; the workaround is an empty commit, which gives no lines to anchor to. Nothing auto-closes PRs.
- Commit comments take `path` plus `position`, a diff index, and since 2022 no longer show in PR timelines.

**Consequence:** comments need our own data model. PR review comments are at most a one-way export.

## 2. Custom refs are allowed, hidden, and retention is implied rather than guaranteed

- `POST /repos/{owner}/{repo}/git/refs` accepts any name starting with `refs/` with at least two slashes. `refs/pull/*` is read-only. [Docs](https://docs.github.com/en/rest/git/refs?apiVersion=2022-11-28#create-a-reference)
- Custom namespaces such as `refs/notes/*` push fine and are absent from the Branches UI. GitHub stopped displaying git notes in 2014.
- GitHub's GC blog describes reachability from "branch or tag"; standard Git reachability uses all refs and `refs/pull` objects are retained in practice, but there is no documented SLA for custom refs.
- Large custom-ref namespaces bloat `info/refs` advertisements for every fetch.

**Consequence:** hidden refs such as `refs/phraise/drafts/...` are viable as a recoverable cache of drafts, one ref per document and branch, overwritten rather than accumulated, deleted after commit. Not as the only durable copy.

## 3. Rate limits force debounced writes

| Limit | Value |
|---|---|
| Authenticated user or PAT, REST primary | 5,000 requests per hour |
| GitHub App installation token | 5,000 per hour base, up to 12,500; 15,000 on Enterprise Cloud |
| GitHub App user-to-server token | Same as the user's limit |
| GraphQL | 5,000 points per hour per user |
| Secondary: concurrency | 100 concurrent requests |
| Secondary: content-creating requests | 80 per minute, 500 per hour, some endpoints lower |
| Secondary: REST points | 900 per minute |
| Best-practice guidance for writes | Wait at least 1 second between POST/PATCH/PUT/DELETE, serial not concurrent |
| Enterprise Server | Rate limits disabled by default, admin-configurable |

Sources: [REST rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api?apiVersion=2022-11-28), [best practices](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api), [GraphQL](https://docs.github.com/en/graphql/overview/rate-limits-and-node-limits-for-the-graphql-api).

Git Data API writes (blobs, trees, commits, refs) carry no explicit "content creation" warning, unlike PR, comment and issue endpoints. Assume they count and budget at most one write per second per token.

**Consequence:** no per-keystroke persistence to GitHub. Flush drafts on the order of once per minute of activity per document.

## 4. Size limits

- Blobs up to 100 MB via Git Data API. Contents API fully supports files at or below 1 MB; 1 to 100 MB only via raw or object media types; above 100 MB unsupported. Directory listing capped at 1,000 entries; recursive tree capped at 100,000 entries or 7 MB.
- Repos ideally under 1 GB, strongly recommended under 5 GB.

## 5. GitHub App, not OAuth app

- GitHub Apps are preferred: fine-grained permissions, short-lived tokens, higher limits. Needed permissions: Contents write for refs, blobs and file writes; Pull requests write for review comments.
- A GitHub App acting on behalf of a user via a user access token has its requests attributed to that user. UI shows the user's avatar with an app badge; audit logs list the user as actor. [Docs](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-with-a-github-app-on-behalf-of-a-user)
- Org owners install apps. Repo admins can install by default unless the app asks for org permissions or the org restricts installs. Non-owners trigger a request to the owner. Enterprise-level installs need an enterprise owner. Marketplace listing is optional.
- User access tokens expire (8 hours with 6-month refresh at last check; verify on the token generation page).

## 6. Detecting external commits

- Push webhooks require Contents read. Respond 2xx within 10 seconds. Deliveries can be out of order and take minutes. GitHub does not retry failed deliveries; redeliver via API. [Docs](https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks)
- The Events API is explicitly not real-time: 30 s to 6 h latency. ETag polling returning 304 does not consume primary quota.

**Consequence:** webhook plus periodic ETag reconciliation of the branch ref.

## 7. No GitHub feature anchors comments outside PR or commit diffs

Discussions and Issues take permalinks only. Copilot code review is PR-scoped. github.com has no real-time collaborative editing.

## 8. Policy

No rule forbids storing structured data in repos. The Acceptable Use Policy bans "excessive automated bulk activity" and undue server burden, and the ToS allows API suspension for excessively frequent requests. The "not a CDN or serverless backend" wording applies to Actions, Codespaces and Pages, not core Git. Moderate-volume draft refs are fine; high-frequency automated writes are not.
