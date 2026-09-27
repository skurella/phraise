# Brief 09: milestone 2 fixes — the commit window, editor tracking, mark nesting

Status: dispatched
Author: spike 6 orchestrator (Opus 5.5)
Updated: 2026-09-27
Plan: [spike 6 plan](2026-09-27-spike-6-plan.md), sections 3 to 6.
Charter: [spike 6 charter](2026-09-27-spike-6-charter-integration-engine.md), "Rules for every agent in this spike" binds you.
Review: [milestone 2 review log](../logs/2026-09-27-reviewer-spike-6-m2.md), the blocker.

## Goal

Fix three defects before milestone 3 builds on them. Each fix starts with a test that fails.

## Defect 1: edits during a commit's push are baked into the base (blocker)

`src/relay/commit.ts` runs `prepareCommit` (render plus snapshot), awaits the git push, then `recordCommit`, which takes a **fresh** snapshot after writing `base`, `lastCommit` and clearing `editorsSinceCommit`. An edit that lands during the push becomes part of the stored base snapshot although the commit does not contain it: its author loses co-author credit, and a later rebase of that block drops the edit without a flag. The fresh snapshot was introduced to fix a real bug: a rebase fork taken at the prepare-time snapshot sees the old `base` entry, overwrites it on the fork, and that write is concurrent with `recordCommit`'s `base` write, so map last-writer-wins reverted the rebase's base about half the time.

Required design, decided by the orchestrator:

- `src/crdt`: `transactExtendingSnapshot(doc, baseSnapshot, fn, origin) -> CrdtSnapshot`: run `fn` in one transaction and return `baseSnapshot` extended by exactly that transaction's inserted structs (the relay's own client id clock range) and deleted items (from the transaction's delete set), so the result contains the meta writes and nothing else that happened after `baseSnapshot`. Unit-test it: an edit by another client between the base snapshot and the transaction is not visible in a fork at the result; the meta writes are.
- `recordCommit(doc, {commit, snapshot: prepared.snapshot, preparedSeq})` writes `base`, `lastCommit`, removes only the editor marks made before prepare (below), and stores `snapshot:<commit>` = the extended snapshot. Content in the stored snapshot equals exactly the committed content.
- **Editor marks with a commit sequence.** Replace the boolean `editorsSinceCommit:<user>` with a sequence number: `phraise.commitSeq` (integer, incremented by `prepareCommit`, which returns `preparedSeq` = the value before incrementing). `markEditor(doc, user)` writes `editorsSinceCommit:<user> = commitSeq` **only if** the key is absent or holds a smaller value, so a user costs at most one map write per commit cycle plus one if they edit during a commit window. `recordCommit` deletes only keys whose value is `<= preparedSeq`.
- **Cheap content detection on the relay.** Replace the relay's per-update whole-document `contentKey` comparison with a crdt function that tells, from a transaction, whether it changed the `prosemirror` fragment or anything under it (walk each changed type's parent chain to the root; no document serialization). Expose it as `crdt.onContentChange(doc, (origin) => ...)` or as a predicate the relay's `onChange` can call; pick whichever fits Hocuspocus' hook and say which.
- Test at the relay level: an option `testHooks.afterPrepareCommit` (awaited between prepare and push) lets a test make bob edit during the push. After the commit: the commit's blob does not contain bob's edit; bob is still in `editorsSinceCommit`; an external commit then changes bob's block: bob's edit survives and the block is flagged; the next commit contains bob's edit and credits bob. Also rerun the earlier tie-break scenario (commit, then an immediate rebase) 50 times: the base pointer is always the rebase target.

## Defect 2: numeric character reference from mark nesting order (gate H)

`gates/h.ts` counts concurrent-formatting cases with a mark boundary on a space and finds 2 in 78 outputs containing `&#x20;`. Example: text `quux baz quux qu` + `ux`, strong over ` quux qu` and em over `quux`; output `quux baz _**quux**_**&#x20;qu**ux`. Cause: the PM-to-mdast conversion nests marks in schema order (em outside strong) even where strong spans further, so strong is split and its second part starts with a space. Fix the nesting: when opening marks at a position, nest the mark whose run extends furthest as the outermost. Then remove the space-boundary skip from `test/serializer-fixes.test.ts` and make the unit test and gate H's check both require zero references across at least 500 seeded cases in the unit test (with boundaries on spaces included), and keep gate H's separate counts. Update the residual note in `src/markdown/README.md`: remove it if fixed, otherwise state exactly what remains.

## Defect 3: relay attribution map growth per update

`recordAttribution` appends one entry per incoming update. Measure the document's encoded size after 2,000 single-character updates from one user with and without it, and coalesce: extend the user's last range when the new range is contiguous in the same client (same client id, `from` equal to the previous `to`) within a time bucket (default 5 s), instead of appending. Keep `listAttribution` output unchanged in meaning. Report both sizes in your log.

## Tasks, in order. Stop when task 5 is done.

1. Failing tests for defects 1, 2, 3 (for 3, a test asserting the coalesced size bound). Run them and record that they fail.
2. Fix defect 1.
3. Fix defect 2.
4. Fix defect 3.
5. `npm test`, `npm run typecheck`, `npm run gates:quick` all pass (A to H). Update module READMEs. Do not run the full `npm run gates`.

## Constraints

- Only add new files, except files inside the spike package created by earlier briefs.
- Log: `context/logs/2026-09-27-builder-spike-6-fixes-m2.md`. Do not commit.
- Ports 4300 to 4399; stop every server; check `lsof -nP -iTCP:4300-4399 -sTCP:LISTEN` before handing back.
- Bash refuses commands that mention `git` inside pipes, loops, `cd &&` chains or heredocs; run git commands as single plain commands. Prefer the Write tool for files.
- Never weaken a check silently.
- Handback under 300 words.
