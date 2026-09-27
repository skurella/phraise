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

## 03:57 — Searched the Claude Code tracker for the blank nested pane

No exact duplicate found in `anthropics/claude-code`. Related open issues:
- 93724: resumed background subagent shows no activity until completion (desktop, Windows). Same class of problem, different trigger.
- 75043: nested subagents may run detached and never return results to the parent, mainly in non-interactive sessions. **Risk to our orchestration.** Not reproduced here: the grinder handback reached the orchestrator at 03:28 and the builder's at about 03:54, followed by an orchestrator commit at 03:55. Documented workaround if stalls appear: the child writes its report to an agreed path and the parent polls for it in the same turn.
- 82617: the desktop Stop button can kill background subagents from earlier turns. The owner should avoid pressing Stop while an orchestrator is running.
- 93786: work in `.claude/worktrees/` is invisible to the desktop diff pane.

Drafted a bug report for the owner; not filed, awaiting the owner's go-ahead because it posts publicly under their account.

## 04:03 — Owner: no bug report; watch spike 1; parallel spikes allowed if independent

Spike 1 status from its log: core builder handed back at 03:50 and was verified, orchestrator made small fixes itself, gates-harness builder dispatched at about 04:02 (dispatch 3 of about 8). Decisions P9 to P12 recorded. Chartering spike 2 (CRDT rebase, independent variant, Yjs and Loro) and spike 4 (GitHub storage mechanics) on their own branches from `main`.

## 04:05 — Spikes 2 and 4 dispatched in parallel

Charters pushed on `spike/2026-09-27-crdt-rebase` and `spike/2026-09-27-github-storage`, both based on `main`. One Opus orchestrator each, background, own worktree. Three orchestrators now running: spikes 1, 2 and 4. Spike 3 (daemon) waits for spikes 1 and 2. Both new prompts include a guard against the nested-agent stall described in claude-code issue 75043: do not end a turn waiting on a worker; check its log and files instead.

Pending lead actions at each handback: read handback and findings, transfer decisions to the register, rebase spike 1 onto `main`, open one PR per spike.

## 06:37 — Spikes 4 and 1 accepted

Spike 4 merged by the owner as PR 3. Spike 1 verified by the lead, rebased onto `main`, and opened as PR 4. Details in the lead's handback logs for each spike. Two rules added to AGENTS.md from spike 1's lessons: commit incrementally, and verify claims that have consequences. Spike 2 still running; spike 3 waits for its recommendation on D5.

## 06:47 — Correction: why spike 1 builders stopped early

The owner relayed an analysis from a side chat. Verified against the evidence:
- **Correct:** the spike 1 builders did not run out of context or usage. Brief 03 said "one session of up to about two and a half hours". The gates builder's log claims 05:40 for a harness that git shows committed at 04:34; it stopped believing its time was used up. The lead had repeated the orchestrator's phrase "ran out of session" without checking. No work was lost; only the final full gate run was missing.
- **Incorrect:** the claim that the app process exited and killed the spike 2 orchestrator and the lead's gate re-run. The lead's re-run completed with exit 0 in 374 s. At 06:47 the agent list shows the spike 2 orchestrator and its Loro builder both running, and files in the Loro spike directory were modified within the last minute.
- **Also found:** the spike 2 orchestrator's log has entries stamped 06:40 and 06:45 written before 06:34. The lead's own handback logs for spikes 4 and 1 contain estimated times as well (entries 04:45, 04:50, 06:40, 06:45). Those are approximate; entries in this file written with `date` are exact.

Procedures changed, decision P13: no wall-clock budgets, timestamps only from `date`, long verification runs belong to the orchestrator. Spike 2 orchestrator informed.

## 07:50 — Spike 2 accepted; spikes 3 and 5 dispatched

Spike 2 verified and opened as PR 5. Spikes 3 (daemon file sync) and 5 (collaboration stack, Yjs 13 or 14) chartered on their own branches and dispatched in parallel, one Opus orchestrator each. Their charters carry the P13 rules inline because PR 2 is not merged yet. Details in the lead's spike 2 handback log on the spike 2 branch.

## 16:04 — All five spikes accepted; integration dispatched

- Spike 3 accepted as PR 6 with two gates formally failing at threshold and no data lost; recorded as D7g. The lead's first summary to the owner omitted that the gate command fails, and the next message corrected it.
- Spike 5 accepted as PR 7. D5 resolved: build on Yjs 13, migrate to 14 later. The spike has no unit tests.
- D1 amended by the lead after spike 3: re-seeding becomes compaction with generations. Untested; assigned to spike 6.
- Spikes 6 (integration, headless engine) and 7 (web editor in a real browser) chartered on their own branches and dispatched in parallel, one Opus orchestrator each. Decisions P16 and P17.
- Held for the owner: reporting the Yjs 14 binding bug upstream, P15.
- Open PRs: 2, 4, 5, 6, 7. A trial squash-merge of all five in sequence had no conflicts.
- Planned once those merge: a consolidation pass over the architecture decisions doc and the register, which have grown by amendment.

Details of each acceptance are in the lead's handback logs on the respective spike branches.

## 2026-09-28 00:29 — Spike 7 accepted; spike 6 liveness checked

Spike 7 verified by the lead and opened as PR 8. Decisions D11a to D11g and P18 recorded on its branch. A trial squash-merge of the six open PRs in sequence had no conflicts.

Spike 6 has closed milestones 1 and 2 per its log and is in milestone 3. Its current builder had written no files in the worktree for over two hours, so the lead checked liveness without reading transcripts: no sleep gap on the machine, and the builder's transcript file was modified seconds before the check. It is working in a temporary copy of spike 3 outside the worktree to reproduce the tie case. No intervention. Technique for future checks: compare the modification time of the agent's transcript file, not only the worktree.
