# Spike 3 findings: the local daemon, live documents as real files

Status: final for spike 3
Author: spike 3 orchestrator (Opus 5.5)
Updated: 2026-09-27
Charter: [spike 3 charter](../plans/2026-09-27-spike-3-charter-daemon-file-sync.md)
Plan and design spec: [spike 3 plan](../plans/2026-09-27-spike-3-plan.md)
Code: [`spikes/2026-09-27-daemon-file-sync-fork-import/`](../../spikes/2026-09-27-daemon-file-sync-fork-import/README.md)
Results: `results/gates.md` in the spike directory
Log: [orchestrator log](../logs/2026-09-27-orchestrator-spike-3.md)

## Answer

D7 works. A headless daemon connected to a Hocuspocus relay writes the document to a real file in a git working tree, imports saves as operations confined to the edited blocks and attributed to the local user, never echoes its own writes, never reverts remote edits on a stale save in the scripted cases, detaches when git changes the file, and survives restarts. The mechanism is spike 2's rebase applied to file saves: fork the CRDT at the version the editor had, diff, merge.

The one thing a file cannot tell the daemon is which version the editor had loaded. The daemon infers it from the bytes, and that inference is sometimes wrong in a way no byte-level rule can fix. When it is unsure it assumes the older version, so the visible failure is a duplicated or reappearing phrase, never silently lost text. An editor extension that reports its buffer's base removes the guess. That is the main amendment to D7.

## Gate results

Full run from a clean clone of the pushed branch: `npm ci && npm run gates` in the spike directory, on the owner's laptop (macOS, Node 22.12). Numbers below are from that run.

GATE_TABLE_PLACEHOLDER

## The design as built

1. **Transport.** Hocuspocus 4 relay on 127.0.0.1 with `yDocOptions: { gc: false }`; the daemon and a headless remote client (a stand-in for the browser, editing through ProseMirror transactions and y-prosemirror's `updateYFragment` exactly as `ySyncPlugin` does) connect with `HocuspocusProvider`. Every Y.Doc keeps tombstones, because forks need them.
2. **Versions.** The daemon records every text it knows the file held: each write (with a Y snapshot at render time), each import (with the fork's snapshot, which is exactly what the editor saved), the adopted initial text and restored versions. The newest import is the *anchor*: the editor certainly had it. Candidates for a save's base are the anchor and everything after it, at most 48, the anchor never evicted and older writes thinned.
3. **Base choice.** Character edit distance between each candidate and the saved bytes. Walking from the anchor to newer candidates, move to a newer one only if the save is closer to it by at least half the distance between the two candidates. If the editor reloaded version W, the saved bytes are closer to W by about the size of the remote changes; if it did not, farther by the same amount; the half-distance rule is the midpoint with a bias toward the older base.
4. **Import.** If the chosen base is the current state, apply the diff to the live document with the daemon's client ID. Otherwise `Y.createDocFromSnapshot` at the base with a fresh client ID registered to the local user, apply the diff on the fork, and merge the fork's update into the live document. The diff: top-level blocks aligned by patience anchors (blocks unique on both sides), each gap aligned by a DP that maximizes pairs then similarity, pairing same-type blocks when word Dice or containment is at least 0.5; paired containers recurse; paired textblocks get a word diff per text run between inline leaves plus a formatting pass that touches only runs whose marks differ; attribute-only changes (a `src` or `gap` that changed with no semantic change, such as `*a*` to `_a_`) set attributes only. Then the fork is checked against the parsed save, attributes included, and repaired with `updateYFragment` on mismatch (never needed in any run).
5. **Render.** Spike 1's `serializeDoc`, with two additions: a block no candidate verifies is written as best effort and reported (`export-degraded`) instead of freezing the file, and a cheap top-level block count of the output detects serializations that do not compose (a last block's end-of-file gap when a block is appended after it, an unclosed fence that is no longer last) and repairs the boundary by giving it a blank-line gap or re-serializing the block.
6. **Writing the file.** Synchronous critical section: open and read the file; if it differs from the last text the daemon saw, do not write (a save arrived: import it first); write a temporary file beside it with the same mode; if the path's inode, size or mtime moved, abandon; rename over; if the old inode changed after the rename (an in-place writer raced the window), import what it wrote. Symlinks are followed. The residual race is the microseconds between the last stat and the rename.
7. **Watching.** `fs.watch` on the directory, filtered by name (survives rename-over saves), a 2 s poll as a safety net, a 30 ms settle debounce, a 250 ms grace when the file is momentarily empty (truncate then write), and the echo check, which is purely by content: a file whose bytes equal the last text the daemon saw is not a save.
8. **Git.** Branch, HEAD and stash ref read with git subprocesses at each settle and each export, `index.lock` checked on every raw event plus one grace period after it clears. Commit or amend with the file unchanged: harmless. Branch change or detached HEAD: detach. Fast-forward on the same branch that changed the file: import as the git author (re-base). Non-fast-forward HEAD move, stash, or `index.lock` seen with the file changed: detach. Detached and back on the branch with the file as the daemon left it: reattach. The daemon never writes while detached.
9. **Persistence.** `<repo>/.git/phraise/daemon/<doc>/`: `base.md` and `base.snapshot` (the version equal to disk), `ydoc.bin` (full state), `versions/` and `versions.json` (every base candidate, content-addressed), `state.json` (branch, HEAD, detached). Inside `.git`, so never in the working tree. On restart the daemon loads the doc, syncs, and imports whatever changed on disk against the persisted candidates. If the state is gone or the chosen snapshot cannot be forked (the relay's document was replaced), and the file differs from the document, it writes `<name>.phraise-conflict-<time>.md` with the document's text beside the file, leaves the file alone, and detaches.

## Tried, found, fixed, abandoned

The first full fuzz passed 23 of 60 trials. Every failure was traced to a root cause with a replayable seed; these are the ones that changed the design.

- **Line-level base cost** tied whenever the user's edit and a remote edit shared a paragraph (Markdown paragraphs are usually one line); ties went to the newest version, and the remote edit was diffed away. Replaced by character edit distance.
- **Persisting only the latest version** made a restart diff an older editor buffer against too new a base. Now every candidate is persisted.
- **Spike 2's greedy pairing** (first block with Dice at least 0.5) paired the wrong one of several similar paragraphs, and a plain LCS matched an edited block to an identical block elsewhere. Either turns an edited block into delete plus insert, and Yjs deletes a deleted element's whole content, including what a remote peer typed into it concurrently. Replaced by patience anchors, a weighted DP, and containment as a second similarity. Spike 2's rebase has the same exposure and should adopt this.
- **Plain minimum cost** was fooled when the user's edit resembled the inverse of a remote edit (a new paragraph within a few characters of one a peer had typed). Replaced by the half-distance rule.
- **A FIFO ring of 32** evicted the anchor after 32 remote writes; a stale save with no edits then reverted all of them (found by the reviewer: 40 remote edits, none survived). The anchor is now pinned and old writes are thinned; gate D now includes cases with 60 remote writes before the stale save.
- **Serializer refusal froze the file** for good, for example once a peer deleted the definition a reference link used. Now written as best effort and reported.
- **Non-compositional serialization** merged two paragraphs in the file after a block was appended to the end. Now detected and repaired.
- **Spike 1's parse cache was cleared on every call**, so a save of the 240 KB file cost 1.5 s. Made persistent: 8.7 times faster.
- **Templated fuzz paragraphs** ("Sentence with token X inside it.") made every inserted paragraph near-identical, a worst case for any similarity heuristic and unlike writing. The fuzz now uses varied sentences; the template remains as `FUZZ_TEMPLATED=1`.
- Considered and not built: a VS Code extension, the MCP server (stretch; it needs spike 2's comment store, which the daemon does not yet have, so it was not cheap), and resurrecting blocks deleted upstream but edited locally (spike 2 does this for rebases; here it would turn the delete-versus-edit category into flagged blocks).

## How real editors behave

From the [researcher log](../logs/2026-09-27-researcher-spike-3-editors.md), with sources there, and one headless vim experiment.

| Editor | Clean buffer, file rewritten | Dirty buffer, file rewritten | Save after a remote change | What the user sees with Phraise |
|---|---|---|---|---|
| VS Code | Reloads silently (FSEvents), cursor usually kept | Never reloads | Refused: "The content of the file is newer", Compare or Overwrite | Clean: remote edits appear live. Dirty: a conflict dialog on every save while anyone else is typing; Overwrite is a stale save, which the daemon merges without reverting |
| vim | W11 prompt, or silent reload with `autoread` (reload follows rename-over, experiment) | W12 prompt | "The file has been changed since reading it" on any mtime change (vim#5936) | Every daemon write trips the warning; `:w` then `y` is a stale save, merged. Scripted `:w!` with `autoread` off clobbers, and the daemon merges that too |
| Typora | Reports conflict: some say it reloads and steals focus, others that it checks only on save | Undifferentiated Save Anyway, Revert, Save As dialog | Same dialog | Workable, noisy; evidence is issue reports only |
| Claude Code | Edit and Write refuse if mtime moved since Read | n/a | Re-reads first | Always saves against the latest version: the easy case |
| `sed -i`, scripts | n/a | n/a | Rename-over from current content | Easy case |

**Is a VS Code extension needed?** For comments and presence, yes, as D7 says. It is also needed for a good editing experience, for two reasons files cannot fix: without it every save from a dirty buffer while a collaborator types hits VS Code's "file is newer" dialog, and the daemon has to infer the buffer's base. An extension can apply remote edits to the open buffer as `WorkspaceEdit`s, so the buffer never goes stale and VS Code never sees a foreign write, and can tell the daemon the exact version a save is based on. The daemon's file path then remains for every other tool.

## Debounce values

| Timer | Value | Why |
|---|---|---|
| File settle after the last watch event | 30 ms | Long enough to coalesce a truncate-then-write or an editor's two-step save; gate B shows 110 ms median end to end, mostly watch latency. |
| Empty-file grace | 250 ms | A truncating editor passes through an empty file; importing it would delete the document. |
| Remote edit to file, trailing | 30 ms | Keystroke bursts become one write. Gate A median 43 ms on a README. |
| Remote edit to file, maximum wait | 200 ms | Continuous remote typing still reaches the file five times a second. |
| File poll | 2 s | Safety net for missed FSEvents, which VS Code's own issue tracker shows happen. |
| Git poll | 500 ms | Detects a branch switch that does not change the file. |

Every write adds a version to the ring, so continuous remote typing writes about five versions a second; that is why the ring keeps the anchor and thins older writes rather than keeping them all.

## What the daemon persists, and losing it

State lives in `.git/phraise/daemon/<doc>/` (sizes for the 240 KB file: `ydoc.bin` 845 KB, plus one text and one snapshot per candidate). Deleting it loses the base: on the next start, if the file equals the document the daemon simply continues; otherwise it writes a conflict copy and detaches, and nothing is overwritten (gate H). Deleting `ydoc.bin` alone still works while the relay keeps tombstones, because the snapshots are forked from the synced document. A relay that garbage-collects, or a document re-seeded under D1, invalidates persisted snapshots and leads to the conflict copy.

## Is Node adequate?

Yes for this. After the cache, the 240 KB file costs about 190 ms per import and 310 ms per render, about 500 ms per save end to end, and a README costs milliseconds; the daemon is idle between events. What is not adequate yet is memory: the gate J process peaked at 650 to 730 MB (daemon, relay and client in one process, all with tombstones, plus forks). That is a data-structure question (tombstones, full-document forks, cached parses) that a compiled daemon would not remove by itself. A single-binary distribution is available via Node's single executable applications or Bun if install friction matters. No reason found for a compiled daemon now.

## What spikes 1 and 2 need to change

- **Spike 1, serializer:** degrade instead of refusing (write the best effort and flag the block); verify composition across block boundaries, not only each block in isolation; stop emitting numeric character references (`&#x20;`, `&#x6D;`) when emphasis starts or ends inside a word, which concurrent formatting merges produce (seen in 1 to 2 percent of fuzz trials). Keep the parse cache across calls.
- **Spike 1, parser:** the isolation re-parse can merge an unrelated indented block into a footnote definition's continuation; this is gate F's only failure (2 of 3,350).
- **Spike 2, diff:** adopt patience anchors, the weighted gap alignment and containment pairing; support inline leaves in textblocks; set only the formatting that differs.
- **Binding (y-prosemirror):** its prefix-and-suffix text diff places an insertion inside a neighbouring word that shares its first characters, so a concurrent deletion of that word takes those characters with it. Not a daemon issue; worth knowing for Yjs 14.

## Decisions

Made by the spike 3 orchestrator, for the lead to transfer to the register.

| # | Decision | Impact | Difficulty to reverse |
|---|---|---|---|
| S3-1 | A file save is imported by fork-at-base: fork the CRDT at the snapshot of the version the editor is believed to have loaded, two-way diff to the saved bytes, merge. The fast path applies to the live doc when nothing changed since. | high | moderate |
| S3-2 | The daemon infers a save's base from recent versions by character edit distance with a half-distance margin; ambiguity resolves toward the older base (visible duplication rather than silent loss). | high | easy |
| S3-3 | The version ring pins the anchor (last import), keeps the newest 16, thins older writes, holds at most 48, and is persisted with snapshots. | medium | easy |
| S3-4 | The echo check is content-based (bytes equal the last text the daemon saw), never time-based. | medium | easy |
| S3-5 | Writes are temporary file plus rename with pre- and post-rename checks; the in-place race window is accepted and documented. | medium | easy |
| S3-6 | Daemon state lives under `.git/phraise/daemon/<doc>/`; when the base is lost and the file differs, write a conflict copy, leave the file, detach. | medium | easy |
| S3-7 | Git handling: commit harmless; branch change, non-fast-forward move, stash or `index.lock` with a file change detach; a same-branch fast-forward is imported as the git author; reattach when the branch and file return. | high | moderate |
| S3-8 | The relay keeps tombstones (`gc: false`) for documents a daemon edits, because forks need them. D1's re-seed bounds growth. | high | moderate |
| S3-9 | A block the serializer cannot verify is written as best effort and reported, and block boundaries are checked and repaired, instead of refusing to write. | medium | easy |
| S3-10 | Block alignment for imports uses patience anchors plus a weighted DP with Dice-or-containment pairing (replacing spike 2's greedy pairing). | medium | easy |
| S3-11 | Timings: 30 ms file settle, 250 ms empty grace, 30 ms trailing and 200 ms maximum remote debounce, 2 s file poll, 500 ms git poll. | low | easy |
| S3-12 | Each forked import mints a fresh Yjs client ID registered to the local user in a `phraise-authors` map; the relay's auth hook should attribute all IDs arriving on a daemon connection to that user. | medium | easy |

## Open risks

1. **Base inference** (high). Without editor integration it is a heuristic. In the hostile fuzz (an editor that never reloads unless told, many stale saves) about 1 in 40 imports chose a base other than the editor's true one; the result is a duplicated phrase or a deletion of fresh collaborator text that does not take. The extension removes it for VS Code; other editors keep it.
2. **Delete versus edit** (medium). A block deleted or restructured on one side (a list item joined, a paragraph turned into a table) while the other side edits it loses the edit, as in spike 2 (S2-10). The fuzz reports it separately (DVE_PLACEHOLDER tokens in 300 trials); spike 2's resurrection could be applied here.
3. **Stale-save UX** (medium). Editors show conflict dialogs on every save while a collaborator types; see the editor table.
4. **Memory** (medium). Hundreds of MB for a 240 KB document with tombstones and forks.
5. **Watcher reliability and platforms** (medium). Tested on macOS only. FSEvents can miss events (the 2 s poll covers it). Windows rename-over semantics and file locking are untested.
6. **Git edge cases** (low). A shell restore such as `git show HEAD:f > f` touches no git state and is imported as the user's edit; the in-place-writer race path imports without the git check.
7. **Serializer output quality** (low). Entity escapes after concurrent formatting; degraded blocks lose markup in that block.

## Recommendation for D7

**Confirm, with amendments.**

1. The daemon imports saves by fork-at-base with an inferred base, as built here, and never overwrites a file it has not seen.
2. The VS Code extension is not optional polish: it should apply remote edits to open buffers and report each save's base version, so that VS Code users never hit stale-save dialogs and the daemon never guesses. Amend D7's sentence that the extension adds only presence and comments.
3. The relay keeps tombstones for documents with a daemon attached (S3-8), and the daemon's persisted snapshots are invalidated by a D1 re-seed, which must be a signalled event rather than a silent replacement.
4. Spike 1's serializer must degrade rather than refuse, and check composition (S3-9).
