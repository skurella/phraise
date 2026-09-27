# Brief 05: editor-binding fidelity probe and Yjs 14 attribution probe

Status: active
Author: spike orchestrator (Opus 5.5)
Updated: 2026-09-27
Related: [plan](2026-09-27-spike-2-plan.md), [charter](2026-09-27-spike-2-charter-crdt-rebase.md) gates E and I
Assignee: builder (Sonnet)

## Goal

The lead reports that y-prosemirror 1.3.7 drops (a) attributes of the ProseMirror root `doc` node and (b) marks on inline leaf (atom) nodes, for example a link mark around an image, as in a linked badge `[![ci](badge.svg)](https://ci)`. Reproduce both with tiny tests, run the same tests against `loro-prosemirror` 0.4.4 and the Yjs 14 release-candidate binding, and probe whether the Yjs 14 attribution API is usable today. Serves D5 and the charter's stretch goal.

## Scope

New self-contained package `spikes/2026-09-27-crdt-rebase-binding-probe/` (TypeScript, npm, vitest). Its own tiny schema: `doc` with one attribute (for example `frontmatter`, default `null`), `paragraph`, `text`, an inline atom `image(src, alt)`, marks `link(href)` and `strong`. No imports from other spike directories.

Work through these tasks in order and stop after the last one or when blocked; a blocked task is recorded with the exact error and you move to the next.

1. **y-prosemirror 1.3.7 + yjs 13.6.33.** Fixture: a doc with `frontmatter` set and a paragraph `see [![ci](badge.svg)](https://ci) now` (image with a link mark, text around it). Test three paths: (i) `prosemirrorToYXmlFragment` then `yXmlFragmentToProseMirrorRootNode`; (ii) `updateYFragment` from an empty fragment to the fixture, then read back (this is the path the live `ySyncPlugin` uses); (iii) the real `ySyncPlugin` in an `EditorView` under `jsdom`, typing a transaction that adds the link mark around an existing image, then reading the Y doc into a second doc and back to ProseMirror. Assert equality with the fixture and record which information is lost on each path.
2. **loro-prosemirror 0.4.4 + loro-crdt 1.16.3.** The same fixture through its headless entry points (`updateLoroToPmState`, `createNodeFromLoroObj`; read its source) and through `LoroSyncPlugin` under `jsdom`. Same assertions.
3. **Yjs 14 RC binding.** Packages `@y/y` (tag `beta`, 14.0.0-rc.26) and `@y/prosemirror` (tag `beta`, 2.0.0-13). Same fixture through whatever headless conversion and plugin the package offers (read its README and source). Same assertions. If it will not install or run, record the error.
4. **Yjs 14 attribution probe.** Using `@y/y` and its attribution manager (see the upstream `attributing-content.md` in the package or repo), check whether you can list which client inserted which ranges of a text with two clients, and whether that works for a document forked and merged the way this spike's rebase does (fork at an earlier state, edit with a third client, merge). Record the API used and whether it is usable today.
5. **Workaround sketches, no production code**: for each loss found, state in the README what each remedy would take, with a rough size: upstream patch to the binding (point at the exact function), a maintained fork, a schema change (for example link as an attribute on the image node, or a wrapping inline node; root attrs moved into a separate map), or switching library. Keep it factual.

## Definition of done

`npm install && npm test` in the new directory runs the probe tests; tests that demonstrate a loss are written to assert the observed behaviour (for example `expect(lostMarks).toEqual(["link"])`) so the suite passes and documents reality. README: a result table (binding x path x root attrs kept? x atom marks kept?), the attribution probe result, the remedy sketches. `npx tsc --noEmit` clean. Commit.

## Constraints

- Model Sonnet. Budget is the ordered task list above; there is no time budget. Stop after task 5, or earlier only if every remaining task is blocked.
- Working directory `/Users/skk/code/phraise/.claude/worktrees/agent-afb20bfe01387fcb2`, absolute paths. No agents. Only add new files. Stage explicitly. Do not push.
- Log: `context/logs/2026-09-27-builder-spike-2-binding-probe.md`; every heading timestamp comes from `date` at the moment of writing, never estimated; entries at every milestone.

## Handback

Under 300 words: the result table, attribution probe verdict, remedy sketches condensed, blocked tasks with errors, commit hash.
