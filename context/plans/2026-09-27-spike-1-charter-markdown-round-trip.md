# Charter: spike 1, block-preserving Markdown round trip

Status: dispatched
Author: lead agent (Fable 5.1)
Updated: 2026-09-27
Owner of this spike: one spike orchestrator (Opus 5.5)
Serves: decisions D4 and D10b in [architecture decisions](../docs/2026-09-27-architecture-decisions.md)
Starting point, not prescription: spike 1 section of [the spikes plan](2026-09-27-derisking-spikes.md)

## Why this spike exists

Phraise must let someone open a Markdown file from a repo, change one word in a rich-text editor, and produce a one-line git diff. No existing editor does this; all of them normalize the file. If we cannot do it, the product loses the trust of every developer who looks at the first diff, and the document model has to be redesigned. This is the highest-impact unknown in the project.

## Goal

Demonstrate a document model and serializer in which untouched blocks round-trip byte for byte and an edit to one block changes only that block's bytes, on a corpus of real-world Markdown. Produce evidence, not a product.

## Success gates

| Gate | Requirement |
|---|---|
| A. No-edit round trip | Parse to the editor document model and serialize back, with no edits: byte-identical for 100 percent of corpus files. Any exception must be explained and judged acceptable or not. |
| B. Single-word edit | For each corpus file, programmatically change one word in one paragraph through the document model, serialize, diff against the original: the diff touches only that block in at least 98 percent of files. Failures are categorized. |
| C. Opaque blocks | Front matter, raw HTML blocks, MDX/JSX, math, footnote definitions, link reference definitions, Mermaid and other fenced code, and tables survive gates A and B byte for byte, whether modeled or opaque. |
| D. Editor-model fidelity | The document model is a real ProseMirror schema and documents, not a private AST, so that the result transfers to Tiptap and y-prosemirror. Edits in gate B are ProseMirror transactions. |
| E. Style detection | When a block must be re-serialized, it uses the file's own conventions for bullet marker, emphasis marker, fence style, heading style and line endings. Demonstrated on at least ten files with differing conventions. |

Stretch, only if cheap: semantic line breaks as an option for re-serialized paragraphs; a list-item edit touching only that item rather than the whole list.

## Corpus rules

- 200 to 300 real README and design-doc files from public repositories with permissive licenses, varied in style and size, plus the CommonMark spec examples and GFM examples, plus hand-written edge cases including CRLF files, files without a trailing newline, tabs, nested lists with mixed markers, and hard line breaks.
- **Do not commit third-party files.** Commit a manifest with repository, path, commit SHA and license, and a fetch script that downloads into a git-ignored directory. Hand-written edge cases are committed.

## Constraints

- All code under `spikes/<date>-markdown-core-<approach>/`, self-contained, with a README stating goal, status and how to run. A second approach gets a second directory. See `spikes/README.md`.
- Language default is TypeScript. Toolchain on this machine: Node 22.12.0, npm 11. **pnpm is broken here; use npm.** Rust 1.93 is available if a Rust or wasm parser is tried.
- You choose the parser and approach. Known candidates and prior art are in the [technology assessment](../docs/2026-09-27-technology-assessment.md), section B. Read prior art for ideas; do not copy code from repositories without a license.
- Bash runs in a sandbox. The npm registry and raw.githubusercontent.com are reachable inside it. `git push`, `git fetch` and `gh` are not; retry those with the sandbox disabled for that single command. If a network need is blocked, log it and work around it or hand back.
- No secrets, no tokens, no GitHub API writes other than pushing this branch.

## Branch and commits

- Branch `spike/2026-09-27-markdown-round-trip` exists and contains this charter. In your worktree, check it out and work there. Commit early and often with clear messages; push at milestones and before handback.
- The branch is based on the unmerged bootstrap branch. Do not rebase; the lead will handle that.
- Do not open a PR and do not merge. The lead opens the PR, which will be squash-merged as one commit, so keep the branch to this spike only.

## Authority and escalation

You decide everything within this charter: approach, libraries, task split, which worker model does what, when to abandon an approach and try another. Record each non-trivial decision as a row in the [decision register](../docs/2026-09-27-decision-register.md) with impact and difficulty, marked "orchestrator, spike 1".

Escalate to the lead, by handing back early, only if: a locked decision needs to change, gates A or B look unachievable with any approach, or you have used twice the budget.

## Budget

About eight worker dispatches in total across builders, grinders and reviewers. Prefer Haiku for the corpus and fixtures, Sonnet for implementation and review, and your own effort for planning, hard algorithmic design and judging results. Do small things yourself when a dispatch would cost more than doing it.

## Deliverables

1. Spike code and tests under `spikes/`, with a single command that runs all gates and prints a results table.
2. `context/docs/<date>-spike-1-findings-markdown-round-trip.md`: gate results with numbers, the approach and why, what was tried and abandoned, the list of constructs modeled versus opaque, failure categories for gate B, whether remark positions sufficed or a CST parser is needed, open risks, and a recommendation for D4 and D10b: confirm, amend or replace.
3. Task briefs in `context/plans/` and one log per agent session in `context/logs/`, per AGENTS.md.
4. Rows in the decision register.
5. Everything committed and pushed on the branch.

## Handback to the lead

Under 400 words: gate results as a table, the recommendation for D4 and D10b, decisions you took that the lead should review first, what was left out and why, and the paths of the findings doc and your log.
