# Brief: fresh-context review of spike 4

Status: active
Author: spike 4 orchestrator (Opus 5.5)
Updated: 2026-09-27
Related: [charter](2026-09-27-spike-4-charter-github-storage.md), [plan](2026-09-27-spike-4-plan.md)
Model: Sonnet. Commits: no. Worktree: the orchestrator's, shared, no isolation.

## Goal

Independently check that the spike 4 scripts cannot violate the charter's hard safety rules, and that the findings doc says only what the recorded evidence supports. Serves D2, D6, D9.

## Scope

- `spikes/2026-09-27-github-storage-ghapi/lib.sh` and every `*.sh` next to it: can any path write to a ref or endpoint outside the allow-list, exceed 300 writes, skip the 1.1 s spacing, continue after a 403 or 429, or print, log or store the token or an Authorization header?
- `context/docs/2026-09-27-spike-4-findings-github-storage.md`: every number and claim against `spikes/2026-09-27-github-storage-ghapi/evidence/*`.

Non-scope: style, rewriting scripts, running any script that writes to GitHub. **You make no write to GitHub at all.**

## Inputs

AGENTS.md, the charter's "Hard safety rules" section, the files above. Nothing else.

## Definition of done

- Run `./selftest.sh` (offline) in the spike directory and report its result. You may also run `./run-nondestructive.sh` (read-only) once.
- `grep -r` the spike directory and `context/` for anything that looks like a token (`gho_`, `ghp_`, `github_pat_`, `Authorization`) and report the result.
- A findings list, each item with severity (blocker, major, minor), file and line, and the evidence.

## Handback

Under 300 words: verdict, findings by severity, what you ran. Log in `context/logs/2026-09-27-reviewer-spike-4.md`.
