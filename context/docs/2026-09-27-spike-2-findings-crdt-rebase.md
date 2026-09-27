# Spike 2 findings: rebasing a live CRDT document and keeping comments anchored

Status: final for spike 2
Author: spike 2 orchestrator (Opus 5.5)
Updated: 2026-09-27
Related: [charter](../plans/2026-09-27-spike-2-charter-crdt-rebase.md), [plan and algorithm spec](../plans/2026-09-27-spike-2-plan.md), [orchestrator log](../logs/2026-09-27-orchestrator-spike-2.md), [architecture decisions](2026-09-27-architecture-decisions.md) D1, D3, D5, D6

## Summary

The rebase works, on Yjs, headless, with every charter gate passing, under one stated reading of gate H. The mechanism is simpler than the charter assumed. There is no three-way merge code. The rebase forks the CRDT at the base commit's version, applies a plain two-way diff A to B on the fork, and merges the fork back. The CRDT merge absorbs uncommitted live edits and offline edits alike. A deterministic peer ID makes the rebase idempotent: two replicas running it produce byte-identical updates. Loro can express the same algorithm with `forkAt`, but it is not materially simpler or more correct. Its ProseMirror binding is less mature, so D5 stays Yjs. The largest risk found is not in the rebase at all. It is the editor binding: y-prosemirror 1.3.7 drops root-node attributes and marks on atom nodes. The Yjs 14 release candidate fixes both.

## Gate results

Commands, from a clean clone after `npm install`: `npm run gates` in `spikes/2026-09-27-crdt-rebase-yjs-fork/` (about 30 s), `npm run fuzz` for the granularity comparison (about 60 s), `npm run gates` in `spikes/2026-09-27-crdt-rebase-loro-fork/`. The orchestrator ran all of them from a fresh clone of the pushed branch.

| Gate | Yjs result | Numbers |
|---|---|---|
| A. Untouched anchor | pass | Resolves through the CRDT position to identical text. |
| B. Rewritten paragraph | pass | `word` and `char`: CRDT position survives. `block`: CRDT anchor dies by construction; the fuzzy quote match recovers it. |
| C. Deleted paragraph | pass | Orphaned, quote kept. A negative control with similar wording elsewhere is not captured. |
| D. Concurrent edit | pass | Offline edit and upstream edit to the same paragraph both survive. The block is flagged. 6 batch orders plus 50 shuffled per-update orders all converge, including the `review` map. D2: a paragraph deleted upstream while edited offline is resurrected once, with the local text, and flagged. |
| E. Attribution | pass | Ranges listed for two humans, the seed's git author and the synthetic rebase peer named after commit B's author. |
| F. Equality | pass | Every block no human touched equals B at ProseMirror-JSON level, marks included; also 0 violations in 1,100 fuzz trials. |
| G. Re-seed | pass | Unchanged text: 50 of 50 re-anchor exactly. Edits aimed at the comments (G2, 200 comments, one document per corpus file): 1 edit per comment gives 187 correct, 13 orphaned, 0 mis-anchored; 3 edits give 119 correct, 76 orphaned, 5 mis-anchored (2.5 %). Random edits spread over the document (G): 50 of 50 correct at 1, 3 and 10 edits, which mostly shows that random edits rarely touch a comment. |
| H. Fuzz | pass, see caveat | 500 `word` trials: 0 exceptions, 0 divergence, 0 rebase-caused text loss, 0 F-violations, flag precision and recall 100 %, 103 dual-rebase trials byte-identical. **Caveat:** in 38 of 500 trials (7.6 %) a token is lost because another human deleted the whole block concurrently. That is ordinary CRDT delete-versus-edit behaviour: it happens with no rebase at all, and Loro loses the same text. The gate counts only loss caused by the rebase and prints the human-versus-human count beside it. Under a literal reading of "no local text is lost", H fails at 7.6 %. |
| I. Yjs versus Loro | done | Loro implementation passes A to F, idempotence and a 200-trial mini fuzz. Assessment below. |
| Stretch: Yjs 14 attribution | partly | Per-client insert ranges work in Yjs 14 RC exactly as in 13, including across the fork-and-merge. The RC has no automatic "who wrote this" manager; its `AttributionsRenderer` renders attributions you supply. |

## The algorithm as built

1. **Seed** a `Y.Doc` with `gc: false` from commit A's Markdown, using a peer ID derived from the document ID and commit, so any two replicas seed identically. Store the base pointer and an encoded `Y.snapshot` of the seeded state in a `phraise` map.
2. **Rebase** onto B on any replica: `Y.createDocFromSnapshot(live, S_A)` gives a fork whose items carry their original IDs. Set the fork's client ID to `hash32(docId, baseId, targetCommit)`. Apply the two-way diff pmA to pmB. Assert the fork now equals pmB. Write the rebase record, the new base pointer and the snapshot `S_B`. Export the fork's update since the fork point. Apply it to the live document. Every live edit since A is concurrent with this branch, so the CRDT merge does the three-way work.
3. **Two-way diff**: children are aligned recursively by LCS on a structural hash. Unmatched runs are paired by type and word similarity of at least 0.5. Paired textblocks get a word-level jsdiff, then a formatting pass so marks equal B's.
4. **Integration on every replica**: before applying a batch of remote updates, the replica takes a snapshot P. For each newly seen rebase record it compares every textblock at `S_A`, `S_B` and P, comparing node attributes and the formatted delta. If a block changed upstream and also changed locally, the replica writes `review[blockId]` in a shared map. Those writes are idempotent, so the flag set does not depend on delivery order. If a block was deleted upstream and still holds this replica's own edits, the replica re-inserts it from P under the nearest live ancestor and flags it. Only the author of the edits resurrects, so this happens once per author. The replica then writes an ack.
5. **Comments** store a relative position pair plus quote selectors. Resolution tries the CRDT position, then a fuzzy quote match, then orphaning (see design points).
6. **Attribution**: a git peer is registered in an `authors` map, inside the rebase's own deterministic transaction. Humans register at connect, standing in for the server's authentication hook. The listing walks items and groups visible runs by `item.id.client`.

## What was tried and changed

- **Three-way block alignment**, the design implied by the technology assessment: designed on paper, never built. The fork-at-base prototype made it unnecessary.
- **Harness relay that re-encoded deltas.** It restated the whole delete set, so a rebase's deletions reached replicas before its records. Replaced with forwarding each transaction's own update, as y-protocols and Hocuspocus do.
- **Delivery without causal order.** Yjs applies an update's delete set at once, even when the update's structs must wait for missing dependencies. With shuffled delivery, a chained rebase C that arrived before B deleted blocks before the integration step could see them. The harness now holds back any update that would leave structs pending. This caused all of the rebase-caused text loss the fuzz found (8 of 500 trials before the fix, 0 after).
- **Quote anchoring that accepted exact matches without context.** This produced 19 % mis-anchoring on targeted edits, partly because of measurement flaws that were also fixed. The revised rule is under design points.
- **Needs-review on plain text.** It missed mark-only upstream changes, as the reviewer showed. It now compares attributes and formatted deltas.
- **Diff granularity**, same seeds, all comments in the trials: CRDT-resolved comments 76.6 % at `word`, 76.2 % at `char`, 67.8 % at `block`, 71.0 % with y-prosemirror's own `updateYFragment`. Flag precision is 100 % for the first three and 93.7 % for `updateYFragment`. `word` is the default. `char` buys nothing measurable and interleaves concurrent inserts inside words.

## Design points the charter asked for

**Granularity.** Block-level alignment, then word-level text diff inside paired blocks. A paragraph rewritten below 0.5 word similarity is replaced as a whole, which kills CRDT anchors inside it. The quote fallback then recovers comments whose text survives. Concurrent inserts interleave at word boundaries, not inside words.

**Needs review.** A block needs review when it changed between the base and the rebase result, and also between the base and the replica's state just before the merge. "Changed" means node attributes or formatted text, marks included. The flag lives in a shared `review` map keyed by the block's item ID and converges like any other CRDT state. Clearing flags (human review) is not built.

**Comment anchor record.** Start and end `RelativePosition` (assoc 0 and -1), exact quote, 32-character prefix and suffix, character offsets. The fuzziness budget allows up to `min(64, ceil(0.25 × quote length))` errors and needs quote similarity of at least 0.75. A candidate is accepted only if prefix or suffix similarity is at least 0.5, or if the quote is at least 24 characters and occurs once. It is rejected as ambiguous if another location scores within 8 points (on a scale of quote 50, prefix 20, suffix 20, position 2). If no candidate is accepted, a context-only match tries both 16-character context halves found close together, and anchors to whatever now sits between them. Otherwise the comment is orphaned with its quote kept. Comments spanning two blocks always take the fuzzy path; that case is untested beyond the corpus.

**Where the rebase runs.** On any replica that holds `S_A`, including one with unsynced edits. Two replicas running the same rebase produce identical bytes, and Yjs dedupes them (verified in 103 fuzz trials). Rebases to *different* targets from the same base must not run concurrently. They merge into a blend of both targets, and the base pointer resolves last-writer-wins to one of them. `baseConflicts(doc)` detects this. Recovery is a re-seed from the real branch head under D1. So: serialize rebases per document on the relay, allow idempotent retries from anywhere.

**Transport requirement (new).** Updates must arrive whole and in causal order, which y-protocols over one ordered connection guarantees. A custom relay must not re-encode or reorder updates.

## Yjs versus Loro (gate I)

- **The rebase itself is not simpler on Loro.** The same algorithm needs `forkAt(frontiers)` in place of `createDocFromSnapshot`. Core code is about the same size (915 against 896 lines). Loro's replica harness is smaller (205 against 355 lines), but the difference is mostly the relay workaround described above.
- **Loro is better at attribution and history.** `LoroText.getEditorOf(pos)` gives per-character authorship as public API; Yjs needs an item walk. Frontiers are plain JSON, and `import()` reports pending dependencies directly.
- **Loro is worse at the binding and on size.**
  - `loro-prosemirror` 0.4.4 exports no container builders, so 131 lines were reimplemented from its source.
  - `LoroText.mark` throws until `configTextStyle` is called.
  - The `.d.ts` declares `length` as a method, but at runtime it is a getter.
  - The live `LoroSyncPlugin` loses root `doc` attributes, then deletes them from Loro on the next edit.
  - Snapshots are 1.9 times the Yjs size (24.5 KB against 12.8 KB for an 8.4 KB Markdown file).
- **Correctness is the same.** Both converge, both need resurrection, and both lose text in the human-versus-human delete-versus-edit case.
- **Switching cost:** the binding, the server (there is no Hocuspocus equivalent) and all doc-model code. That is not justified by this spike.

## Editor-binding fidelity (lead's request)

| Binding | Root `doc` attributes | Marks on atom nodes (link around image) |
|---|---|---|
| y-prosemirror 1.3.7, all three paths: convert, `updateYFragment`, live `ySyncPlugin` | lost | lost |
| loro-prosemirror 0.4.4, headless | kept | lost |
| loro-prosemirror 0.4.4, live plugin | lost, then deleted from the Loro doc on the next edit | lost |
| Yjs 14 RC: `@y/y` 14.0.0-rc.26 with `@y/prosemirror` 2.0.0-13, headless and live | kept | kept |

Remedies, cheapest first:

1. **Schema change for root attributes.** Keep them in a sibling `Y.Map`, as this spike already does for its own metadata. Small.
2. **Atom-node marks.** Either a localized upstream patch in y-prosemirror's `createTypeFromElementNode` and `createNodeFromYElement`, or a schema change that makes the link an attribute of the image node. Medium. Carries a wire-compatibility caveat for existing documents.
3. **Maintained fork of y-prosemirror.** Not recommended, since Yjs 14 already fixes both losses.
4. **Move to Yjs 14 with `@y/prosemirror` when it is stable.** Fixes both. The API differs (one `Y.Node` type), and the RC is a moving target. Details and tests are in `spikes/2026-09-27-crdt-rebase-binding-probe/`.

## Decisions

Made by the spike 2 orchestrator, for the lead to transfer to the register.

| # | Decision | Impact | Difficulty to reverse |
|---|---|---|---|
| S2-1 | Rebase is fork-at-base-version, then a two-way diff, then a CRDT merge. No three-way alignment code. | high | moderate |
| S2-2 | Seed and rebase peer IDs are deterministic hashes of document, base and target, so rebases are idempotent and may be retried on any replica. | high | easy |
| S2-3 | Rebases are serialized per document on the relay; sibling rebases are detected (`baseConflicts`) and recovered by re-seeding. | medium | easy |
| S2-4 | Session documents use `gc: false`. D1's re-seed bounds growth, and snapshots need tombstones. | medium | easy |
| S2-5 | Default diff granularity is word level inside block alignment. Character level adds nothing measurable. | medium | easy |
| S2-6 | Needs-review is the intersection of upstream-changed and locally-changed blocks, where a change includes marks and attributes. Every replica computes it at integration and stores it as idempotent flags in a shared map. | medium | moderate |
| S2-7 | A block deleted upstream but edited locally is resurrected by the author of the edits, once, and flagged. | medium | moderate |
| S2-8 | Transport requirement: updates are forwarded whole and delivered causally, as in y-protocols. No re-encoding relays. | high | easy |
| S2-9 | Comment anchor record and acceptance rule as under design points. Mis-anchoring is treated as worse than orphaning. | medium | easy |
| S2-10 | Human-versus-human delete-versus-edit loss is accepted as standard CRDT behaviour for now; it is reported, not gated. | medium | hard to fix: needs delete-intent metadata |
| S2-11 | Base and rebase records are keyed by commit hash. Known flaw: rebasing back to an earlier commit reuses a key. Production should key by hash(base, target). | low | easy |

## Open risks

- **Binding losses on Yjs 13** (above) affect real files: spike 1 reports 134 of 294.
- **Structural local edits.** A y-prosemirror paragraph split moves the tail into a new element, so upstream edits to the tail would target deleted items. The fuzz found no `upstream-change-lost` in 1,100 trials. That check was built by a builder and not independently verified, so treat it as weak evidence.
- **Human-versus-human delete-versus-edit** loses text in 7.6 % of fuzz trials, which is a pessimistic rate because the fuzz deletes blocks often. Fixing it needs delete intents or a tombstone-review UI, not CRDT changes.
- **Cost of integration.** It takes a Yjs snapshot before every remote batch and scans all textblocks once per new rebase record. The harness's causal hold-back probes each update on a cloned document. Fine at spike scale; unmeasured on large documents.
- **Scenarios not measured:**
  - Multi-block comments.
  - Tables: the schema has none, so tables collapse into a paragraph, and that is where the residual mis-anchoring sits.
  - Clearing review flags.
  - Server-only rebase with Hocuspocus.
- **Loro chained-rebase base pointer.** Loro writes the base pointer after the frontiers it records, so chained rebases rely on last-writer-wins for the `base` key. Untested.

## Recommendation

- **D5: confirm Yjs, amended.** Plan for Yjs 14 and `@y/prosemirror` because of the binding fixes. Until then, work around root attributes with a sibling map, and atom-node marks with a schema change or a small y-prosemirror patch. Loro stays the named fallback, and nothing here argues for switching.
- **D6: confirm, amended.**
  - The rebase is fork-at-base plus a two-way diff, idempotent, and serialized per document.
  - Needs-review and resurrection run at integration on each replica.
  - The transport must be causal and must forward whole updates.
  - The quote-selector rule above becomes part of D3.
