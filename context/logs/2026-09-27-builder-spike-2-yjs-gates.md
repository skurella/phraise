Status: active
Author: builder (Sonnet)
Updated: 2026-09-27
Related: [brief](../plans/2026-09-27-spike-2-brief-02-yjs-integration-gates.md), [plan](../plans/2026-09-27-spike-2-plan.md)

Time zone: local machine time (CEST), from `date`.

## 04:34 — task received

Read AGENTS.md, brief 02, plan sections 5-8, and all of brief 01's code
(schema.ts, markdown.ts, ids.ts, seed.ts, diff.ts, rebase.ts, text.ts) plus
its log. Key facts carried forward: gc:false throughout, deterministic peer
ids via hash32, plain text must come from `XmlText.toDelta()` not
`toString()`. `npm install` in the spike dir works (network available);
added `approx-string-match@2.0.0` as a new dependency for comments (section
6), confirmed it ships its own .d.ts.

Investigated Yjs internals needed for section 5 (integration) since the
public API doesn't export `isVisible` or a way to walk a type's full history
including deleted items: `AbstractType._start`/`Item.right`/`Item.left`
/`Item.deleted`/`Item.id` are typed exports even though "internal"; ContentType
wrapping an XmlElement/XmlText is never replaced with ContentDeleted while
gc:false (verified in yjs source), so walking a fragment's linked list via
`_start`/`.right` finds every textblock element ever created, live or deleted,
and `Y.isDeleted(snapshot.ds, item.id)` (which IS exported) plus the item's
own id/clock let me reimplement `isVisible(item, snapshot)` exactly matching
yjs's private implementation, without deep-importing yjs internals.

Design decision (logging per AGENTS.md): since every textblock element's
underlying Y Item persists forever (gc:false) with a stable id, I identify
"the same element across snapshots" by that Item's id directly, rather than
building any separate mapping. This makes the upstreamChanged/localChanged/
needsReview set logic in plan section 5 a direct content-at-snapshot
comparison per item, and makes convergence in gate D fall out for free: each
replica's `integrate()` only ever inspects ITS OWN pre-batch snapshot P, so a
concurrent edit is always detected by its own author's replica (P always
contains a replica's own prior edits), independent of delivery order — the
final `review`/`comments`/`pm` CRDTs converge via ordinary Yjs merge
regardless of which replica raised which flag. Proceeding to implement
src/integrate.ts, src/replica.ts, src/comments.ts, src/attribution.ts,
src/reseed.ts, gates, and tests.

## 04:50 — starting implementation

Wrote src/integrate.ts, src/replica.ts, src/comments.ts, src/attribution.ts,
src/reseed.ts. `npx tsc --noEmit` clean.

## 04:51 — real bug found in replica.ts, fixed

A 3-test smoke spec (seed/edit/rebase/deliver a concurrent flag; comment
resolves crdt across a rebase; reseed anchors an unchanged comment) caught a
real convergence bug: registering a human author in `Replica`'s constructor
ran as a plain `doc.transact(...)`, not through the same `runLocal` path that
captures a delta and queues it to peers. Since no peer exists yet at
construction time, that item (clock 0 for the human's own clientID) was never
queued to anyone. The replica's first *future* edit's delta is computed via
`encodeStateAsUpdate(doc, before)`, where `before` already reflects clock 1
(past the registration item) — so that delta's declared "from" state vector
silently assumes the peer already has clock 0 for this client. It never does.
Yjs's `applyUpdate` doesn't error on this; it defers the struct into its
internal pending-structs buffer forever (verified via `Y.parseUpdateMeta` on
the queued updates, and by manually applying a *full* `encodeStateAsUpdate`
with no fromStateVector, which fixed it). Net effect: once any peer links
after a human replica's construction, none of that human's edits or `review`/
`comments` writes would ever actually integrate anywhere, silently.

Fix: `Replica.link(other)` now also queues each side's *full* current state
(`Y.encodeStateAsUpdate(doc)`, no fromStateVector) to the other, in addition
to registering the link. Redundant re-application of already-known ops is a
no-op in yjs, so this is harmless, and it closes the gap regardless of what
happened before the link (construction-time registration, or any pre-link
edits). All 3 smoke tests pass after the fix; `npx tsc --noEmit` clean.
Moving on to the gate harness (A-G, plus the idempotence row) and full test
suite.

## 05:00 — gates A-G + idempotence implemented, all green

Wrote `src/gates/scenario.ts` (a shared 10-block fixture: heading, 6
paragraphs incl. one deleted, one negative control, P/Q/P2 for concurrent
edits and resurrection, and a 3-item list; server + alice (online) + bob
(offline), commit A -> B, plus two comments planted on A), `convergence.ts`,
and one module per gate (`gate-a-c.ts`, `gate-b.ts`, `gate-d.ts`, `gate-d2.ts`,
`gate-e.ts`, `gate-f.ts`, `gate-g.ts`, `gate-idempotent.ts`), each a plain
function returning `{name, pass, detail}` so `test/gates.spec.ts` (vitest) and
`scripts/gates.ts` (the `npm run gates` Markdown-table script) share exactly
one implementation instead of duplicating scenario logic.

Two more real findings while wiring this up:

1. **Gate F first failed**: P and Q, whose commit-B rewrite I'd originally
   written as a full sentence replacement, came out flagged
   `deleted-upstream-edited-locally` on a *brand-new* item id instead of
   `concurrent-edit` on their original id. Root cause: plan section 3's tree
   diff only pairs an A/B textblock as an "update" when word-level Dice
   similarity >= 0.5; my rewrite shared only 2 words with the original, so
   the algorithm correctly (and, on reflection, appropriately) treated it as
   a delete-then-insert rather than an in-place edit. This is a real,
   correct property of the diff, not a bug — but it meant my fixture didn't
   actually exercise the "B changes P and Q" in-place-edit case the plan
   describes for gate D. Fixed by rewording B's P/Q to keep >=50% of the
   original words (matching the "rewritten" paragraph and the list-item
   case, which were already high-similarity and passed from the start).
2. `resolveComment`/`reseed`: a comment that fails to anchor by selectors
   during re-seed is stored with `start`/`end: null` (no CRDT position at
   all, since the new doc shares no history with the old one). The original
   `resolveRecord` called `Y.createRelativePositionFromJSON(null)`
   unconditionally, which would have thrown the first time gate G hit an
   orphan under the 3/10-edit scenarios. Added an explicit null check that
   short-circuits straight to the fuzzy fallback.

Gate D's "every delivery order" requirement is implemented as (a) all 3! = 6
orderings of delivering each party's whole pending batch, each followed by a
relay-fixpoint drain, and (b) 50 seeded-random (mulberry32) shuffles of the
*individual* queued updates across all four pending links, each delivered as
its own single-update `receive()` call (so each one gets its own fresh `P`
snapshot) before the same fixpoint drain — 56 independent convergence checks
per run, all passing in ~330ms.

Gate G loads and concatenates all files under `fixtures/corpus/`, plants 50
random 1-4-word-phrase comments, and re-seeds at 0/1/3/10 random single-word
edits. Ground truth for "correct" (IoU >= 0.5) is computed generically via a
`Diff.diffChars` mapping between the pre- and post-edit plain text — decoupled
from how the edits were made, which sidesteps needing to keep an edit script
and its offset bookkeeping in lock-step. Actual results this run: 50/50
correct at 0 and 1 edits (required), and, on this corpus, still 50/50 at 3
and 10 edits (reported, not required) — plausible given the corpus is ~54KB
against single-word swaps.

Full suite: `npm install && npm test && npm run gates` all green (174 vitest
tests across 7 files including the 9 gate tests; `npm run gates` prints the
Markdown table and exits 0), `npx tsc --noEmit` clean (added `scripts/` to
`tsconfig.json`'s `include` so the gates script itself is checked too).
Updating the README next, then committing.

## 05:05 — committed, handback

README updated (gates command, per-gate proof descriptions, design decisions,
bugs found). Staged explicitly (no `git add -A`), committed as `eda25af` on
`spike/2026-09-27-crdt-rebase` (not pushed). Handing back to spike
orchestrator now.
