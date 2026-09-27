# Brief 05: fresh-context review of the round-trip spike

Status: dispatched
Author: spike orchestrator (Opus 5.5)
Updated: 2026-09-27
Plan: [spike 1 plan](2026-09-27-spike-1-plan-markdown-round-trip.md)
Worker: reviewer (Sonnet, fresh context)

## Goal

Find what is wrong with the evidence before the lead relies on it. The spike claims that its document model and serializer meet the charter's gates A to E (decision D4). Review the code and, above all, the **measurement**: could the gates pass while the claim is false?

## Inputs

- `AGENTS.md`; D4 in `context/docs/2026-09-27-architecture-decisions.md`; the gate table in `context/plans/2026-09-27-spike-1-charter-markdown-round-trip.md`.
- `spikes/2026-09-27-markdown-core-remark-splice/`: `README.md`, `src/`, `gates/`, `test/`, `results/gates.md`.
- Working directory `/Users/skk/code/phraise/.claude/worktrees/agent-af7320636299cd0d4`. Run `npm ci`, `npm run fetch` (if `corpus/fetched/` is missing), `npm test` and `npm run gates` (about 8 minutes) inside the spike directory.

## What to check, in priority order

1. **Gate integrity.** For gate B (and B2): is the edit really applied, is the chosen word really in the paragraph the containment check uses, is the semantic check strong enough to catch a wrong output (does `semanticEq` ignore anything that matters: text, marks, link targets, list numbering, code content, table alignment)? Are there attrs marked meta (`src`, `gap`, `refType`, `leafMarks`, `*Hint`) that should be semantic? Could a serializer that ignores the edit pass? Try to break it: write a few adversarial edits of your own (a word next to an escaped character, a word in a table cell, a word at the start of a list item continuation line, a word in a CRLF file, a word in a heading inside a blockquote) and check the output by hand.
2. **Gate A.** Is byte identity by construction hiding problems? The parser turns blocks that fail an isolation re-parse into opaque `unstable:` blocks; how many, and is that acceptable? Are opaque blocks ever silently produced where a modeled block was expected?
3. **Correctness risks in `src/serialize.ts`**: the splice ladder (text, link, textblock), offset arithmetic with the prepended definitions context, CRLF, the unverified fallback (what happens to the user's file when every candidate fails verification?).
4. **Gate E**: is the convention check meaningful or trivially satisfied?
5. **Reproducibility**: does a clean checkout plus `npm ci && npm run fetch && npm run gates` work? Is any third-party content committed?

## Output

Do not fix anything. Write findings to your log with severity (blocker, major, minor, nit), each with a reproduction (file, command or snippet) where possible. Keep any adversarial test scripts you write under `spikes/2026-09-27-markdown-core-remark-splice/review/` and commit them with your log.

## Constraints

- Model: Sonnet. Budget: about 90 minutes.
- The Bash sandbox is off; network and git work normally. npm only. One git command per Bash call. Commit on the current branch; do not push.
- Do not launch further agents.
- Log at `context/logs/2026-09-27-reviewer-spike-1.md` per AGENTS.md.

## Handback, under 300 words

Findings by severity with one-line reproductions, what you verified as sound, commit SHA, log path.
