# Log: lead session, project bootstrap

Author: lead agent (Fable 5.1)
Time zone: CEST (Europe/Zurich)
Related: [vision](../docs/2026-09-27-vision.md), [architecture decisions](../docs/2026-09-27-architecture-decisions.md), [spikes plan](../plans/2026-09-27-derisking-spikes.md)

Times before 02:23 are approximate; the session began in a scratch workspace before the repo existed.

## ~01:45 — Task received

Owner described the vision: a Google-Docs-grade editor over Markdown in Git/GitHub, with real-time collaboration, comments, offline, AI access via MCP, IDE integration. Asked for: does it exist, how to approach it, derisk key architecture decisions, propose names.

## ~01:50 — Research delegated

Three research subagents launched in parallel (general-purpose, web search):
1. Competitive landscape.
2. GitHub platform constraints, verified against docs.github.com.
3. CRDT, Markdown editor round-tripping, structural merge, daemon precedent, AI login policy.

## ~02:00 — Findings

- No credible direct competitor. Graft (Feb 2026) and Colibri (Mar 2026) are prototypes matching the spec; neither has traction or a license. Details: landscape doc.
- PR review comment API rejects lines outside diff hunks (422) and unchanged files; comments go outdated on push. Rules out PRs as comment storage. Details: GitHub constraints doc.
- Custom refs are creatable and hidden; retention implied not guaranteed. Content-creating limit 80 per minute, 500 per hour. Rules out per-keystroke persistence to GitHub.
- No mainstream editor round-trips Markdown losslessly; block-level source preservation is a proven technique in small projects (BlockMD, Loxel). Details: technology assessment doc.
- Anthropic explicitly bans third-party Claude subscription login, enforced since January 2026. The "log in with your AI account" idea is dropped in favour of BYO key plus MCP.
- Yjs plus y-prosemirror plus Hocuspocus recommended; Yjs 14 attribution in RC. Loro is the fallback.

## ~02:10 — Decisions proposed to owner

Mental model "shared multi-user working tree for a branch". Ten decisions D1 to D10, see the decisions doc. Three derisking spikes proposed: block-preserving round trip, rebase onto upstream commit, daemon file materialization. Names proposed: Gutter, Quire, Scholia, Coauthor, Palimpsest, Watermark.

## 02:11 — Owner created the repo

`skurella/phraise`, MIT, initial commit only. Name chosen: Phraise.

## 02:23 — Task received: materialize the session

Owner asked for `context/` with `logs`, `docs`, `plans`, date-prefixed Markdown files, `AGENTS.md`, no coding yet, and a proposal for distributing work to cheaper agents with a single Fable lead.

## 02:30 — Owner constraint added mid-task

No source code in the main tree. All development in top-level `spikes/`, multiple approaches encouraged, integration only after spikes show feasibility. Applied to AGENTS.md, workflow doc, decision D10, spikes plan; created `spikes/README.md`.

## 02:35 — Files written

- `AGENTS.md`
- `context/docs/2026-09-27-vision.md`
- `context/docs/2026-09-27-landscape.md`
- `context/docs/2026-09-27-github-platform-constraints.md`
- `context/docs/2026-09-27-technology-assessment.md`
- `context/docs/2026-09-27-architecture-decisions.md`
- `context/docs/2026-09-27-agent-workflow.md`
- `context/plans/2026-09-27-derisking-spikes.md`
- `context/logs/2026-09-27-lead-bootstrap.md` (this file)
- `spikes/README.md`

Nothing committed. No code written.

## Open items for the owner

- Approve or amend the workflow (roles, models, brief format) in the agent-workflow doc.
- Approve the spikes plan and the order. First brief to write: spike 1, block-preserving round trip, starting with a Haiku corpus-collection task.
- Decide whether the lead may commit context files directly to `main` or should work on branches.

## 02:50 — Owner set policy

Branches free, `main` PR-only with squash merge, owner merges. Hands-off: lead makes all calls, escalates only when blocked, records decisions with difficulty and impact. Name candidates removed from the vision doc. Asked how orchestration will work.

## 02:55 — Orchestration checked and decided (P5)

Checked the session's tooling: in-process subagents with worktree isolation and per-role model override are available; no cloud routines exist yet; no session-spawning tool in this session. Decision: in-process subagents, one at a time, background, worktrees. Cloud is a fallback. Recorded in the decision register.

## 03:00 — Bootstrap PR

Created `context/docs/2026-09-27-decision-register.md`, updated AGENTS.md and the workflow doc with git and orchestration policy. Committing to branch `context/2026-09-27-bootstrap` and opening the PR.
