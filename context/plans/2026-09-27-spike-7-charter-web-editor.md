# Charter: spike 7, the web editor in a real browser

Status: dispatched
Author: lead agent (Fable 5.1)
Updated: 2026-09-27
Owner of this spike: one spike orchestrator (Opus 5.5)
Serves: the vision's first requirement in [vision](../docs/2026-09-27-vision.md), and decisions D3, D4 and D5 in [architecture decisions](../docs/2026-09-27-architecture-decisions.md)

## Why this spike exists

The owner's first requirement is an editing experience like Google Docs, in which a non-technical user never needs to know the document is Markdown. Five spikes proved the machinery underneath, all headless or in a simulated browser. Nobody has yet typed into a Phraise editor. The untested risks are the ones users meet first: real keyboard input, input methods for languages such as Chinese and Japanese, paste, undo, blocks the editor does not understand, comments, and working offline.

## Independence

This spike runs in parallel with spike 6, the integrated engine, and shares nothing with it. Build on spike 5's stack 13 relay and plugins and spike 1's document model as they are.

## What you build on

Five spikes are finished. **Copy** what you need from them, never import across spike directories, and note origin branch and commit in your README. If a branch below no longer exists on origin, its PR was merged and the same files are on `origin/main`.

| Spike | Branch and commit | Directory | Findings doc in `context/docs/` |
|---|---|---|---|
| 1. Markdown round trip | `origin/spike/2026-09-27-markdown-round-trip` at `1e1f4a6` | `spikes/2026-09-27-markdown-core-remark-splice/` | `2026-09-27-spike-1-findings-markdown-round-trip.md` |
| 2. CRDT rebase, comment anchors | `origin/spike/2026-09-27-crdt-rebase` at `ab552ed` | `spikes/2026-09-27-crdt-rebase-yjs-fork/` | `2026-09-27-spike-2-findings-crdt-rebase.md` |
| 3. Daemon file sync | `origin/spike/2026-09-27-daemon-file-sync` at `9343b62` | `spikes/2026-09-27-daemon-file-sync-fork-import/` | `2026-09-27-spike-3-findings-daemon-file-sync.md` |
| 4. GitHub storage | on `origin/main` | `spikes/2026-09-27-github-storage-ghapi/` | `2026-09-27-spike-4-findings-github-storage.md` |
| 5. Collaboration stack | `origin/spike/2026-09-27-collab-stack` at `eeb3fe2` | `spikes/2026-09-27-collab-stack-yjs13-hocuspocus/` | `2026-09-27-spike-5-findings-collab-stack.md` |

Read findings with `git show <branch>:context/docs/<file>`. The architecture decisions doc on each branch carries the lead's amendments made after that spike; read the amendment sections on all four branches, because `main` does not have them all yet.

## Goal

A small but real web application: Tiptap 3 on the Phraise schema, the two Yjs 13 workaround plugins, spike 5's relay, and spike 1's parser and serializer running in the page. Tested with Playwright in Chromium, and in WebKit and Firefox where that is cheap. It opens a Markdown file the relay seeds from disk and can show the resulting Markdown.

## Success gates

| Gate | Requirement |
|---|---|
| A. Typing | With real keyboard events: typing, Enter, Backspace across block boundaries, splitting and joining, bold, italic, code and link by shortcut, lists with Tab and Shift-Tab, editing a table cell. After each scenario the serialized Markdown is as expected and untouched blocks are byte-identical. |
| B. Markdown affordances | Typing `# `, `- `, `1. `, `> ` and a code fence at the start of a line produces the block. Pasting Markdown text produces rich content. Copying a selection puts Markdown and HTML on the clipboard. |
| C. Blocks the editor does not model | Raw HTML, front matter, math, footnote definitions and link reference definitions appear as source blocks, editable as source, and are never corrupted by edits around them. Mermaid fences render as diagrams with the source editable. HTML preview, if shown, is sanitized. |
| D. Collaboration | Two browser contexts on one document through the relay: each sees the other's edits and a named, coloured cursor. Changing a linked image's address and link together works in both. |
| E. Undo | Undo and redo affect only the user's own changes and never remove the other user's typing. |
| F. Comments | Select text and add a comment; a sidebar shows threads; reply and resolve. The highlight follows the text through the other user's edits. A comment whose text is deleted is shown as orphaned with its quote. |
| G. Input methods | Composition input, driven through the browser's debugging protocol, in one editor while the other types in the same paragraph. Report what breaks; collaborative editors are known to be fragile here. |
| H. When the serializer cannot verify a block | The editor shows the block as source with the best-effort Markdown and asks for confirmation, as decided under D4. Demonstrate with a construct from spike 1's list of failures. |
| I. Offline | The document persists in the browser. With the network off: edit, reload the page, edit again. With the network back: the edits merge and both browsers converge. |
| J. Feel | In normal editing no Markdown syntax is visible. Commit a set of screenshots, small PNG files, of a real README from the corpus, a design doc with tables and code, a comment thread, two cursors, a source block and a rendered Mermaid diagram, so that the owner can judge the look. Plain, clean styling; no design system. |
| K. Scale | On the 240 KB document: load time, and the delay from key press to paint at the 95th percentile while a second user types. |

## What to address in the findings

- Which Tiptap extensions were used as they are, which were replaced, and why.
- How the editor's schema is kept identical to spike 1's, given that Tiptap builds its own schema instance.
- What a user can do in the editor that the serializer cannot express in Markdown, and how the editor prevents or handles it.
- Whether running the parser and serializer in the page is fast enough, or whether they belong in a worker.
- Every place where the experience falls short of Google Docs, ranked by how much a non-technical user would notice.

## Out of scope

Git, commits, drafts, the daemon, authentication beyond a name in the address bar, mobile, a design system.

## Constraints

- All code under `spikes/2026-09-27-web-editor-tiptap/`, or one directory per approach if you try more than one.
- Ports 4400 to 4499.
- Playwright installs its browsers into a cache inside the spike directory that is ignored by git.
- Screenshots are the only binary files committed, each under 300 KB.

## Rules for every agent in this spike

- **Only add new files.** Do not edit `AGENTS.md`, the decision register, other docs, or anything belonging to another spike. Record decisions in a "Decisions" table in the findings doc with impact and difficulty ratings; the lead transfers them to the register.
- **No wall-clock budgets.** Agents cannot perceive elapsed time. Briefs budget by an ordered task list with a stated stopping point. Nobody stops or cuts scope because they believe time ran out.
- **Timestamps come only from the output of `date`** at the moment of writing. Never estimated.
- **Long verification runs belong to the orchestrator.** A builder is done when the quick subset passes and the full command is documented.
- **Verify claims that have consequences** by running the check yourself.
- **Report failing gates as failing.** If the gate command exits with a failure, say so in the first line of the handback, whatever the reason.
- **Unit tests are required.** `npm test` must find and pass real tests. Gate scripts are in addition to unit tests, not instead of them.
- Commit incrementally. Stage paths explicitly; never `git add -A` or `git add .`. Do not commit `node_modules`, databases, browser binaries or fetched corpora.
- Log at every milestone and at every task boundary.
- TypeScript on Node 22.12.0 with npm 11. **pnpm is broken on this machine; use npm.** The Bash sandbox is off.
- Local servers bind to 127.0.0.1 only, on ports in the range this charter assigns, and are stopped when a run ends.
- Tests use temporary directories and temporary git repositories under `$TMPDIR`. Never use the Phraise repository or any of the owner's directories as test data. No GitHub API calls and no pushes other than pushing this branch.

## Branch and commits

Branch `spike/2026-09-27-web-editor` exists, is based on `main`, and contains this charter. Check it out in your worktree. Do not open a PR and do not merge.

## Authority, escalation, budget

You decide everything within this charter. Escalate by handing back early only if a locked decision needs to change, gates A or D look unachievable, or you have used twice the budget. Budget: about fourteen worker dispatches.

## Deliverables

1. The application, unit tests, Playwright tests, and one command that runs all gates and prints a results table. A second command that starts the relay and the application so that the owner can open it in a browser, with the address printed.
2. `context/docs/<date>-spike-7-findings-web-editor.md`: gate results, the points above, the screenshots embedded by relative path, the Decisions table, open risks, and a verdict on whether the editing experience the vision asks for is within reach.
3. Briefs in `context/plans/` and one log per agent session in `context/logs/`, names containing `spike-7`.
4. Everything committed and pushed.

## Handback to the lead

Under 400 words. First line: whether the gate command passes. Then gate results as a table, the verdict, decisions the lead should review first, what was left out and why, the command that starts the application, and the paths of the findings doc and your log.
