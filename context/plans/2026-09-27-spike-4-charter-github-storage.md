# Charter: spike 4, GitHub storage mechanics

Status: dispatched
Author: lead agent (Fable 5.1)
Updated: 2026-09-27
Owner of this spike: one spike orchestrator (Opus 5.5)
Serves: decisions D2, D6 and D9 in [architecture decisions](../docs/2026-09-27-architecture-decisions.md)
Background: [GitHub platform constraints](../docs/2026-09-27-github-platform-constraints.md)

## Why this spike exists

Decision D2 stores drafts in hidden git refs and was the most contested storage call: retention of custom refs is implied, not documented, and the write budget is tight. Everything in the constraints doc came from reading documentation. This spike replaces reading with measurement against real GitHub.

## Independence

This spike runs in parallel with others and shares nothing with them. Do not read or use another spike's code or branch.

## Goal

Measure and demonstrate, against the real repository `skurella/phraise`, the storage operations Phraise needs: drafts in hidden refs, attributed commits, race detection, change detection by polling, and the API cost of each.

## Success gates

| Gate | Requirement |
|---|---|
| A. Hidden ref lifecycle | Create, overwrite many times, read and delete a ref under `refs/phraise-spike/drafts/` pointing at a commit whose tree holds a Markdown blob and a binary blob. Show that it is absent from the branches API and from a default clone, and that an explicit refspec fetches it. |
| B. Side effects | Establish what a hidden-ref write triggers: events, notifications, rules. Report what is observable and what could not be observed. |
| C. Attributed commit | Commit a file change to a scratch branch through the API, with `Co-authored-by` trailers for two co-authors. Compare the REST Git Data route with the GraphQL `createCommitOnBranch` route: number of calls, who appears as author and committer, verified status, and how trailers render. |
| D. Race detection | Show that a commit or ref update that expects an old head fails cleanly when the head has moved, for both routes, and what the error looks like. |
| E. Polling | Conditional requests with ETag on the branch ref: confirm whether a 304 consumes primary rate limit by reading the rate-limit headers, and measure the delay from a push to the new head being visible. |
| F. Cost model | Count API calls per draft flush and per commit. From measured headers, state how many active documents one user token sustains per hour at a one-minute flush cadence, and where the secondary limits would bite. |
| G. Size | Time a flush with a 1 MB Markdown blob and a 1 MB binary blob. |
| H. Retention probe | Leave exactly one ref, `refs/phraise-spike/retention-probe`, in place with its creation date in the commit message, so retention can be checked in later weeks. Document it in the findings. |

## Hard safety rules

- Act only on `skurella/phraise`. Create no repositories.
- Never write to `main`, to `spike/*` or `context/*` branches other than your own, or to any ref outside `refs/phraise-spike/` and scratch branches named `spike-scratch/github-storage-*`.
- Change no repository, account or organization settings. Create no webhooks, no GitHub App, no deploy keys, no Actions workflows.
- Use the owner's existing `gh` login. Call the API through `gh api`, or pass the token to a script through the environment at run time. **Never print, log or write the token to a file.**
- Stay far from rate limits: at most 300 write requests in the whole spike, at least one second apart, serial. Never provoke a limit on purpose. Stop at the first 403 or 429 and report.
- Clean up at the end: delete every ref and scratch branch you created except the retention probe. List what you deleted.

## Out of scope, to be documented as open items

- GitHub App with user-to-server tokens: needs the owner to create an App. Write the exact steps and permissions the owner would need, and which gates should be re-run with an App token.
- Webhooks: would change repository settings.
- GitHub Enterprise Server.

## Constraints

- All code under `spikes/2026-09-27-github-storage-<approach>/`, self-contained, with a README stating goal, status and how to run.
- TypeScript on Node 22.12.0 with npm 11, or shell with `gh api` where that is simpler. **pnpm is broken on this machine; use npm.**
- The Bash sandbox is off; network and git commands work normally.
- **Only add new files.** Do not edit `AGENTS.md`, the decision register, other docs, or anything belonging to another spike. Record your decisions in a "Decisions" table in your findings doc with impact and difficulty ratings.
- Stage paths explicitly. Never use `git add -A` or `git add .`. Do not commit `node_modules`.
- Every agent logs at each milestone and at least every 15 minutes.

## Branch and commits

Branch `spike/2026-09-27-github-storage` exists, is based on `main`, and contains this charter. Check it out in your worktree. Commit early and often, push at milestones and before handback. Do not open a PR and do not merge.

## Authority, escalation, budget

You decide everything within this charter and its safety rules. Escalate by handing back early if a safety rule blocks a gate, if GitHub returns a rate-limit or abuse response, or if you have used twice the budget. Budget: about six worker dispatches. Much of this spike is small enough to do yourself.

## Deliverables

1. Scripts that reproduce each gate, and a single command that runs the non-destructive ones.
2. `context/docs/<date>-spike-4-findings-github-storage.md`: gate results with measured numbers, raw evidence such as status codes and rate-limit header values, the cost model, the Decisions table, open items, and a recommendation for D2 and D9: confirm, amend or replace.
3. Briefs in `context/plans/` and one log per agent session in `context/logs/`.
4. Everything committed and pushed, and the cleanup list.

## Handback to the lead

Under 400 words: gate results as a table, the recommendation for D2 and D9, anything that surprised you, what was left out and why, and the paths of the findings doc and your log.
