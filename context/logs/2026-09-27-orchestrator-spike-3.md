# Log: spike 3 orchestrator, daemon file sync

Status: active
Author: spike 3 orchestrator (Opus 5.5)
Updated: 2026-09-27
Charter: [spike 3 charter](../plans/2026-09-27-spike-3-charter-daemon-file-sync.md)
Time zone: CEST (UTC+2), from `date` on the owner's laptop.

## 07:49 — task received
Worktree: /Users/skk/code/phraise/.claude/worktrees/agent-ad2057bb46c104eec, branch spike/2026-09-27-daemon-file-sync at b20b401.
Read AGENTS.md, architecture decisions, agent workflow, the charter, spike 1 and spike 2 findings (via git show on their origin branches, both still exist).

## 08:00 — plan and scaffold
Design: fork-at-base import (spike 2's rebase applied to file saves), version ring with min-diff base choice restricted to anchor-and-later, content-based echo check, guarded rename writes. Written to [plan](../plans/2026-09-27-spike-3-plan.md). Scaffold in spikes/2026-09-27-daemon-file-sync-fork-import/ with spike 1 src copied to src/md/ (1e1f4a6); sanity round-trip test passes; corpus fetched (266 real). 47 half-typed fixtures written by me. Commit 1e9e7db.

## 08:00 — dispatch 1: builder, brief 01 core (Sonnet)


## 08:42 — dispatch 1 returned
Builder delivered core (diff, versions, DocSync, RemoteEditor, gate F script). Verified myself: 10 tests pass, tsc clean. Gate F full: 3348/3350 (99.94%): 1470/1470 byte-fuzz rounds, 1878/1880 half-typed insertions; the 2 failures are a spike 1 parseBlock context issue (footnote definition continuation), 26 coarse textblocks, 0 repairs. Builder found and fixed a matched-pair attr-sync bug (Y merges text runs, PM does not). Review fix by me: import wrote authors and lead/eol map entries on every import, which would put operations outside the edited block; now only on change.


## 08:43 — dispatch 2: builder, brief 02 daemon (Sonnet)
Pushed branch before dispatch.

## 09:53 — dispatch 2 returned
Builder delivered relay, daemon, git watch, CLI, 31 integration tests (A to H). I re-ran the suite: 12 files, 31 tests pass; nothing listening on 4100-4199 afterwards. Builder found two real bugs (export stale-read path bypassed the git check; index.lock invisible to fs.watch for fast git commands, now checked on every raw signal plus a grace period). Builder pushed despite the brief; harmless.
Review by me: after a restart with no changes the version ring was empty (persisted base not pushed into the ring), so the next save would throw in chooseBase. Added DocSync.restore(), used it on restart, regression test test/daemon.h-restart-then-save.test.ts. Commit 709150c. Noted for findings: the in-place-writer-raced-rename branch imports captured bytes without the git check (narrow window).

## 09:53 — dispatch 3: builder, brief 03 gates and fuzz (Sonnet)


## 11:17 — dispatch 3 returned, then fuzz-driven fixes by me
Builder delivered the gate runner and the fuzz (gates:quick A to H pass; fuzz 23/60). It reported a base-choice design problem. I diagnosed each failing seed with traces and fixed, in order:
1. Base cost was line level: user and remote edits in one paragraph tied, tie went to the newest version and reverted the remote edit. Now character edit distance with a bound.
2. Restart persisted only the latest version; stale buffers were diffed against too new a base. Now all candidates persisted, content-addressed, chosen with chooseBase on restart.
3. Block pairing was greedy on Dice; similar paragraphs mispaired, edited blocks became delete plus insert and lost concurrent remote text. Now patience anchors (unique blocks) plus a weighted DP, pairing on Dice or containment.
4. Base choice fooled when user edits resemble the inverse of remote edits. Now a margin rule: move to a newer candidate only on evidence of half the distance; ambiguity resolves toward the older base (duplication, not loss).
5. Serializer refusal froze the file (dangling reference after a remote deleted a definition; bare URL next to an insertion). Now written as best effort, reported as export-degraded.
6. Non-compositional serialization (end-of-file gap on a block that is no longer last merged two paragraphs). Now a cheap mdast block-count check and a repair loop.
Harness fixes: semantic token check (entity escapes), token cores robust to y-prosemirror prefix/suffix diffing (a remote insertion lands inside a neighbouring word that shares characters), delete-vs-edit located in the Y doc, templated sentences replaced by varied ones (templated text is adversarial to any similarity heuristic), quiesce waits until the daemon has seen the file, autoreload editor variant.
60 trials: 23 -> 45 -> 54 -> 58 -> 55 (after the sentence change reseeded) with remaining failures traced to base-choice ambiguity. Commits c3a3824, 85d8612.


## 11:20 — fuzz state before dispatch 4
60 trials at seed 439041100: 59/60; the one failure is a duplicated token from an exact base-choice tie (true base and a newer write at equal cost; conservative rule picked the older). Categories otherwise: 0 exception, 0 divergence, 0 lost, 0 echo, delete-vs-edit 6 (accepted), ambiguous-delete 4 (by design), degraded 1 final (10 degraded exports). Commit 00488cc, pushed.

## 11:20 — dispatch 4: builder, brief 04 large file (Sonnet)


## 11:51 — dispatch 4 returned
Builder found spike 1's parseBlock cache was cleared on every call; made it persistent (LRU), fixed a quadratic toArray in applyChildOps and a redundant parse in renderDetailed. 240 KB file: parse 1308 -> ~147 ms, serialize 1264 -> ~142 ms, fresh-save import plus export 3203 -> ~500 ms, gate A-shape latency 1750 -> ~340 ms. Cache-parity test added. I changed gate J to report the 500 ms target rather than gate on it (the charter sets no threshold; it sits at the noise floor). Commit 36462c4 plus mine, pushed.
Started the first full gate run in the background (npm run gates).

## 11:51 — dispatch 5: researcher, brief 05 editors (Sonnet)


## 12:00 — dispatch 5 returned; first full gate run
Researcher log committed. Key: VS Code reloads clean buffers silently and refuses to save a dirty buffer over a newer file without a Compare/Overwrite choice; vim warns on any mtime change (our rename always trips W11 unless autoread); Claude Code's Edit/Write refuse when mtime moved since read; Typora evidence thin.
Full run 1 (npm run gates): A B C D E G H J pass; F 3348/3350 (the 2 spike 1 footnote cases); I 287/300 with 21 'duplicated' and 1 'lost'. Diagnosis: 'duplicated' counted deleted copies in the Y doc, which a save that restructures a block (table to paragraph and back) leaves behind: a classification bug, reverted to visible copies. The 'lost' seed: the serializer had escaped the token's last character (&#x38;) inside bold with entity-encoded spaces; the editor deleted the visible prefix, the harness did not record it. Fixed in harness; added a metric for entity escapes, an output-quality finding for spike 1's serializer.

## 12:00 — dispatch 6: reviewer, brief 06 (Sonnet, fresh context)


## 12:18 — dispatch 6 returned; review fixes
Reviewer (log committed) found: HIGH ring FIFO evicted the anchor after 32 writes, a stale save then reverted all remote edits (reproduced: 40 edits, 0 survived); HIGH ambiguous-delete classifier matched any import in the trial; MEDIUM content-only restore via shell (git show HEAD:f > f) is imported as a local edit; known: raced-rename recovery path skips the git check.
Fixed the two HIGHs (anchor pinned, thinning eviction, ring 48; classifier uses the carrying import), added core.ring tests and 60-extra-edit cases to gate D. While doing so found gates compared the file with render() while the daemon writes renderDetailed() (boundary repairs): render() now returns what the daemon writes. The MEDIUM and the raced-rename path are documented as limits, not fixed: from the file system a shell redirect is indistinguishable from typing.
40-trial fuzz after fixes: 40/40.

