# CRDT rebase, Yjs fork approach — core

Status: in progress (brief 1 of several; see the plan and briefs in `context/plans/`)

Goal: prove the "fork at base, two-way diff, merge" rebase algorithm from
[the spike-2 plan](../../context/plans/2026-09-27-spike-2-plan.md) (sections 1-4)
on Yjs. This package implements the core: Markdown <-> ProseMirror, deterministic
seeding, the two-way tree diff at four granularities, and the fork-at-base
rebase with its `phraise` map records. Later briefs add the replica harness,
needs-review/resurrection, comments, attribution, re-seed and gates.

## How to run

```sh
npm install
npm test          # vitest: parse/seed round-trip, 35 A/B pairs x 4
                   # granularities, concurrent-edit survival, idempotence,
                   # chained rebase
npm run typecheck # npx tsc --noEmit
```

## Layout

- `src/schema.ts` — the ProseMirror schema (plan section 2): `doc`,
  `paragraph`, `heading(level)`, `bullet_list`, `ordered_list(order)`,
  `list_item`, `blockquote`, `code_block(params)`, `horizontal_rule`, `text`;
  marks `em`, `strong`, `code`, `link(href, title)`. No inline nodes other
  than text, so every textblock maps to exactly one `Y.XmlText`.
- `src/markdown.ts` — `parseMarkdown`/`serializeMarkdown`, built on
  `prosemirror-markdown`'s `MarkdownParser`/`MarkdownSerializer` with
  markdown-it's `commonmark` preset (`html: false`, so raw HTML falls back to
  plain text). Images and hard breaks are ignored (both explicitly allowed by
  the plan). Byte-exact Markdown round-tripping is out of scope; comparisons
  happen at the PM-JSON level via `Node.eq`.
- `src/ids.ts` — `hash32` (FNV-1a, never 0) and the two deterministic peer id
  helpers (`seedPeerId`, `rebasePeerId`).
- `src/seed.ts` — `seedDoc`/`docToPM`. `gc: false`, deterministic seed peer,
  `base` pointer + `snapshot:<commit>` + git author registration, written in
  two transactions (content+base+author, then snapshot) per plan section 4.
- `src/diff.ts` — the two-way tree diff: an exact-match LCS over a structural
  hash (type + attrs + full JSON content) first, then a fuzzy LCS pass inside
  each unmatched run (same node type + word-level Dice similarity >= 0.5).
  Paired textblocks get a text diff at the configured granularity (`word`/
  `char` via jsdiff + a whole-run `applyDelta` reformat pass so marks end up
  exactly matching pmB; `block` replaces the whole text; `yprosemirror`
  delegates entirely to y-prosemirror's own `updateYFragment`, used only as a
  comparison point per the plan).
- `src/rebase.ts` — `computeRebaseUpdate`: forks `live` at its base snapshot,
  assigns the deterministic rebase peer, diffs, asserts the result equals
  `parseMarkdown(targetMarkdown)` (throws otherwise), writes the `base`/
  `rebase:<id>`/author records and a fresh snapshot, and returns the fork's
  update since the pre-edit state vector. Does **not** apply the update to
  `live` — the caller does.
- `src/text.ts` — `docPlainText`/`offsetToPosition` (plan section 2's doc
  plain text and offset-to-`(XmlText, index)` mapping for comment selectors).
- `fixtures/corpus/` — the repo's own `AGENTS.md` and `context/docs/*.md`
  (realistic Markdown, MIT-licensed like the rest of the repo).

## Design decisions not fully pinned down by the plan

- **Base/rebase/snapshot ids are the commit hash itself.** The plan's
  `base: {id, commit}` and the `rebase:<id>`/`snapshot:<id>` map keys don't
  specify where `id` comes from. Git commits are already unique per document,
  so using the commit hash as `id` throughout (for the seed base and every
  later rebase's resulting base) avoids inventing a separate id scheme.

## A real bug found and fixed along the way

`Y.XmlText`'s own `toString()`/`toJSON()` serialize to an XML-ish string with
mark tags (e.g. `<link href="...">the docs</link>`), not plain text. Using it
directly as "plain text" for the char/word jsdiff comparison, or for
`docPlainText`, fed tag markup into the diff as real characters and corrupted
results whenever a textblock had any mark. Fixed with a small `plainText`
helper (`yText.toDelta().map(d => d.insert).join("")`) used everywhere plain
text is needed instead.

## Non-scope (later briefs)

Comments, needs-review, resurrection, replica harness, fuzz testing, Loro.
