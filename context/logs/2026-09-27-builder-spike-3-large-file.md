# Builder log: spike 3 brief 04 (large file, verification cache)

Status: done
Author: builder (Sonnet 5)
Updated: 2026-09-27
Plan: [brief 04](../plans/2026-09-27-spike-3-brief-04-large-file.md)

Time zone: local machine time (CEST, UTC+2), from `date`.

## 11:28 — task received

Read AGENTS.md, the brief, charter gate J / "Rules for every agent in this
spike", and plan sections 3.5 and 6 (row J). Working directory
`spikes/2026-09-27-daemon-file-sync-fork-import/`.

Notable finding before writing any code: this spike's `src/md/` was copied
wholesale from spike 1 at scaffold time (commit `1e9e7db`), and spike 1 had
already run its own "brief 04"-shaped large-file/verification-cache task —
`src/md/parse.ts` already has `parseBlockCache` and `ctxSkipCache` (module
Maps, cleared at the start/end of each `serializeDoc`/`parseMarkdown` call so
they never grow across calls), and `serialize.ts`/`parse.ts` already carry
`noTextblockSplice`/`semanticLineBreaks` options whose comments reference "brief
04". So the block-level re-parse memoization this brief's task 3 describes is
already present in the code inherited from spike 1. What is NOT yet present:
any perf work in this spike's OWN code (`src/core/diff.ts`, `src/core/docsync.ts`)
-- those are spike-3-original, not copied, and the brief specifically flags
`src/core/diff.ts`'s `yParent.toArray()[cursor]` in a loop (quadratic in block
count) and `renderDetailed`'s extra whole-output `parseMdast` as fair-game hot
spots. Plan: measure "before" first (current state, including the inherited
md/ caches), then fix those two spots in src/core/ (not src/md/), then
re-measure "after". Will only touch src/md/ if profiling shows the inherited
caches are insufficient.

## Task 1: gates/j.ts

Wrote `gates/j.ts`: `runGateJ({ quick })` plus a standalone entry
(`npx tsx gates/j.ts [--quick] [--label before|after]`). Measures, each as
median of 5 runs after 1 warm-up unless noted:

- `parseMarkdown`/`serializeDoc` of the whole 240 KB corpus file
  (`corpus/fetched/real/nodejs-node-docapinapimd.md`).
- `docToYDoc`/`yDocToDoc`.
- `DocSync.importText` of a one-word edit in the middle of the file: fresh
  save (fast path) and the same edit as a stale save (a remote peer edits
  paragraph 0 first, forcing the forked/merge path).
- `importPlusExportMs`: the same fresh-save import immediately followed by
  `renderDetailed()` on the same `DocSync` -- this combined number is the
  brief's 500ms pass criterion ("a fresh-save import plus the resulting
  export").
- `renderDetailed()` after one remote word edit.
  `Y.encodeStateAsUpdate` time and the resulting `ydoc.bin` size (via a
  DocSync after one remote edit, standing in for `persistState`, which is a
  private `Daemon` method).
- `chooseBase` with 8 candidates differing by one edit each (built as plain
  `Version` objects -- `chooseBase`/`diffCost` are pure string operations, no
  re-parse, so the candidate texts don't need to stay valid Markdown).
- End to end through a real daemon+relay on the 240 KB file: 10
  remote-edit-to-file round trips (gate A shape) and 10
  file-save-to-remote round trips (gate B shape, `in-place` save), median
  each, plus peak RSS after.

Picking edit locations in real, arbitrary 240 KB prose needed care: hardcoding
a paragraph index/text (as gates A/B do for their small fixed fixtures) isn't
possible, so `gates/j.ts` walks the file's own mdast tree to find a paragraph
near a target offset (optionally restricted to plain prose, no code/link/
emphasis markup) and edits its first word. One bug found and fixed during
this: the file's paragraph 0 (used for the remote-edit-to-file loop, cycling
through word indices `i % 5`) turned out to have only 4 words, so `i=4`
threw; added `pickParagraphIndex(text, minWords)` to find a paragraph long
enough instead of assuming index 0.

`npx tsc --noEmit` passes.

## Finding before writing any fix: src/md/ was already "optimized" by spike 1, but the wrong way

Read `src/core/docsync.ts`, `src/core/diff.ts`, `src/core/versions.ts`,
`src/md/serialize.ts`, `src/md/parse.ts`, `src/daemon/daemon.ts` per the
brief. `parse.ts` already had a `parseBlockCache`/`ctxSkipCache` (module Maps)
from spike 1's own equivalent large-file work, keyed by the exact `ctx`+`src`
content -- but both are **cleared** at the start of every `serializeDoc` call
and the end of every `parseMarkdown` call. A quick experiment
(`scratch-experiment.mjs`, deleted after) confirmed: calling `parseMarkdown`
on the SAME 240 KB text 4 times in a row costs ~1300ms every single time --
the cache never survives from one call to the next, so it only ever saves
work *within* one call (repeated re-parsing of the shared definitions
context), not *across* the repeated calls a real daemon makes (every save
calls `parseMarkdown` on the whole file again; every export calls
`serializeDoc` on the whole doc again). Since a save touches one block out of
1619 and leaves the rest byte-identical, this is exactly the "make the
per-save and per-remote-edit paths cheap" case brief 04 asks about.

## Task 2: "before" numbers

`npx tsx gates/j.ts --label=before` (before touching any code), written to
`results/j-before.json`:

| Measurement | ms (or bytes) |
|---|---|
| parseMarkdown (whole file) | 1308.4 |
| serializeDoc (untouched doc) | 1264.3 |
| docToYDoc | 9.0 |
| yDocToDoc | 3.0 |
| importText, fresh save | 1496.0 |
| importText, stale/forked save | 1465.4 |
| importText + renderDetailed (combined) | 3203.3 |
| renderDetailed (after 1 remote edit) | 1738.2 |
| Y.encodeStateAsUpdate | 5.0 |
| ydoc.bin size | 845087 bytes |
| chooseBase, 8 candidates | 41.4 |
| gate-A-shape latency (remote edit -> file), median of 10 | 1750 |
| gate-B-shape latency (file save -> remote), median of 10 | 1922 |
| peak RSS after end-to-end | 646.7 MB |

## Task 3: cache persistence + two src/core/ hot spots

**`src/md/parse.ts`/`src/md/serialize.ts`**: removed the two
`clearParseBlockCache()` calls (serializeDoc's start, parseMarkdown's end)
and replaced the plain `Map`s with a small `LruMap` (bounded 8000 entries for
`parseBlockCache`, 500 for `ctxSkipCache`) so the cache persists across calls
instead of being thrown away every time. Keys are the literal `ctx`+`src`
string content (never a hash), so there is no collision-correctness risk from
persisting; the LRU bound is the only thing keeping memory in check across a
long daemon session touching many documents. `clearParseBlockCache()` stays
exported (now also re-exported from `src/md/index.ts`) for tests that
explicitly want a cold-vs-warm comparison. Logged in the spike README's new
"Changes to copied code" section per the brief.

**`src/core/diff.ts`** (`applyChildOps`): was calling
`yParent.toArray()[cursor]` once per skip/update op -- `toArray()` walks the
whole underlying Yjs linked list (live items and tombstones) every time,
making this loop O(ops * document length), quadratic in top-level block
count on a large document. Fixed: snapshot `toArray()` once before the loop
and keep the snapshot array in sync with each insert/delete via `splice`
(cursor-advance semantics unchanged: advances on skip/update/insert, not on
delete).

**`src/core/docsync.ts`** (`renderDetailed`): was calling `parseMdast(out)`
twice per call in the common (no boundary-repair) case -- once for the
while-loop condition, again for the final `composed` check on the same
`out`. Fixed: compute the top-level block count once per `out` and reuse it
for both, so the redundant full-document re-parse only happens when a repair
iteration actually produces a NEW `out`.

Added `test/md-roundtrip.test.ts`'s new test: for every handwritten corpus
file and the 240 KB file, `clearParseBlockCache()` then serialize (cold),
serialize again without clearing (warm), assert byte-identical; clear again
and reconfirm. Passes (`npx vitest run test/md-roundtrip.test.ts`, 2 tests,
~6s, dominated by the 240 KB file).

## Task 4: "after" numbers, wired into gates/index.ts

`npx tsx gates/j.ts --label=after`, written to `results/j-after.json` (one
representative run kept on disk; re-ran several times to check stability,
numbers below are from a representative run):

| Measurement | before -> after |
|---|---|
| parseMarkdown | 1308.4ms -> ~145-155ms (~8.7x) |
| serializeDoc | 1264.3ms -> ~137-142ms (~9.2x) |
| docToYDoc / yDocToDoc | 9.0/3.0ms -> ~8-9/~3ms (unchanged, not a hot spot) |
| importText, fresh save | 1496.0ms -> ~189-201ms (~7.7x) |
| importText, stale/forked | 1465.4ms -> ~207-229ms (~6.7x) |
| importText + renderDetailed (pass criterion) | 3203.3ms -> ~473-526ms (~6.4x) |
| renderDetailed | 1738.2ms -> ~274-428ms (~5-6x) |
| Y.encodeStateAsUpdate / ydoc.bin size | ~5ms / 845087B -> ~5ms / 823957-845087B (unchanged) |
| chooseBase, 8 candidates | 41.4ms -> ~40ms (unchanged, not a hot spot) |
| gate-A-shape latency | 1750ms -> ~335-451ms (~4-5x) |
| gate-B-shape latency | 1922ms -> ~581-708ms (~3x) |
| peak RSS | 646.7MB -> ~591-670MB |

**500ms target (fresh-save import + resulting export, median): right at the
boundary.** Five repeated runs of the full `gates/j.ts --label=after`
measurement gave `importPlusExportMs` of 472.8, 525.7, 510.1, 490.6, 489.5ms
-- three PASS, two FAIL against the literal 500ms line, i.e. essentially
AT the target (noise from GC/JIT/machine load spans the boundary either
way). Did not chase this further: the remaining cost is dominated by one
unavoidable full-document `parseMdast` call inside `renderDetailed`'s
boundary-composability check (needed to detect the two known failure modes:
an unclosed fence swallowing what follows, or two paragraphs merging at a
dropped gap) plus one unavoidable full-document `parseMarkdown` inside
`importText` -- both require tokenizing the whole 240 KB text at least once
per operation, and remark/micromark has no "block structure only, skip
inline tokenizing" mode to fall back to without a much riskier hand-rolled
re-implementation of part of the CommonMark tokenizer, which risks silently
weakening the very safety check `boundaryRepairs`/`composed` exists for.
Brief 04's own stopping point ("if the cache cannot reach the 500ms target
cheaply, stop after recording what you measured") applies here: recording it
as essentially-at-target with ~6x overall improvement, not exactly under it
every single run.

Wired `runGateJ` into `gates/index.ts` in place of the placeholder row (`J`
now runs live, alongside A-I). `runGateJ` always measures the CURRENT code
live (there is no toggle to reproduce the old "before" behaviour once the
persistence fix is in place) and, when `results/j-before.json` exists,
includes those numbers alongside the fresh "after" measurement in
`numbers` (keys prefixed `before.`/`after.`) so the printed gate table shows
both side by side, per the brief. `pass` is based on the live
`importPlusExportMs` against the 500ms target.

## Task 5: verification that the cache/perf changes didn't break behaviour

- `npx vitest run`: **33/33 tests pass** (13 test files), including the new
  cache-parity test (`test/md-roundtrip.test.ts`, ~6s, dominated by the 240
  KB file) and every existing daemon gate test (A, B, C, D, E, F, G, H
  variants).
- `npx tsx gates/f-roundtrip.ts --quick`: **714/714 (100%)** round-trip
  rounds + half-typed-insertion states pass; 0 failures; 7 coarse-textblock
  fallbacks (pre-existing, unrelated to this brief); 0 repairs.
- `npx tsx gates/fuzz.ts --trials 20`: **20/20 trials pass**. One
  `deleteVsEdit` occurrence -- the brief's own accepted category ("no lost
  text except the accepted delete-versus-edit category"), not a failure. All
  other categories (exception, divergence, fileNotRender, lost, resurrected,
  echo, detach, wholeDocMismatch, ambiguousDelete, degradedFinal, duplicated)
  are 0.
- `npx tsc --noEmit`: passes.
- `npm run gates:quick` (full harness, all gates A-J): **all PASS**, gate J
  included as row J (not the old placeholder), reporting `before.*`/`after.*`
  numbers side by side; that run's `after.importPlusExportMs` was 497.93ms
  (under the 500ms target -- consistent with the "essentially at target"
  characterization above, since repeated standalone runs bounce either side
  of the line by a small margin).

No regressions from the `src/md/` cache-persistence change, the
`src/core/diff.ts` quadratic-loop fix, or the `src/core/docsync.ts`
redundant-parse fix.

## 11:49 — done

Definition of done met: `npx tsx gates/j.ts` prints a before/after table and
writes `results/j-before.json`/`results/j-after.json`; `npm run gates:quick`
includes row J (live-measured, `before.*`/`after.*` numbers reported
together); `npx vitest run` and `npx tsc --noEmit` pass. Stopping here per
the brief's task list (tasks 1-5 done) and its own escape valve for the
500ms target (see Task 4: right at the boundary, ~6x faster, not chased
further since the remaining cost is one unavoidable full-document parse per
operation and reducing it further would mean hand-rolling part of a
CommonMark tokenizer -- not "cheap").

Files touched: `gates/j.ts` (new), `gates/index.ts` (wired in, placeholder
row removed), `src/core/diff.ts`, `src/core/docsync.ts`, `src/md/parse.ts`,
`src/md/serialize.ts`, `src/md/index.ts`, `test/md-roundtrip.test.ts`,
`README.md` (new, "Changes to copied code" section), `results/j-before.json`
(new), `results/j-after.json` (new), `results/gates.json`/`results/gates.md`
(regenerated by `npm run gates:quick`), `results/f-roundtrip.json`
(regenerated by the standalone gate F run), `results/fuzz.json` (new,
written by the standalone fuzz run).

No servers or processes left running (every gate/test tears its own
daemon/relay/fixture down; `deleted scratch-experiment.mjs` after use, never
committed).
