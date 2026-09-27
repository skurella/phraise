# Brief 05: how real editors behave when a file changes under them

Status: done
Author: spike 3 orchestrator (Opus 5.5)
Updated: 2026-09-27
Charter: [spike 3 charter](2026-09-27-spike-3-charter-daemon-file-sync.md), section "What to address in the findings" (first bullet) and "Rules for every agent in this spike", which you obey
Role and model: researcher, Sonnet

## Goal

Establish, with citations or experiments, what VS Code, vim and Typora do when a daemon rewrites a Markdown file the user has open, and what that means for the Phraise daemon (D7). The orchestrator writes the findings doc; you produce the evidence.

## Context you need (no other reading required)

The daemon writes remote edits to the file by writing a temporary file in the same directory and renaming it over the original (new inode, new mtime), debounced by about 30 ms after a remote edit. It imports a save by diffing the saved bytes against the version it believes the editor had loaded, chosen from the recent versions it wrote. It cannot know for certain which version an editor loaded; when unsure it assumes the older one, so a save of a stale buffer never reverts remote edits, but a user deleting text a collaborator just added, in a buffer that auto-reloaded, can be ignored. An editor extension could tell the daemon exactly which version the buffer holds.

## Questions, in order

1. **VS Code, clean buffer.** When the file changes on disk and the editor has no unsaved changes: does it reload automatically, how fast (file watcher latency on macOS), does it keep cursor and scroll position, does undo history survive, does a rename-over (inode change) behave differently from an in-place write?
2. **VS Code, dirty buffer.** When the file changes on disk and the editor has unsaved changes: what does the user see, and what happens on save ("file is newer" conflict, Compare and Overwrite)? What do `files.autoSave` settings change (afterDelay, onFocusChange)? How does VS Code save: in place, or temporary file and rename? Does it check mtime before saving?
3. **vim / neovim.** `autoread`, `checktime`, the W11 and W12 warnings, the "file has been changed since reading it" prompt on `:w`, and `backupcopy` (does `:w` write in place or rename, on macOS by default). Neovim differences, if any.
4. **Typora.** What happens on an external change with and without unsaved changes. Cite documentation or credible issue reports; say plainly if you cannot find any.
5. **Other writers worth one line each:** Claude Code's Edit and Write tools (do they refuse to write a file modified since it was read?), `sed -i`, JetBrains IDEs.
6. **Experiment, if feasible:** vim is on this machine (`which vim nvim`). In a temporary directory under `$TMPDIR` only, script vim headlessly (for example `vim -Es` with commands, or `script`/`expect` if available) to observe: (a) `:w` behaviour with `backupcopy` default: does the inode change? (b) with a buffer loaded, change the file externally with a rename-over, then `:checktime` and report what vim does in non-interactive mode. Record exact commands and outputs. Do not open any GUI application, and do not touch files outside your temporary directory. If an experiment is not feasible headlessly, say so and rely on documentation.

## Deliverable

Your log, `context/logs/2026-09-27-researcher-spike-3-editors.md`, with timestamps from `date`, containing for each editor: the behaviour, what the user would see when Phraise rewrites the file (clean buffer, dirty buffer, save after a remote change), the source (URL to documentation, source code, or issue, or your experiment), and your confidence. End with a short section: "Is a VS Code extension needed for a good experience, or only for comments and presence?", with your reasoning.

## Constraints

- Web research with WebSearch and WebFetch is expected. Quote at most a sentence from any source; summarize otherwise.
- Only add your log file. Do not change code or other docs. Do not commit; the orchestrator commits your log.
- Do not launch other agents.

## Handback

Under 300 words: one line per editor with the key behaviour and the confidence, the experiment results in one line each, your answer on the extension question, and the path of your log.
