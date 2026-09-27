# AGENTS.md — bootstrapping any agent working on Phraise

Phraise is a Google-Docs-grade collaborative editor for Markdown files that live in Git repositories. Mental model: **a shared, multi-user working tree for a branch.** Git holds committed history. Phraise holds the uncommitted, real-time, commented working copy, and commits only when a human asks.

The project is FOSS (MIT, see `LICENSE`). Repo: `github.com/skurella/phraise`. Owner: Seb Kurella.

## Read this first, then only what your brief names

1. This file.
2. `context/docs/2026-09-27-architecture-decisions.md` — the decisions that must not be silently reversed. `context/docs/2026-09-27-decision-register.md` is the one-page index of every decision with impact and difficulty ratings.
3. The plan file your brief points at in `context/plans/`.
4. Any other doc your brief lists. Do **not** read the whole `context/` tree; that wastes context and the lead has already distilled it for you.

If you are the lead agent, also keep `context/docs/2026-09-27-agent-workflow.md` in mind: it defines roles, briefs, handbacks and review.

## The `context/` directory

| Directory | Purpose | Lifetime |
|---|---|---|
| `context/docs/` | Vision, research, designs, decisions, retrospectives. The durable truth. | Long-term. Superseded docs get a `Status: superseded by ...` line, never deleted. |
| `context/plans/` | Implementation plans and task briefs only. What to build, in what order, with what definition of done. | Until done. A finished plan gets `Status: done` and stays for history. Designs do not live here. |
| `context/logs/` | Per-agent-session logs of key events: task received, findings, decisions taken, blockers, handback. | Append-only. |

Rules that apply to every file in `context/`:

- Markdown only.
- File names start with the ISO date of creation: `2026-09-27-<slug>.md`. Never rename to a later date; create a new file instead.
- Every file starts with a short header block: `Status`, `Author` (agent role and model), `Updated`, and for plans and logs the related plan or doc.
- Cross-reference with relative links. Prefer linking a doc over restating it.

## Logging protocol (mandatory for every agent, lead included)

- One log file per agent session: `context/logs/<date>-<role>-<short-task>.md`, e.g. `2026-09-28-worker-markdown-core.md`.
- Entries are timestamped lines or short sections: `## 14:32 — <event>`. Use the local time zone of the machine and state it once at the top.
- Log: task received (link the brief), material findings, decisions you took and why, anything that contradicts a doc, blockers, tests run and their result, and the final handback summary.
- A finding that changes a design belongs in the log first, then the lead promotes it into a doc. Workers do not edit `context/docs/` unless their brief says so.

## Working agreements

- Do not start a work package without a brief in `context/plans/`. If you are handed a task without one, write the brief first and log that you did.
- Definition of done is executable: tests, fixtures, or a reproducible command. "Looks right" is not done.
- Keep handbacks short: outcome, what was verified and how, what was left out and why, links to the log and any changed docs. Under 300 words.
- **All code lives under `spikes/` for now.** There is no main source tree yet, by owner decision (2026-09-27). Each spike is `spikes/<date>-<component>-<approach>/` with its own README, dependencies and tests. Multiple approaches to the same component are welcome; throw away what does not work and say so in the findings doc. Integration into a production tree begins only when several spikes demonstrate feasibility and the key risks are resolved as far as practicable. Never import one spike from another by relative path; copy what you need and note the origin.
- Never commit secrets or tokens. GitHub App credentials are read from the environment.
- Git policy, set by the owner on 2026-09-27: agents commit and push freely to branches. `main` is protected and accepts only PRs with squash merge, so **every PR must read as one good commit on `main`**: one purpose, a title that works as a commit subject, a body that stands alone. Nobody merges to `main`; the owner does. Workers commit to their branch when their brief says so; the lead opens PRs.
- Owner engagement: the owner is hands-off. The lead makes every call and escalates only when truly blocked. Every decision is recorded in `context/docs/2026-09-27-decision-register.md` with an impact and difficulty rating so the owner can review them at a glance.

## Key architectural commitments (details in the decisions doc)

1. Git is canonical. The CRDT is a session layer, re-seeded from commits.
2. Block-preserving Markdown: untouched blocks round-trip byte for byte; unknown constructs become opaque source blocks.
3. Comments are our own data model, anchored by CRDT position plus quote selectors. GitHub PR comments are an export, not storage.
4. External commits, offline returns and merges are one operation: diff applied as CRDT ops, never a blocking merge dialog.
5. A local daemon materializes live docs as real files; the MCP server and IDE extensions sit on top of it.
6. No "log in with your Claude subscription". BYO API key and MCP.
