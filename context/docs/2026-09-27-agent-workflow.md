# Agent workflow: roles, briefs, handbacks, review

Status: active
Author: lead agent (Fable 5.1)
Updated: 2026-09-27

Goals set by the owner: talk to a single lead agent, use cheaper models for everything else, optimize for autonomy, context hygiene and quality at reasonable cost. Parallelism is not a goal.

## Roles and topology: hub and spoke, three levels

Revised 2026-09-27 (decision P7) to protect the owner's Fable budget. Nesting was verified empirically: an Opus subagent launched Haiku and Sonnet subagents, with model override and worktree isolation working at the nested level.

```
owner ── lead (Fable) ── spike orchestrator (Opus) ─┬─ builder (Sonnet)
                                                    ├─ grinder (Haiku)
                                                    └─ reviewer (Sonnet, fresh context)
```

Communication follows the lines only. Workers talk to their orchestrator. Orchestrators talk to the lead. The lead talks to the owner. There is no lateral messaging; files in `context/` are the shared medium.

| Role | Model | Owns | Never does |
|---|---|---|---|
| **Lead** | Fable 5.1 | Conversation with the owner. Architecture and locked decisions. One **charter** per spike. Reading each spike's handback and findings doc. The decision register. PRs. | Talking to builders, grinders or reviewers. Writing task briefs. Reading logs unless a handback is surprising. Implementation. |
| **Spike orchestrator** | Opus 5.5 | One spike end to end from its charter: detailed plan and task briefs, choosing when to hand off to Sonnet or Haiku and when to do a small thing itself, review, iteration, trying a second approach, the findings doc, its log, commits and pushes on the spike branch, the handback to the lead. | Changing a locked decision. Working outside its spike directory and its own context files. Merging. |
| **Builder** | Sonnet 5 | One task from a brief: code and tests, a log, a short handback to the orchestrator. | Design changes outside the brief. Spawning further agents. |
| **Grinder** | Haiku 4.5 | Mechanical, fully specified work: corpus and fixture collection, golden files, lint and format fixes, transcription. | Anything needing design judgement. Spawning further agents. |
| **Reviewer** | Sonnet 5, fresh context | Reviews a diff against the brief and the decisions doc, runs the tests, reports findings by severity. | Fixing what it finds. |

Depth limit: three levels below the owner. Builders, grinders and reviewers have the agent-launching tool but must not use it.

### What the lead spends per spike

One dispatch, one handback read, one findings-doc read, one PR. Anything more is an escalation, and escalations are allowed only when: a locked decision needs to change, the charter's success gate looks unachievable, or the orchestrator has spent twice its budget.

### Orchestrator authority

Within its charter the orchestrator decides everything: approach, libraries, task split, which model does what, when to abandon an approach. It records each non-trivial decision as a row in the decision register with impact and difficulty, marked "made by: orchestrator, spike N". The lead reviews those rows at handback and may overrule.

## Parallel spikes

Allowed by the owner on 2026-09-27 when spikes are completely independent: separate charter, branch, worktree, spike directory and PR, and no shared code. To keep PRs free of conflicts, a spike running in parallel **only adds new files**: its own briefs, logs, findings doc and spike directory. It does not edit shared files such as `AGENTS.md`, the decision register or other docs. Its decisions go in a "Decisions" table in its findings doc, and the lead transfers them to the register.

## The units of work: charter and brief

A **charter** is written by the lead, one per spike, in `context/plans/`. It states the goal, the decisions served, the success gates, the budget, the branch, and the handback format. It does not prescribe how.

A **brief** is written by the orchestrator, one per task, in `context/plans/`, and is the only way work is handed to a builder, grinder or reviewer. It contains:

1. **Goal** in two sentences and the decision(s) in the architecture doc it serves.
2. **Scope and non-scope**, explicit.
3. **Inputs to read**, as links: AGENTS.md, the decisions doc, and at most two or three other docs or code paths. Nothing else.
4. **Definition of done**, executable: commands to run, tests that must pass, fixtures that must round-trip, a demo script.
5. **Constraints**: model, rough effort budget, whether commits are allowed, whether a worktree is used.
6. **Handback format**: outcome, verification, omissions, links.

Briefs are small. A package that needs more than a day of builder effort is split.

## Git and PR policy

Branches are free; `main` is PR-only with squash merge and is merged by the owner. Branch names: `<kind>/<date>-<slug>`, for example `spike/2026-09-28-markdown-core-remark` or `context/2026-09-27-bootstrap`. One PR per coherent unit so that the squash commit reads well. Builders commit on their branch as they go and push at handback. The lead writes the PR title as a commit subject and the body as the commit message. The lead never merges.

## How agents are run

Decided 2026-09-27, see the decision register. All agents are in-process subagents launched with the Agent tool and a model override per role. The lead launches each orchestrator with `isolation: worktree` and `run_in_background`. The orchestrator launches its workers without isolation so they share its worktree, one at a time. The session runs on the owner's laptop and stays open for extended periods. Cloud routines and moving the lead session to the cloud are available as fallbacks for unattended long runs; the Workflow tool is not used because parallel fan-out is not a goal.

## The loop

1. Lead writes the charter, creates the spike branch, and dispatches one Opus orchestrator in the background in its own worktree.
2. Orchestrator plans, writes briefs, dispatches builders, grinders and reviewers one at a time inside its worktree, iterates until the success gates pass or the approach is abandoned, and commits as it goes.
3. Orchestrator writes the findings doc, appends its decisions to the register, pushes the branch, and hands back to the lead in under 400 words.
4. Lead reads the handback and the findings doc, spot-checks, updates locked or default decisions, and opens the PR. The lead reads logs only when a handback is surprising.
5. If an orchestrator session dies, a new one resumes from the charter, the plan files, the log and the branch. Nothing depends on a transcript.

## Context hygiene

- Every agent reads AGENTS.md, the decisions doc and its brief. That is the bootstrap. Everything else is on request through links in the brief.
- Logs are the memory between sessions. A new session on a package starts by reading the previous log for that package, not the transcript.
- Docs are distilled; research reports are summarized into docs with links out, not pasted in.
- The lead keeps its own log per session and writes a short retrospective doc when a phase ends.

## Cost controls

- Fable leads and touches each spike a handful of times. Opus orchestrates and plans. Sonnet builds and reviews. Haiku grinds.
- One orchestrator per spike. Spikes run in parallel only when independent; workers inside a spike run one at a time.
- Briefs carry an effort budget; a builder that exceeds it stops, logs where it is, and hands back partial work with a clear state rather than thrashing.
- Spikes are timeboxed and produce a findings doc, not production code. Until the owner opens a production tree, every package is a spike under `spikes/`, and competing approaches to one component are encouraged rather than a single blessed implementation. Sunk cost is not an argument; a findings doc that says "abandoned because X" is a successful outcome.

## Phases

- **Phase 0, derisking spikes:** three timeboxed spikes, see [the spikes plan](../plans/2026-09-27-derisking-spikes.md). Each is one builder session, Sonnet first, Opus on escalation. Output is a findings doc per spike and a go/no-go on the default decisions.
- **Phase 1, component spikes:** still under `spikes/`. In order: markdown core, doc model, relay plus a minimal web editor, GitHub adapter. Each is one or more briefs with golden tests, and may be attempted with more than one approach.
- **Phase 2, the loop:** an integration spike that wires the winning component spikes together: open a file from GitHub, edit together, comment, commit, receive an external commit. End-to-end test with recorded GitHub fixtures. This is the feasibility gate: only after it passes does the owner decide to open a production tree and start porting.
- **Phase 3, the daemon:** file materialization, MCP server, then the VS Code extension.
- **Phase 4, polish and deferred features:** offline mode hardening, Mermaid, widgets.
