# Agent workflow: roles, briefs, handbacks, review

Status: active
Author: lead agent (Fable 5.1)
Updated: 2026-09-27

Goals set by the owner: talk to a single lead agent, use cheaper models for everything else, optimize for autonomy, context hygiene and quality at reasonable cost. Parallelism is not a goal.

## Roles

| Role | Model | Owns | Never does |
|---|---|---|---|
| **Lead** | Fable 5.1 | Conversation with the owner, architecture, decomposition into briefs, integration, promoting findings to docs, final quality judgement | Long tool loops of implementation work, reading raw worker transcripts, reading the whole `context/` tree into one turn |
| **Builder** | Sonnet 5 by default | One work package at a time from a brief; writes code and tests; keeps a log; returns a short handback | Design changes outside the brief, editing `context/docs/`, commits unless the brief says so |
| **Grinder** | Haiku 4.5 | Mechanical, well-specified work: fixture and corpus collection, golden-file generation, lint and format fixes, dependency bumps, doc transcription | Anything requiring judgement about design |
| **Escalation builder** | Opus 5.5 | A package a Sonnet builder failed twice, or a spike whose brief says it is algorithmically hard | Routine packages |
| **Reviewer** | Sonnet 5, fresh context | Reviews a builder's diff against the brief and the decisions doc; runs the tests; reports findings ranked by severity | Fixing what it finds; that goes back to a builder |

Codex rescue is available in this environment as a second opinion for diagnosis when a builder and the lead are both stuck. Use sparingly.

## The unit of work: a brief

A brief is a file in `context/plans/` and is the only way work is handed to an agent. It contains:

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

Decided 2026-09-27, see the decision register. Workers are in-process subagents launched by the lead with the Agent tool: `isolation: worktree` so each works in its own git worktree, a model override per role (Sonnet, Haiku, Opus), and `run_in_background` so the lead stays responsive. One worker at a time by default. Cloud routines and moving the lead session to the cloud are available as fallbacks for unattended long runs; the Workflow tool is not used because parallel fan-out is not a goal.

## The loop

1. Lead writes the brief and logs it.
2. Builder runs in an isolated worktree, logs as it goes, hands back under 300 words.
3. Reviewer runs against the diff with fresh context and hands back findings.
4. Lead reads both handbacks, spot-checks the diff, opens the PR or sends back with a delta brief. The lead reads logs only when a handback is surprising.
5. Lead promotes any design-affecting finding from logs into `context/docs/`, appends to the decision register, and updates plan status.

## Context hygiene

- Every agent reads AGENTS.md, the decisions doc and its brief. That is the bootstrap. Everything else is on request through links in the brief.
- Logs are the memory between sessions. A new session on a package starts by reading the previous log for that package, not the transcript.
- Docs are distilled; research reports are summarized into docs with links out, not pasted in.
- The lead keeps its own log per session and writes a short retrospective doc when a phase ends.

## Cost controls

- Sonnet builds, Haiku grinds, Opus only on escalation, Fable only leads.
- One agent per package, sequential. No fan-out unless the owner asks.
- Briefs carry an effort budget; a builder that exceeds it stops, logs where it is, and hands back partial work with a clear state rather than thrashing.
- Spikes are timeboxed and produce a findings doc, not production code. Until the owner opens a production tree, every package is a spike under `spikes/`, and competing approaches to one component are encouraged rather than a single blessed implementation. Sunk cost is not an argument; a findings doc that says "abandoned because X" is a successful outcome.

## Phases

- **Phase 0, derisking spikes:** three timeboxed spikes, see [the spikes plan](../plans/2026-09-27-derisking-spikes.md). Each is one builder session, Sonnet first, Opus on escalation. Output is a findings doc per spike and a go/no-go on the default decisions.
- **Phase 1, component spikes:** still under `spikes/`. In order: markdown core, doc model, relay plus a minimal web editor, GitHub adapter. Each is one or more briefs with golden tests, and may be attempted with more than one approach.
- **Phase 2, the loop:** an integration spike that wires the winning component spikes together: open a file from GitHub, edit together, comment, commit, receive an external commit. End-to-end test with recorded GitHub fixtures. This is the feasibility gate: only after it passes does the owner decide to open a production tree and start porting.
- **Phase 3, the daemon:** file materialization, MCP server, then the VS Code extension.
- **Phase 4, polish and deferred features:** offline mode hardening, Mermaid, widgets.
