# Log: builder, spike 1 gates harness

Status: in-progress
Author: builder (Sonnet 5)
Updated: 2026-09-27
Plan: [brief 03: gates harness](../plans/2026-09-27-spike-1-brief-03-gates.md)

Timezone: local machine time, CEST (Europe, UTC+2), as printed by `date`.

## 04:01 — task received

Read AGENTS.md and brief 03 (gates harness). Goal: build `npm run gates` in
spikes/2026-09-27-markdown-core-remark-splice/ covering gates A-E over the
corpus (handwritten/real/commonmark/gfm), threshold table, results/gates.md +
results/gates.json, README update. Budget ~2.5h session.

Next: read spike README, src/index.ts, src/parse.ts, src/serialize.ts,
src/style.ts, tools/quick-roundtrip.ts, and the charter's gate table / D4 in
architecture-decisions.md.

## 04:20 — read complete, planning

Read all of the above plus src/compare.ts, src/schema.ts, test/*.test.ts,
corpus/README.md, corpus/manifest.json, scripts/fetch-corpus.mjs. corpus/fetched
already present (from a prior run), 266 real + 655 commonmark + 672 gfm. 28
handwritten files (matches brief's count; corpus/README.md's own count of 26
is stale).

Plan: (1) fix positions side table perf hot spot first since it's called out
explicitly and gates depend on speed; (2) fix positions side table to record
each node's own span (brief's ask); (3) add yjs/y-prosemirror deps; (4) build
gates/ harness gate by gate; (5) wire package.json scripts; (6) run quick,
then full; (7) write results/gates.md+json, README, tests; (8) commit.

## 04:35 — perf bug found and fixed in src/parse.ts: parseBlock's ctx reparse

Profiled the largest real corpus file (corpus/fetched/real/nodejs-node-docapinapimd.md,
246 KB, 1619 top-level blocks, defs ctx 7985 chars): parseMarkdown took 7.9s
alone. Root cause: `parseBlock(src, ctx)` reparsed `ctx` alone via
`parseMdast(ctx)` on every single call (once per top-level block during the
self-description check, plus again during serialize-time verification) just
to compute `skip` (how many top-level nodes `ctx` itself parses to). Same
`ctx` string every time within one document, so this was pure repeated work,
worst case O(blocks * ctx_size).

Fix (src/parse.ts, `parseBlock`): cache `skip` in a `Map<string, number>`
keyed by the ctx string content, cleared alongside `parseBlockCache`.
Additionally: link/footnote/image references all require a literal `[`
in the source; a block with no `[` cannot resolve against `ctx` regardless
of its content, so for the non-map call path (self-description check,
verbatim/splice verification -- the O(blocks) hot loop) skip prepending
`ctx` entirely when `src` has no `[`. Restricted to the non-map path only:
`serialize.ts`'s `trySplice` computes `srcS = sAbs - ctx.length` assuming
the map's sourceOffsets are always relative to the real `ctx + src`, so the
map-producing call keeps using the real `ctx` unconditionally to avoid an
offset bug.

Result: same file 7.9s -> 1.6s; whole `corpus/fetched/real` set (266 files),
parse+serialize once, 82s -> 20s (4x). Verified no correctness change:
`npm test` still green (9/9), `npx tsx tools/quick-roundtrip.ts` still shows
294/294 handwritten+real byte-identical (1 unstable block, same file as
before, kubernetes-enhancements-kepssignode2837podlevelresourcespecr.md),
655/655 commonmark, 672/672 gfm.

## 05:05 — positions side table fixed (src/parse.ts)

Per brief: the positions side table recorded the *enclosing top-level
block's* span for every node at any depth, not each node's own. Gate B needs
a paragraph's own line range (nested in a list/blockquote or not) to check
containment precisely.

Implementation: `blockFromMdast`/`listItemFromMdast` now take an optional
`posMap: WeakMap<PMNode, NodePosInfo>` and record each constructed node's own
mdast `position` (start/end line+offset) against the node instance, for every
node type including nested `table_row`/`table_cell`. `parseMarkdown` builds
this map only when `opts.positions` is set, threads it through the per-block
conversion, then explicitly re-keys each *top-level* block's entry against
the final post-`withAttrs`/post-self-description-check node instance (using
the same hug/gap-adjusted span already used for `src`), because both of
those steps construct a new top-level node object -- nested descendants are
unaffected (same child fragment) so their recorded positions still resolve.
`ParseResult.positions` is now built by `doc.descendants` looking up each
non-text/non-inline node in the map, rather than the old manual recursion
that stamped every descendant with its top-level ancestor's span.

Verified with test/positions.test.ts (new): a paragraph nested in a
blockquote reports its own 1-line span (not the blockquote's 3-line span),
and a paragraph nested in a list item reports its own line, not the whole
list's range. `npm test`: 11/11 green (9 previous + 2 new).
