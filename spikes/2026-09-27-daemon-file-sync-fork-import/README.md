# Spike 3: daemon file sync by fork-at-base import

See [the plan](context/plans/2026-09-27-spike-3-plan.md) and the
[charter](context/plans/2026-09-27-spike-3-charter-daemon-file-sync.md) for
the design and gates. `src/md/` (the Markdown <-> ProseMirror document model:
`parse.ts`, `serialize.ts`, `schema.ts`, `style.ts`, `compare.ts`, `yjs.ts`)
was copied wholesale from spike 1 (`origin/spike/2026-09-27-markdown-round-trip`
at `1e1f4a6`) at scaffold time (commit `1e9e7db`); `src/core/` and
`src/daemon/` are this spike's own code.

## Changes to copied code

Changes made in this spike to the `src/md/` files copied from spike 1.
Everything else in `src/md/` is unmodified from the copied commit.

- **`src/md/parse.ts`, `src/md/serialize.ts` (brief 04, 2026-09-27): the
  `parseBlock` isolation-reparse cache now persists across calls instead of
  being cleared every time.** Profiling the 240 KB real-world corpus file
  (`corpus/fetched/real/nodejs-node-docapinapimd.md`, 1619 top-level blocks)
  found `parseMarkdown`/`serializeDoc` each cost ~1.3s on that file. The cache
  spike 1 had already added (`parseBlockCache`/`ctxSkipCache` in `parse.ts`,
  keyed by the exact `ctx`+`src` content) removes the redundant re-parse of
  the shared definitions context, but was cleared at the start of every
  `serializeDoc` call and the end of every `parseMarkdown` call, so it never
  survived from one daemon operation to the next -- every save and every
  export re-paid the isolation re-parse for all 1619 blocks, even though a
  save touches one block and leaves the other 1618 blocks' own `src`+`ctx`
  byte-identical to the previous save. Removed both clearing calls and
  wrapped the two caches in a small LRU (bounded at 8000 / 500 entries) so
  they persist across calls but can't grow without limit across a long
  daemon session touching many documents. Effect measured on the 240 KB
  file: `parseMarkdown` 1308ms -> 145ms, `serializeDoc` 1264ms -> 137ms
  (warm-cache/steady-state numbers; see gate J, `results/j-before.json` /
  `results/j-after.json`). `clearParseBlockCache()` (unchanged signature)
  remains exported, for tests that want to compare a cold parse against a
  warm one -- see `test/md-roundtrip.test.ts`'s cache-parity test, which
  proves this change never alters output (cold vs warm, byte for byte, on
  every handwritten corpus file and the 240 KB file).
- **`src/md/index.ts`: export `clearParseBlockCache`.** Needed by the new
  cache-parity test above; previously internal to `parse.ts`.

No other behavioural change was made to `src/md/`. `src/core/diff.ts` and
`src/core/docsync.ts` (this spike's own code, not copied) also got brief
04 perf fixes -- see those files' own comments (a quadratic
`Y.XmlFragment#toArray()` call in `diff.ts`'s `applyChildOps`, and a
redundant whole-document `parseMdast` call in `docsync.ts`'s
`renderDetailed`) -- not logged here since they aren't copied code.
