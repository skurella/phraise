Status: active
Author: builder (Sonnet)
Updated: 2026-09-27
Related: [brief](../plans/2026-09-27-spike-2-brief-01-yjs-core.md), [plan](../plans/2026-09-27-spike-2-plan.md)

Time zone: local machine time (CEST), from `date`.

## 04:14 — task received

Read AGENTS.md and the brief (`2026-09-27-spike-2-brief-01-yjs-core.md`) plus plan sections 1-4.
Goal: create `spikes/2026-09-27-crdt-rebase-yjs-fork/` npm package implementing schema/markdown
parsing, deterministic seeding, two-way tree diff, and fork-at-base rebase. Node 22.12.0, npm 11
confirmed available. `spikes/` currently empty except README. Starting package scaffold now.

## 04:35 — core modules written, tsc clean

Wrote schema.ts (own PM schema per plan section 2), markdown.ts (parser built on
prosemirror-markdown's MarkdownParser + markdown-it commonmark preset html:false;
serializer reuses prosemirror-markdown's node/mark serializers), ids.ts (FNV-1a
hash32, never 0), seed.ts (seedDoc/docToPM, gc:false, deterministic seed peer,
base pointer + snapshot:<commit> + author registration in two transactions per
plan section 4), diff.ts (two-way tree diff: structural-hash LCS for exact
matches, then a fuzzy LCS pass with word-level Dice >= 0.5 within each
unmatched run; word/char granularities via jsdiff + a reformat pass that sets
every mark attribute (including nulling removed ones) to match pmB exactly;
block granularity replaces the whole textblock text; yprosemirror granularity
delegates entirely to y-prosemirror's own updateYFragment), rebase.ts
(computeRebaseUpdate: fork at base snapshot, deterministic rebase peer,
diff+assert `result.eq(pmB)`, write base/rebase:<id>/authors in one
transaction, snapshot:<id> in a second, export update since pre-edit state
vector; does not apply to `live`), text.ts (docPlainText + offsetToPosition).

Design decision not fully pinned down by the plan: I used the commit hash
itself as both `base.id` and the key for `rebase:<id>` / `snapshot:<id>`,
since git commits are already unique per doc and this avoids inventing a
separate id scheme. Logging it here per AGENTS.md ("a finding that changes a
design belongs in the log first").

`npx tsc --noEmit` is clean. Starting on fixtures/tests next.

## 04:32 — A/B fixtures written, found and fixed a real bug

Wrote 34 A/B markdown pairs (test/fixtures-ab.ts) covering all the edit kinds
the brief lists, and a test running each pair through every granularity with
no concurrent edits (test/rebase.spec.ts). Found a real bug: `Y.XmlText`'s own
`toString()`/`toJSON()` return an XML-ish string with mark tags (e.g.
`<link href="...">the docs</link>`), not plain text — I'd used it directly as
"plain text" for both the char/word jsdiff comparison in diff.ts and for
`docPlainText` in text.ts. For any textblock containing a mark, this fed tag
markup into the character-diff as if it were real content, corrupting the
result (observed: a link-href-only change collapsed the linked text to
newline padding, since Yjs's `format`/`applyDelta` retain past the actual
content length pads with literal "\n", per a comment in Yjs's own YText.js
about Quill's newline convention). Fixed by adding a `plainText(yText)` helper
in both files that uses `yText.toDelta().map(d => d.insert).join('')` instead.
Also switched the mark-reformat pass from per-run `yText.format()` calls to a
single `yText.applyDelta(retainOps)` call (one threaded cursor for the whole
run, matching y-prosemirror's own `updateYText` pattern) since independent
`format()` calls showed the same corruption before the plainText fix and I
want the more proven code path regardless.

All 141 cases (34 pairs x 4 granularities, plus 7 sanity tests) now pass.
`npx tsc --noEmit` clean. Moving to concurrent-edit, idempotence and chained
rebase tests.

## 04:33 — all definition-of-done items met, wrapping up

Final test run: 162 tests passed across 5 files (test/seed.spec.ts,
test/rebase.spec.ts, test/concurrent.spec.ts, test/idempotence.spec.ts,
test/chained.spec.ts). `npx tsc --noEmit` clean. Wrote README.md documenting
goal, layout, the two design/implementation notes (base/rebase id scheme,
the Y.XmlText.toString() plain-text bug) and non-scope. Verified git status
shows only source files under spikes/2026-09-27-crdt-rebase-yjs-fork/ (no
node_modules, no dist — confirmed via `git check-ignore`). Staging explicitly
and committing on the current branch now, per brief. Handing back.
