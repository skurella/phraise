# Researcher log — spike 3, brief 05 (editor behaviour on external file changes)

Status: done
Author: researcher (Sonnet 5)
Updated: 2026-09-27
Related: [brief 05](../plans/2026-09-27-spike-3-brief-05-editors.md), [charter](../plans/2026-09-27-spike-3-charter-daemon-file-sync.md)
Timezone: local machine time, CEST (Europe, UTC+2), from `date`

## 11:52 — task received
Read AGENTS.md, brief 05, and charter rules section. Starting research in order: VS Code clean/dirty, vim/neovim, Typora, other writers, vim experiment.

## 11:56 — findings, per question

### 1. VS Code, clean buffer

- Detects changes via native OS APIs: inotify (Linux), FSEvents (macOS), ReadDirectoryChangesW (Windows) — not polling, except on network/remote/WSL1 mounts where it falls back to polling (5s interval reported in one case). On local macOS disk (our case), detection is FSEvents-driven and is reported as near-instant in practice (no hard number found in docs; several long-standing GitHub issues exist where the watcher *misses* events entirely rather than being merely slow — see issue #169942, #12077). Confidence: medium (latency not quantified anywhere I could find; the "usually fast, occasionally missed" pattern is well documented).
- With no unsaved changes, VS Code auto-reloads silently, no dialog. Consistent across sources (e.g. IntelliJ community post comparing to VS Code's default silent-reload). Confidence: high.
- Cursor/scroll position: community reports and VS Code issues (e.g. #32397 "Scroll position should not change when returning to file", #47587) indicate VS Code intends to preserve scroll/cursor across a silent external reload, but this is an area with several open bugs, so it is not perfectly reliable. Confidence: medium.
- Undo history: VS Code's own docs (code.visualstudio.com/docs/editing/codebasics) state Hot Exit "preserves undo history for saved files so Ctrl+Z still works after restarting" — but that's about app restart, not specifically a silent disk-reload of a clean buffer. I found no explicit statement that undo history survives a clean-buffer external reload; plausible (nothing to undo when the buffer had no pending edits) but not confirmed. Confidence: low-medium.
- Rename-over vs in-place write: no source found stating VS Code's watcher treats these differently; since it watches by path via OS filesystem events, both should surface as a change on that path. Confidence: low (inferred, not confirmed).
- Source: https://github.com/microsoft/vscode/wiki/File-Watcher-Issues, https://github.com/microsoft/vscode/wiki/File-Watcher-Internals, https://github.com/microsoft/vscode/issues/169942, https://github.com/microsoft/vscode/issues/12077, https://code.visualstudio.com/docs/editing/codebasics, https://github.com/microsoft/vscode/issues/32397, https://github.com/microsoft/vscode/issues/47587, https://github.com/microsoft/vscode/issues/68996.

### 2. VS Code, dirty buffer

- With unsaved changes, VS Code does NOT silently reload; the buffer stays dirty until the user acts. Confidence: high.
- On save, if disk is "newer" than what VS Code believes it loaded, save is refused with: "Failed to save '...': The content of the file is newer. Please compare your version with the file contents." (GitHub issue #77387, title quoted verbatim). The user is directed to compare (diff) then decide; issue #172763 requests an added "Discard & Reload from Disk" option, implying today's flow is compare-then-decide rather than one-click discard. Confidence: high for the conflict's existence/wording, medium for the exact current button set (could not confirm precise labels from a primary source).
- Detection mechanism: the word "newer" plus issue discussion strongly implies a tracked mtime/stat comparison, not a byte diff. Confidence: medium (inferred from message wording, not from source code).
- `files.autoSave`: `off` (default), `afterDelay` (default 1000ms via `files.autoSaveDelay`), `onFocusChange` (saves when focus leaves that editor), `onWindowChange` (saves when focus leaves the VS Code window) — official docs. Note: format-on-save only runs for manual saves and `onFocusChange`/`onWindowChange`, not `afterDelay`. Confidence: high.
- How VS Code itself writes (temp file + rename vs in-place): not established from any primary source found. Confidence: low / open question — flagging rather than guessing.
- Source: https://github.com/microsoft/vscode/issues/77387, https://github.com/microsoft/vscode/issues/172763, https://github.com/microsoft/vscode/issues/149928, https://code.visualstudio.com/docs/editing/codebasics.

### 3. vim / neovim

- `autoread`: off by default. With it set and the buffer clean, `:checktime` (or any trigger, e.g. `FocusGained`) reloads silently, no prompt; with the buffer dirty, autoread does not silently reload — user is "offered the choice." Confidence: high, confirmed experimentally below.
- W11 = "File has changed since editing started" (external change, clean buffer, autoread off). W12 = "File has changed and the buffer was changed in Vim as well" (external change + local unsaved edits), options [O]K (keep Vim's version) / (L)oad (take disk version). Sourced from community/wiki paraphrase, not vim's own `:help W11`/`:help W12` text verbatim. Confidence: medium-high.
- The "WARNING: The file has been changed since reading it!!!" + y/n prompt on plain `:w` triggers on **mtime change alone**, even byte-identical content (e.g. `touch`, or a `git rebase` touching mtime) — vim/vim#5936 reports this explicitly as a false positive, unresolved as of that issue. Matters for Phraise: our daemon's rename-over always changes mtime and inode, so an interactive `:w` after any remote edit trips this warning regardless of whether the user's edit actually conflicts. Confidence: high (primary GitHub issue), confirmed experimentally below.
- `backupcopy`: **vim's shipped default is `auto`** (confirmed via `vim -u NONE`). Under `auto` or `no`, `:w` renames a new file over the old one (new inode). Under `yes`, vim overwrites in place (same inode). On this machine, the system vimrc (loaded without `-u NONE`) sets `backupcopy=yes` — a host/distro configuration choice, not vim's own default; should not be assumed for arbitrary user machines. Confidence: high (experimentally confirmed here; vim-shipped default documented at vimhelp.org).
- Neovim: historically needed an explicit `autocmd FocusGained * silent! checktime` for autoread parity with gvim; both vim (since 8.2.2345) and neovim now support `FocusGained`/`FocusLost` natively, narrowing the gap. No other functional divergence found for our scenarios. Confidence: medium (secondary sources only).
- Source: https://github.com/vim/vim/issues/5936, https://vimhelp.org/options.txt.html#%27backupcopy%27, https://vim.fandom.com/wiki/Have_Vim_check_automatically_if_the_file_has_changed_externally, https://batsov.com/articles/2025/06/02/how-to-vim-reloading-file-buffers/, https://github.com/neovim/neovim/issues/1936.

### 4. Typora

- No live file-watcher while editing in the general case: typora-issues#6560 and #5209 both state Typora "has no autosave and no auto-refresh" and "only checks for external changes on save" — but typora-issues#6578 separately reports that when Typora *is* tracking the file, an external change does trigger an auto-reload that also **steals window focus** ("Typora reloads file and gains focus"), explicitly called out as disruptive for AI-agent-style external writers. These two reports read as inconsistent (possibly version/platform-dependent); both are presented rather than picked between. Confidence: medium (community issue reports, not vendor docs).
- On save with unsaved local edits, when Typora infers an external change (from mtime alone, not content — per #5208), it shows one generic save-conflict dialog every time: **Save Anyway** (overwrite disk with Typora's version), **Revert** (discard local edits, take disk version), **Save As** (write elsewhere). Confidence: medium-high (direct issue quotes).
- Explicitly acknowledged open gap (feature request #5209): Typora does not distinguish "mtime-only, content identical" from a real conflict, and has no in-app diff/merge (reporter contrasts with WebStorm/BBEdit) — so every daemon rewrite of a file open with unsaved Typora edits surfaces the same blocking, undifferentiated dialog. Confidence: high that this is the documented gap; medium on whether a fix has since shipped (no closing changelog entry found).
- I did not find official Typora documentation (support.typora.io) stating this behavior precisely; the above is sourced only from Typora's own public issue tracker, not vendor docs — stating this plainly per the brief.
- Source: https://github.com/typora/typora-issues/issues/5208, https://github.com/typora/typora-issues/issues/5209, https://github.com/typora/typora-issues/issues/6578, https://github.com/typora/typora-issues/issues/6560.

### 5. Other writers, one line each

- **Claude Code's Edit/Write tools**: yes — they cache `(file_path, last_known_mtime)` from the prior Read and refuse to Edit/Write with "File has been modified since read, either by the user or by a linter" if disk mtime moved since that Read, requiring a fresh Read to proceed; corroborated by several first-party bug reports describing this cache-and-compare mechanism and its false positives (e.g. the tool's own previous edit outrunning its cache refresh). Source: github.com/anthropics/claude-code issues #48390, #33856, #3513, #28383, #5981. Confidence: high (multiple consistent first-party issue descriptions; no formal spec doc fetched).
- **`sed -i`**: writes a new temp file and renames over the original (same pattern as our daemon) — new inode each time; can break inode-based watchers even though path-based watchers are unaffected. Confidence: high.
- **JetBrains IDEs**: with "Synchronize files on frame activation" on, a clean buffer silently refreshes from disk on focus-in; if the buffer is also dirty, a blocking "File Cache Conflict" dialog forces the user to pick a side — no automatic-external-wins option. Source: intellij-support community posts (forum, not JetBrains reference docs). Confidence: medium.

### 6. Experiment — vim headless, in `$TMPDIR/phraise-vim-exp-66938` (removed after use)

vim 9.1 at /usr/bin/vim; no nvim on this machine. All runs used `vim -Es` (Ex silent batch mode) with `-c`/`-S` scripting, per the brief's suggestion; `expect`/`script` were not needed. Commands are reproduced in full below so they can be rerun verbatim (the temp dir itself was deleted per the experiments-in-temp-dir-only rule).

**(a) Does `:w` change the inode, per `backupcopy`?**
- `vim -Es -u NONE -N -c 'set backupcopy?' -c q file` printed `backupcopy=auto` — vim's true shipped default. Plain `vim -Es` (system vimrc loaded) printed `backupcopy=yes` — this machine's vimrc overrides the default; worth noting as host-specific, not vim's own default.
- Under `-u NONE` (`backupcopy=auto`): `stat -f '%i'` before = 114565372; after `vim -Es -u NONE -N -c "call setline(1,['line1','line2'])" -c wq file` = 114565392. **Inode changed.**
- Under system default (`backupcopy=yes`), identical script without `-u NONE`: inode before = 114565394, after = 114565394. **Inode unchanged.**
- Confidence: high — directly reproduced, deterministic.

**(b) Buffer loaded, external rename-over, then `:checktime`, non-interactive**
- Clean buffer, `autoread` off (vim default): loaded `original content`; via `:call system('echo ... > file.new && mv file.new file')` renamed a new file over the open one (content became `externally changed content`); `:checktime` produced no message and did **not** reload the buffer (still held `original content`); a subsequent `w!` then **overwrote the externally-written disk content back to `original content`** — i.e. in unattended/batch vim with autoread off, a later forced save silently clobbers a concurrent external change. Realistic risk for any headless/scripted vim (or a plugin driving vim non-interactively) against a Phraise-daemon-managed file.
- Clean buffer, `autoread` **on**: identical external rename-over, then `:checktime` — buffer **was silently reloaded** to `externally changed content 2` (confirmed by writing it out and reading it back). So `autoread` transparently follows a rename-over (inode change), not just an in-place write — consistent with vim watching by path, not by inode.
- Dirty buffer (`locally edited line`, unsaved), external rename-over, then plain `:w` (no bang) with stdin from `/dev/null` (simulating "no interactive answer available"): vim printed `WARNING: The file has been changed since reading it!!!` / `Do you really want to write to it (y/n)?` and, receiving no input, **did not write** — disk was left holding the externally-written content (`externally changed content 4`); the local dirty edit was silently dropped rather than the external change being clobbered. This is the opposite failure mode from the clean-buffer case above: the unattended default under ambiguity for a *non-bang* `:w` is "abort the write" — but a script or keybinding using `:w!` removes this safety and reproduces the clean-buffer clobber.
- Confidence: high — all three sub-experiments directly reproduced with captured output/exit state, not inferred from docs.

### Is a VS Code extension needed for a good experience, or only for comments and presence?

An extension is not strictly required for the *baseline* file-sync experience: on a clean buffer VS Code already auto-reloads silently and fast via FSEvents, matching D7's rename-over-with-debounce design reasonably well (§1). But without an extension, two gaps remain that a plain daemon-writes-the-file approach cannot close from outside the editor: (1) VS Code cannot tell the daemon which version its dirty buffer holds, so the daemon's stated fallback ("assume the older version") is the *only* signal available, and (2) a save from a dirty buffer whose file has since changed on disk is refused with a "content is newer" error the user must manually resolve (§2) — exactly the collision Brief context describes as solvable "an editor extension could tell the daemon exactly which version the buffer holds." So: not needed for baseline reload behaviour, but needed to remove the two remaining rough edges (accurate buffer-version reporting, and avoiding/streamlining the newer-content save conflict) — beyond comments and presence, which need an extension for other reasons entirely (they have no disk representation to react to). Confidence: medium — this is a reasoned synthesis of the findings above, not a separate citation.

## 11:57 — handback
All six questions answered with citations/confidence; vim experiment run and results captured above. No code or other docs touched; nothing committed (orchestrator commits this log). Handing back to orchestrator.

