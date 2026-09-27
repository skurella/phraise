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

## 03:02 — Owner raised Fable cost concern

Proposed Opus orchestrators per spike and hub-and-spoke communication. Confirmed no cloud for now; session stays open on the laptop.

## 03:04 — Nesting test

Launched an Opus subagent that launched a Haiku subagent and a Sonnet subagent with worktree isolation. All worked: model override accepted at the nested level, worktree created under `.claude/worktrees/` and cleaned up when unchanged. Nested agents inherit the parent's working directory.

## 03:10 — Decision P7 adopted

Three-level hub and spoke. Workflow doc, AGENTS.md, decision register and spikes plan updated.

## 03:10 — Finding: Bash sandbox now active

`gh` fails inside the sandbox with a TLS verification error and `git fetch` over SSH fails. Network git and GitHub CLI commands need the sandbox disabled per command. Relevant to every orchestrator that pushes.

## 03:12 — Spike 1 dispatched

Wrote the charter `context/plans/2026-09-27-spike-1-charter-markdown-round-trip.md` on branch `spike/2026-09-27-markdown-round-trip`, pushed it, and launched one Opus orchestrator in the background in its own worktree. Toolchain facts passed in the charter: Node 22.12.0, npm 11, pnpm broken on this machine, Rust 1.93 available. The spike branch is based on the unmerged bootstrap branch; the lead will rebase it onto `main` after PR 1 is squash-merged.

Awaiting the orchestrator's handback. Next lead actions: read handback and findings doc, review register rows, open the spike PR, write the spike 2 charter.

## 03:08 — Sandbox disabled by owner

The owner turned off the Bash sandbox. Network git and `gh` commands work normally again. The earlier finding about per-command sandbox bypass no longer applies. Spike 1 orchestrator informed. Also fixed earlier in this session: a blanket `git add` had committed the orchestrator's worktree as an embedded repo reference; removed from the index and `.claude/worktrees/` added to `.gitignore`. Lesson for all agents: stage paths explicitly.

## 03:48 — Owner asked whether delegation is working

Owner saw the Sonnet builder's pane showing only its prompt and a spinner. Checked disk: files under the spike directory changed continuously from 03:26 to 03:47 (schema, a 22 KB parser, a dozen diagnostic scripts) while the orchestrator's log and commits were silent, which is consistent with Opus blocked on the builder call. Conclusion: delegation works; the app does not render live activity for agents nested two levels deep. Builder had not updated its log since 03:26, so AGENTS.md now requires log entries at milestones and at least every 15 minutes.
