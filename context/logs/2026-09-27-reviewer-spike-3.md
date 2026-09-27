# Log: spike 3 reviewer, fresh context

Status: done
Author: reviewer (Sonnet, fresh context)
Updated: 2026-09-27
Brief: [brief 06](../plans/2026-09-27-spike-3-brief-06-review.md)
Charter: [spike 3 charter](../plans/2026-09-27-spike-3-charter-daemon-file-sync.md)
Time zone: CEST (UTC+2), from `date` on the machine.

## 12:01 — task received

Read AGENTS.md, architecture decisions D1/D6/D7, the spike 3 charter (including
its "Rules for every agent in this spike"), the plan reference, and the
orchestrator log `context/logs/2026-09-27-orchestrator-spike-3.md` for what
was already found/fixed (attr-sync bug, export stale-read bypassing the git
check, index.lock-vs-fs.watch race, restart-empty-ring throw, base-cost
line-vs-char tie, greedy-Dice mispairing, base-choice margin rule, serializer
refusal freeze, non-compositional serialization, harness fixes). Then read
`src/core/{docsync,diff,versions}.ts`, `src/daemon/{daemon,git}.ts`,
`gates/fuzz.ts`, `gates/lib/locate-token.ts`, `gates/d.ts`, and the brief-04
cache change in `src/md/parse.ts` plus the README's "Changes to copied code".

Ran the required baselines once each: `npx vitest run` -> 13 files / 33 tests
pass. `npm run gates:quick` -> A-J all PASS (gate I quick: 30 trials, 30
passed, but `baseMisjudged=1`, `ambiguousDelete=2` -- see finding 2, this is
the quick run showing the exact symptom in the wild without any extra
trials). No server started; nothing to bind to 4100-4199 for this review.

## 12:10 — findings

### HIGH -- version-ring eviction lets a stale save revert remote edits that were never lost from the CRDT, just from the ring (`src/core/versions.ts:64-99`, `src/core/docsync.ts:258-267`)

`VersionRing` is a fixed 32-slot FIFO (`RING_SIZE = 32`, `versions.ts:17,71`).
`anchor()` (`versions.ts:84-90`) finds the newest `import`/`adopt`/`restore`
entry *currently in the ring*; `candidates()` is the anchor and everything
after it, or (`versions.ts:93-98`) **all remaining entries if no anchor
survives**. Every remote-triggered file write pushes a `write`-origin version
(`daemon.ts` `recordWriteIfNew` -> `docSync.recordWrite`, `docsync.ts:150-154`).
Nothing protects the anchor's own ring slot from eviction: once 32 `write`
entries have been pushed since the last `import`/`adopt`/`restore` -- i.e.
32 remote-driven exports land while one editor keeps a buffer open and never
saves -- the anchor's array slot is shifted out (`versions.ts: push`,
`ring.shift()`), `candidates()` falls back to "all remaining ring entries"
(all `write`-origin, all already containing many of the accumulated remote
edits), and `chooseBase` (`versions.ts:127-148`) can only pick among those:
the editor's true base (byte-identical to its stale buffer, cost 0) is gone
from the ring entirely. The margin rule then picks the *oldest surviving*
`write` candidate (not cost-0), and the fork-and-diff in `importText`
(`docsync.ts:277-341`) computes and applies a real CRDT delta that **deletes**
every remote edit made between that candidate and the live doc -- even though
the editor made zero local changes and the save should have been a pure
no-op.

Reproduced standalone (`DocSync`/`VersionRing` only, no daemon/relay needed):
adopt a 3-paragraph doc, apply 40 distinct "remote" edits directly to the live
Y.Doc (one `updateYFragment` transaction per edit, mimicking what arrives over
Hocuspocus) with a `recordWrite` after each (mimicking the daemon's export
step), then `importText` the *original, unmodified* text (the stale editor
buCopy that never reloaded). Result: `chosen base origin: write`, `cost: 99`,
`forked: true`, and the final rendered file contains **0 of the 40** distinct
remote markers -- all reverted, plus visible corruption from the diff/pairing
algorithm operating on a base further from the real content than expected
(escaped, concatenated leftover paragraph fragments). Script was thrown away
after running (not committed); rerun by pasting
`spikes/2026-09-27-daemon-file-sync-fork-import/src/{core/docsync,md/yjs,md/index}.js`
imports into a `.mts` file inside that package (needed for `y-prosemirror`
resolution) with the loop described above.

Why gate D and gate I would not catch this: gate D's own scripted cases
(`gates/d.ts:17-45`) hard-code exactly **two** pending remote edits between
`v0` and the stale save -- nowhere near 32. Gate I's fuzz trials run only
15-30 steps total (`fuzz.ts:287`), with remote edits firing on ~30% of steps
and coalescing under debounce, so a single trial cannot plausibly accumulate
32 `write`-origin ring entries without an intervening local save. This is
exactly the class of bug the charter's gate D promises is impossible
("the remote edits are not reverted") and the current test suite structurally
cannot exercise the boundary where it fails.

### HIGH -- Gate I's "ambiguous-delete (by design)" classification can mask a real resurrection bug (`gates/fuzz.ts:429-433`)

```
const ambiguousByDesign =
  rec.deletedBy === 'local' &&
  rec.insertedBy === 'remote' &&
  importedPairs.some((p) => !p.baseText.includes(rec.token) && !p.savedText.includes(rec.token));
```

`importedPairs` accumulates the (base, saved) text of *every* `import` event
for the *whole trial*, not just the one that processed this token's deletion.
Since a token's insertion happens partway through the trial, almost any
earlier import (very commonly the very first one, forked straight from the
initial `adopt` snapshot before either side has typed anything) trivially
satisfies "base and saved text both lack this token" -- it predates the
token's existence. That makes `ambiguousByDesign` true by construction for
most local-deletes-of-remote-content, regardless of whether the *actual*
relevant import was a legitimate stale-base case or an outright bug.

Demonstrated by replaying seed `439041100` (one of the seeds behind gate I's
reported "ambiguousDelete: 2" in this session's own quick run, and part of
the earlier "ambiguousDelete 4 (by design)" the orchestrator log reports for
the 59/60 run) with `FUZZ_DEBUG=1`: across the whole 15-step trial, only
**two** `import` events fire at all (both restart-triggered -- frequent
restarts starve the debounce/settle pipeline of a chance to import ordinary
editor saves before the next restart tears the daemon down), and the harness's
own `baseMisjudged` instrumentation logs the second one as
`base 47f54590 (import, cost 194) expected cde4f5f0 MISJUDGED`. The two
tokens reported as "ambiguous-delete (by design), deleted by local at step 12"
were deleted as part of the very save that got folded into that *misjudged*
import -- i.e. this looks like the same base-choice-under-restart family as
finding 1 (a non-graceful restart discards in-flight saves, so `chooseBase` on
resume has to compare against a stale persisted candidate set), not a
legitimate "editor never saw this token" ambiguity. The classifier calls it
"by design" only because the *first*, unrelated, restart-time import (forked
from the plain `adopt` snapshot before either token was typed) also trivially
matches the loose predicate.

Consequence: gate I's category counts ("ambiguousDelete: N, by design, not a
failure") cannot be trusted at face value; some fraction of them are likely
disguised resurrection bugs from the same base-misjudgment root cause as
finding 1, and the harness has no way to tell the two apart. This is exactly
the "classifications in gates/fuzz.ts that could hide real losses" the brief
asked to look for.

### MEDIUM -- git detection only reacts to ref/index changes, not to a content-only git restoration (`src/daemon/git.ts`, `src/daemon/daemon.ts:584-644`)

`reconcileGit` only ever detaches/rebases off of `branch`/`head`/`stash`
changes (`readGitState`, `git.ts:36-48`) or `index.lock` having been observed
(`daemon.ts:606-611`). A command that changes the file's *content* to match
some other revision without touching the index or any ref -- e.g.
`git show HEAD:path/to/file.md > path/to/file.md`, or `git cat-file`/`git
archive` piped to the same path -- produces `fileChanged=true`,
`gitChanged=false`, `lockSeenThisCycle=false`, and the daemon falls through
to `{ kind: 'attached' }` and then `processExternalSave`, importing the
restoration as an ordinary **local** edit rather than recognizing it as a
git-driven change. This does not necessarily lose text (the diff is still
applied via the normal fork-at-base path, so nothing is silently dropped
purely because of this), but it violates the letter of gate G ("a ... reset
... that changes the file must not be imported as the user's edits") and
misattributes authorship. `test/daemon.g-git.test.ts` covers checkout
(branch), `reset --hard`, `stash`, and `index.lock`-during-settle, but has no
case for a content-only restoration that bypasses git's own index/ref
machinery entirely. Not reproduced live (would need a throwaway repo under
`$TMPDIR` plus a running daemon); confidence is from reading `reconcileGit`'s
three branch conditions directly -- none of them fire for this case.

### Already known, not re-reported as new (confirmed by reading, per the brief's explicit ask in priority 2)

`runExport`'s in-place-writer-raced-rename recovery path (`daemon.ts:739-754`)
calls `processExternalSave(raceText)` directly, which imports via
`docSync.importText` with **no** `reconcileGit` call in between -- so if the
racing in-place writer was itself a git command (landing in the microsecond
window between the pre-rename `statSync` and the `renameSync`), its bytes get
attributed to the local user and the git detach/rebase logic never sees it.
The orchestrator log already flags this exact gap ("the in-place-writer-
raced-rename branch imports captured bytes without the git check (narrow
window)"). I confirmed by re-reading the code that this remains unfixed and
the window is real, but did not attempt a new reproducer since the brief
asks not to re-report already-found items -- flagging only because priority 2
explicitly asks "is the git check bypassed anywhere," and this is the answer.

### Reviewed, no issue found

- Brief 04's persistent parse-block cache (`src/md/parse.ts:572-728`): keyed
  on exact `ctx`+`src` bytes (plus a map-mode flag), with a sound "no `[` in
  `src`" short-circuit that empties the key's `ctx` component only when `ctx`
  provably cannot affect the parse (no reference syntax possible). Verified
  the project's own cache-parity test (cold vs warm, byte for byte) passes.
  Did not find a scenario where the same key could legitimately need two
  different results.
- Gate G's covered rows (commit-harmless, checkout, reset --hard, stash,
  index.lock, reattach) all pass and match `reconcileGit`'s logic as read.

## 12:12 — handback prepared

No process left running (checked `lsof` on 4100-4199 and `ps` for
tsx/node/daemon/relay/hocuspocus: none). No code changed. Nothing committed.
Two throwaway scripts were used, both removed immediately after running
(`git status` confirmed clean); one had to be placed temporarily inside the
spike's own package directory rather than under `$TMPDIR` because Node's ESM
resolution for the spike's bare-specifier dependencies (`yjs`, `y-prosemirror`)
is based on the importing file's own location, not `$TMPDIR`/cwd/`NODE_PATH`
(the latter was refused by this environment's own safety gate); it was
deleted in the same tool-call sequence that ran it, and `git status --porcelain`
was checked clean immediately after both times.
