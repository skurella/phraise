# Decision register

Status: living document, append-only. Newest at the bottom of each table.
Author: lead agent (Fable 5.1)
Updated: 2026-09-27

Every decision made on the owner's behalf is listed here so it can be reviewed at a glance. **Impact** is how much would have to change if the decision were reversed later: high means a rewrite of a component or the data model, medium means a package or workflow, low means local. **Difficulty** is how contested the call was: hard means credible alternatives with real trade-offs, moderate means a judgement call, easy means the evidence pointed one way. Read the hard and high rows first.

Detailed rationale lives in the linked docs; this register is the index.

## Product and architecture

| ID | Date | Decision | Impact | Difficulty | Made by | Where |
|---|---|---|---|---|---|---|
| D0 | 2026-09-27 | Mental model: Phraise is a shared, multi-user working tree for a branch | high | easy | lead, reviewed with owner | [architecture](2026-09-27-architecture-decisions.md) |
| D1 | 2026-09-27 | Git is canonical; the CRDT is a session layer re-seeded from commits | high | moderate | lead | [architecture](2026-09-27-architecture-decisions.md) |
| D2 | 2026-09-27 | Recoverable relay with an update log, drafts flushed to hidden refs `refs/phraise/drafts/...` on a debounce; no draft branches | high | **hard**: hidden-ref retention is implied not documented; owning any state hurts enterprise adoption; alternatives were a pure GitHub-only store or a full database | lead | [architecture](2026-09-27-architecture-decisions.md), [GitHub constraints](2026-09-27-github-platform-constraints.md) |
| D3 | 2026-09-27 | Comments are our own model, anchored by CRDT position plus quote selectors; PR comments are export only | high | easy: the PR comment API cannot anchor outside diff hunks | lead | [architecture](2026-09-27-architecture-decisions.md) |
| D4 | 2026-09-27 | Block-preserving Markdown model: `src` per block, structural compare at write time, opaque source blocks for unknown constructs | high | moderate: proven only in small projects; must be built, not bought | lead | [architecture](2026-09-27-architecture-decisions.md), [tech assessment](2026-09-27-technology-assessment.md) |
| D5 | 2026-09-27 | Yjs, y-prosemirror, Tiptap, Hocuspocus; Loro as named fallback | high | **hard**: Loro's native fork/diff/applyDiff fits the rebase operation better, Yjs wins on binding maturity and Yjs 14 attribution; revisit after spike 2 | lead | [architecture](2026-09-27-architecture-decisions.md) |
| D6 | 2026-09-27 | External commits, offline returns and merges are one CRDT-applied diff; never a blocking merge dialog; "needs review" flags instead | high | moderate | lead | [architecture](2026-09-27-architecture-decisions.md) |
| D7 | 2026-09-27 | Local daemon materializes live docs as files; MCP and IDE extensions sit on it | high | easy | lead | [architecture](2026-09-27-architecture-decisions.md) |
| D8 | 2026-09-27 | No login with AI subscriptions; BYO key plus MCP | medium | easy: Anthropic policy forbids it | lead | [tech assessment](2026-09-27-technology-assessment.md) |
| D9 | 2026-09-27 | GitHub App with user-to-server tokens; webhooks plus ETag reconciliation | medium | easy | lead | [GitHub constraints](2026-09-27-github-platform-constraints.md) |
| D10a | 2026-09-27 | No main source tree; all code in `spikes/`, multiple approaches encouraged, integrate only after feasibility is shown | medium | easy | owner | [architecture](2026-09-27-architecture-decisions.md) |
| D10b | 2026-09-27 | TypeScript as the default language, Rust or wasm parser optional pending spike 1 | medium | moderate | lead | [architecture](2026-09-27-architecture-decisions.md) |

## Amendments from spike 4, GitHub storage

Source: [spike 4 findings](2026-09-27-spike-4-findings-github-storage.md). Rows marked S4 were made by the spike 4 orchestrator and accepted by the lead unless stated.

| ID | Date | Decision | Impact | Difficulty | Made by | Where |
|---|---|---|---|---|---|---|
| D2a | 2026-09-27 | Every draft ref write is a compare-and-swap; never REST PATCH on hidden refs, which silently overwrites (S4-2) | high | easy: measured | orchestrator, accepted | [architecture](2026-09-27-architecture-decisions.md) |
| D2b | 2026-09-27 | `git push --force-with-lease` is the draft flush transport; REST inline tree is the fallback (S4-3) | high | moderate: not yet confirmed over HTTPS with an App token | orchestrator, accepted | [architecture](2026-09-27-architecture-decisions.md) |
| D2c | 2026-09-27 | One draft ref per branch with a repo-mirroring tree, draft commit parented on its base commit and overwritten. Overrules S4-4, which kept draft commits parentless. | high | moderate: gains plain-git readability and a recorded base, untested until the integration spike | lead | [architecture](2026-09-27-architecture-decisions.md) |
| D2d | 2026-09-27 | On public repos, draft flushing to git is off by default and drafts live only in relay storage; on private repos it is on (S4-8) | high | **hard**: drafts in public repos are readable by anyone, but turning the flush off weakens the promise that everything is recoverable from the repo; encryption was the alternative and adds key management | lead | [architecture](2026-09-27-architecture-decisions.md) |
| D9a | 2026-09-27 | Commit through GraphQL `createCommitOnBranch` with the user's token (S4-5) | medium | easy | orchestrator, accepted | [architecture](2026-09-27-architecture-decisions.md) |
| D9b | 2026-09-27 | Flush drafts with the App installation token, not the user's | medium | easy | orchestrator, accepted | [architecture](2026-09-27-architecture-decisions.md) |
| D9c | 2026-09-27 | Detect external commits by polling the branch ref with ETag; a 304 is free (S4-6). Budgets are read from response headers (S4-7). | medium | easy: measured | orchestrator, accepted | [architecture](2026-09-27-architecture-decisions.md) |
| S4-1 | 2026-09-27 | Spike 4 was built as shell over `gh api` with one allow-list wrapper, not TypeScript | low | easy | orchestrator | findings |
| S4-9 | 2026-09-27 | Leave `refs/phraise-spike/retention-probe` on the real repo to observe retention over weeks | low | easy | orchestrator, accepted | findings |

## Process and tooling

| ID | Date | Decision | Impact | Difficulty | Made by | Where |
|---|---|---|---|---|---|---|
| P1 | 2026-09-27 | `context/` layout with `docs`, `plans`, `logs`; date-prefixed Markdown; per-session logs | low | easy | owner | [AGENTS.md](../../AGENTS.md) |
| P2 | 2026-09-27 | Superseded by P7. Single Fable lead; Sonnet builders; Haiku grinders; Opus only on escalation; fresh-context Sonnet reviewer; sequential by default | medium | moderate: reviewer step adds cost but catches what a busy lead misses | lead, per owner's preference | [workflow](2026-09-27-agent-workflow.md) |
| P3 | 2026-09-27 | Branches are free, `main` is PR-only with squash merge, each PR is one coherent commit, owner merges | low | easy | owner | [workflow](2026-09-27-agent-workflow.md) |
| P4 | 2026-09-27 | Owner is hands-off; lead decides and escalates only when blocked; all decisions land in this register | medium | easy | owner | this file |
| P5 | 2026-09-27 | Workers run as in-process subagents with worktree isolation and per-role model overrides, one at a time, in the background. Cloud routines and moving the lead to the cloud are fallbacks for unattended runs. No Workflow fan-out. | medium | moderate: cloud workers would allow unattended runs but give less control over model, cost and feedback; the lead can move to the cloud later without changing the plan | lead | [workflow](2026-09-27-agent-workflow.md) |
| P6 | 2026-09-27 | Spike order: round trip, then rebase, then daemon; each gates the next | medium | easy | lead | [spikes plan](../plans/2026-09-27-derisking-spikes.md) |
| P7 | 2026-09-27 | Hub and spoke with three levels. One Opus orchestrator per spike owns planning, briefs, delegation to Sonnet and Haiku, review, findings and the handback. The Fable lead writes a charter, reads one handback, and opens the PR. Orchestrators record their own decisions here. | medium | moderate: saves Fable budget and keeps the lead's context small, at the cost of the lead seeing less detail; mitigated by findings docs, the register and spot checks. Nesting verified by test. | owner proposed, lead adopted | [workflow](2026-09-27-agent-workflow.md) |
| P8 | 2026-09-27 | No cloud for now; the session stays open on the owner's laptop | low | easy | owner | [workflow](2026-09-27-agent-workflow.md) |
| P9 | 2026-09-27 | Independent spikes may run in parallel, each with its own charter, branch, worktree and PR. Parallel spikes only add new files; the lead owns all shared files and transfers decisions into this register. | low | easy | owner allowed, lead set the no-shared-files rule | [workflow](2026-09-27-agent-workflow.md) |
| P10 | 2026-09-27 | Spike 2 (rebase and comment anchoring) reframed to be independent of spike 1: it uses its own minimal schema and ignores byte preservation, which is deferred to the integration spike. It must try both Yjs and Loro. | medium | moderate: running it independently brings the answer on D5 forward, at the cost of re-testing the combination with spike 1's schema later | lead | [spike 2 charter](../plans/2026-09-27-spike-2-charter-crdt-rebase.md) |
| P11 | 2026-09-27 | New spike 4: verify GitHub storage mechanics (hidden refs, attributed commits, optimistic concurrency, ETag polling, rate accounting) against the real `skurella/phraise` repo using the owner's existing `gh` login. No settings changes, no webhooks, no new repos, no GitHub App. | medium | moderate: it writes hidden refs and a scratch branch to the real repo, judged acceptable because everything is deletable and D2 is the riskiest storage decision | lead | [spike 4 charter](../plans/2026-09-27-spike-4-charter-github-storage.md) |
| P12 | 2026-09-27 | Do not file a public bug report about the blank nested-agent pane for now | low | easy | owner | lead log |
