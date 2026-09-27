# CRDT rebase, Yjs fork approach — core + integration + gates

Status: in progress (briefs 1-2 of several; see the plan and briefs in `context/plans/`)

Goal: prove the "fork at base, two-way diff, merge" rebase algorithm from
[the spike-2 plan](../../context/plans/2026-09-27-spike-2-plan.md) on Yjs.
Brief 1 built the core (sections 1-4): Markdown <-> ProseMirror, deterministic
seeding, the two-way tree diff at four granularities, and the fork-at-base
rebase with its `phraise` map records. Brief 2 (this update) adds sections
5-8: per-replica integration (needs-review, resurrection), comments anchored
by CRDT position plus quote selectors, attribution, re-seed, a replica test
harness, and gates A-G plus an idempotence row, all runnable via
`npm run gates`.

## How to run

```sh
npm install
npm test          # vitest: brief 1's core suite, plus a 3-test integration
                   # smoke check and all 9 gates (174 tests total)
npm run gates      # prints a Markdown table for gates A-G + idempotence;
                   # exits non-zero if any gate fails
npm run typecheck  # npx tsc --noEmit
```

## Layout (brief 1: core)

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
  (realistic Markdown, MIT-licensed like the rest of the repo), also used by
  gate G below.

## Layout (brief 2: integration, comments, attribution, re-seed, gates)

- `src/integrate.ts` (plan section 5) — `integrate(doc, P, myClientId)`: for
  every rebase record this replica hasn't acked yet, computes
  `upstreamChanged`/`localChanged`/needs-review per textblock element and
  resurrects blocks the rebase deleted but this replica edited since the
  base. Identity across snapshots is just the element's own Yjs item id
  (stable forever since `gc: false` never replaces a deleted item's
  `ContentType`), so no separate identity-mapping scheme was needed.
  `isVisibleAt(item, snapshot)` reimplements yjs's own private `isVisible`
  from exported primitives (`Y.isDeleted` + the item's id/clock), since yjs
  doesn't export it. `needsReview(doc)` lists currently-visible flagged
  blocks with their text.
- `src/replica.ts` (plan section 8) — `Replica` wraps a `Y.Doc` (`gc: false`)
  with a name, an optional human user (registered in `authors`), edit helpers
  (`insertText`/`deleteText` at a global plain-text offset, `insertBlock`/
  `deleteBlock` — top-level only, a documented simplification), `runRebase`,
  and `receive(updates)` (snapshots `P`, applies, runs `integrate`). Links
  between replicas are per-direction queues; nothing auto-delivers, `online`/
  `offline` are informational, and `deliver(from, to, order?)` is the only
  way updates move — giving tests full control over delivery order,
  including shuffled per-update orders (gate D).
- `src/comments.ts` (plan section 6) — `addComment`/`resolveComment`/
  `resolveAll`: a CRDT `RelativePosition` pair (assoc 0/-1) plus quote
  selectors (`exact`, 32-char `prefix`/`suffix`), resolved as a pure function
  of the doc — CRDT position first, else `approx-string-match` with
  Hypothesis-style scoring (quote 50, prefix 20, suffix 20, position
  proximity 2), accepted only at quote similarity >= 0.75, else `orphaned`
  (quote kept forever).
- `src/reseed.ts` (plan section 6, decision D1) — `reseed(oldDoc, docId,
  markdown, commit, author)`: fresh doc, each old comment's selectors
  refreshed from the old doc's resolved text, re-anchored in the new doc by
  selectors only (never CRDT position, since the new doc shares no history).
- `src/attribution.ts` (plan section 7) — `listAttribution(doc)`: runs of
  visible text per textblock grouped by inserting client id, mapped through
  `authors`. `blockPath` is a single-element ordinal (no node-path scheme
  exists elsewhere in this codebase); `from`/`to` are global doc-plain-text
  offsets, the same space comments use.
- `src/gates/` — one module per gate (`gate-a-c.ts`, `gate-b.ts`, `gate-d.ts`,
  `gate-d2.ts`, `gate-e.ts`, `gate-f.ts`, `gate-g.ts`, `gate-idempotent.ts`),
  each a plain function returning `{name, pass, detail}`, plus
  `scenario.ts` (the shared fixture) and `convergence.ts`. Both
  `test/gates.spec.ts` (vitest) and `scripts/gates.ts` (`npm run gates`) call
  the same functions, so there is exactly one implementation of each gate.

## What each gate proves

The shared scenario (`src/gates/scenario.ts`) is a 10-block document (a
heading, an untouched paragraph, a second heading, a paragraph B rewrites in
place, a paragraph B deletes outright (with a negative-control paragraph of
similar-but-different wording left untouched), paragraphs P/Q/P2, and a
3-item list) rebased from commit A to commit B while **bob** (offline) edits
P and P2, and **alice** (online) edits Q, concurrently with the rebase.
`server` runs the rebase.

- **A** — the untouched paragraph's comment resolves `crdt`, to the identical
  text, after the rebase and full convergence.
- **B** — a comment on a quote that survives a same-paragraph rewrite
  resolves via `crdt` at `word`/`char` granularity, and via `fuzzy` at
  `block` granularity (block-granularity replaces the whole text, so the
  CRDT anchor cannot survive by construction — the plan requires the fuzzy
  fallback to still succeed there).
- **C** — the deleted paragraph's comment resolves `orphaned` and keeps its
  quote; a negative control (a second paragraph with similar wording,
  deliberately left in commit B) confirms it isn't mis-captured there.
- **D** — after every one of the 3! = 6 orderings of delivering each party's
  whole pending batch (server's rebase, alice's edit, bob's edit), each
  followed by a relay-fixpoint drain, *and* 50 seeded-random shuffles of the
  individual queued updates delivered one at a time across all pending
  links: all three replicas converge to identical ProseMirror JSON and an
  identical `review` map, bob's and alice's inserted text and B's changes are
  present, P and Q (and only P/Q, plus the resurrected P2 below) are
  flagged.
- **D2** — B deletes P2 while bob edited it offline: P2 is resurrected with
  bob's text exactly once, flagged `deleted-upstream-edited-locally`, and
  present identically on all three replicas.
- **E** — `listAttribution` shows ranges by Alice, Bob, the seed git author
  ("Repo Owner", commit A), and the synthetic rebase peer named after commit
  B's git author ("Contributor Two").
- **F** — every block *not* concurrently edited (i.e. not flagged, and with
  no human-authored run) equals commit B's text exactly, checked by identity
  (the block's own stable item id) rather than by re-deriving a mapping.
- **G** — re-seed over the real corpus in `fixtures/corpus/`: 50 random
  1-4-word-phrase comments, re-seeded with 0/1/3/10 random single-word edits.
  Ground truth per comment is computed generically from a `Diff.diffChars`
  mapping between the pre- and post-edit doc plain text (decoupled from how
  the edits were made); "correct" means IoU >= 0.5 with ground truth, or
  `orphaned` when ground truth was fully deleted. Required: 100% correct
  with 0 edits, 0% mis-anchored with 1 edit; the 3- and 10-edit rows are
  reported, not gated.
- **idempotent** — brief 1's idempotence property (two replicas computing
  the same rebase, one with an extra unsynced local edit, produce
  byte-identical updates; re-applying the same update never duplicates
  content), carried into this brief's gate table as its own row.

## Design decisions not fully pinned down by the plan

- **Base/rebase/snapshot ids are the commit hash itself** (brief 1). Git
  commits are already unique per document, so using the commit hash as `id`
  throughout avoids inventing a separate id scheme.
- **Resurrection position** (plan section 5 says "at the nearest valid
  position under its nearest live ancestor" without specifying the exact
  index): this implementation appends at the end of the live ancestor's
  current children. Sound (the block is never lost, and lands under the
  right container) but does not try to preserve original sibling ordering
  among other resurrected/live blocks.
- **Block edit helpers are top-level only** (`Replica.insertBlock`/
  `deleteBlock` address a block by index among the root `pm` fragment's
  direct children, not an arbitrary nested path).
- **`blockPath` in attribution** is a single-element ordinal (document
  order), not a ProseMirror-style structural path, since no such path scheme
  exists elsewhere in this codebase.
- **Delivery is always manual** (`Replica`'s `online`/`offline` are
  informational only; nothing auto-flushes). This gives tests full control
  over delivery order, which gate D's exhaustive-permutation requirement
  needs regardless of what "online" would otherwise mean.

## Real bugs found and fixed along the way

- **`Y.XmlText.toString()`/`.toJSON()` are not plain text** (brief 1): they
  serialize to an XML-ish string with mark tags. Fixed with a small
  `plainText` helper (`yText.toDelta().map(d => d.insert).join("")`) used
  everywhere plain text is needed.
- **A human author's registration item was never transmitted to peers**
  (brief 2): `Replica`'s constructor registered the human author via a plain
  `doc.transact(...)`, not through the same path that captures a delta and
  queues it to peers — and no peer exists yet at construction time regardless.
  That item's clock was then permanently excluded from every future delta's
  declared "from" state vector, so any peer linked afterward hit a missing
  dependency yjs silently defers forever (verified via `Y.parseUpdateMeta`
  and by reproducing it with a full-state `applyUpdate`, which fixed it).
  Fixed by having `Replica.link(other)` also queue each side's *full*
  current state to the other in addition to registering the link;
  re-applying already-known ops is a no-op in yjs, so this is harmless.
- **Gate F's first fixture was wrong, not the code**: an early version of
  commit B's rewrite of paragraphs P/Q shared only 2 words with commit A's
  version. Plan section 3's tree diff only pairs an A/B textblock as an
  "update" (in-place edit) when word-level Dice similarity >= 0.5; below
  that it's correctly treated as delete-then-insert. That's the right
  behavior, but it meant the fixture didn't exercise the "B changes P and Q"
  in-place-edit case gate D describes — a genuine finding, not a bug. Fixed
  by rewording B's P/Q to keep >=50% of the original wording.
- **`resolveComment` didn't handle a re-seeded comment with no CRDT
  position**: `reseed` stores `start`/`end: null` for a comment that failed
  to anchor by selectors (no shared history with the new doc to build a
  `RelativePosition` from), but `resolveRecord` called
  `Y.createRelativePositionFromJSON` on it unconditionally. Fixed with an
  explicit null check that short-circuits straight to the fuzzy fallback.

## Non-scope (later briefs)

Fuzz testing (gate H), Loro, UI, networking.
