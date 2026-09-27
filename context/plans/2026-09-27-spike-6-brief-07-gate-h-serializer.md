# Brief 07: gate H — serializer and parser fixes

Status: dispatched
Author: spike 6 orchestrator (Opus 5.5)
Updated: 2026-09-27
Plan: [spike 6 plan](2026-09-27-spike-6-plan.md), sections 1 to 4 and 9.
Charter: [spike 6 charter](2026-09-27-spike-6-charter-integration-engine.md): "Milestone 2" gate H, and "Rules for every agent in this spike", which binds you.

## Goal

Make the integrated Markdown model meet D4 as amended after spikes 1 and 3: a save never fails and never silently changes meaning (best effort plus a flag on the block), serialization composes across block boundaries, concurrent formatting never produces numeric character references, the footnote-continuation parser bug is fixed, the parse cache persists across calls, and spike 1's gates A and B still pass on the full corpus with the integrated schema.

## Inputs to read

- `AGENTS.md`, this brief, the charter's gate H row.
- `git show origin/spike/2026-09-27-daemon-file-sync:context/docs/2026-09-27-spike-3-findings-daemon-file-sync.md`, sections "Gate results" (row F and I), "What spikes 1 and 2 need to change". `git show origin/spike/2026-09-27-markdown-round-trip:context/docs/2026-09-27-spike-1-findings-markdown-round-trip.md`, sections "Gate results" and "Approach and why".
- The package: `src/markdown/` (all), `src/crdt/render.ts`, `src/engine/integrate.ts` (review map), `src/engine/commit.ts`.
- Under `$REF` (plan section 1): spike 1's `gates/gateA.ts`, `gateB.ts`, `gates/lib/`; spike 3's `gates/f-roundtrip.ts`, `results/f-roundtrip.json` (the two failing cases), `fixtures/half-typed.json`, `gates/fuzz.ts` (how the entity escapes were counted).

## Tasks, in order. Stop when task 7 is done.

1. **Reproduce first.** Write failing unit tests for: (a) the footnote-continuation bug, from spike 3's two gate F failures (find their inputs in `results/f-roundtrip.json` or regenerate them from `f-roundtrip.ts` and `half-typed.json`); (b) numeric character references produced by concurrent formatting: build ProseMirror docs where an emphasis or strong mark starts or ends inside a word or next to whitespace inside the mark, as a merge of two users' concurrent bold and italic toggles produces, and assert the serialized output contains no `&#` sequence that was not in the source; (c) a block no candidate verifies (spike 1's examples: a reference link whose definition was deleted; `foo&#10;&#10;bar` edited) must serialize as best effort, report the block, and never throw; (d) composition: appending a block after a last block without trailing blank line, and an unclosed fence that is no longer last.
2. **Fix the parser bug** at its cause in `parseBlock`'s isolation re-parse (not by special-casing the test input).
3. **Fix numeric character references.** Preferred approach: normalize inline marks before serialization so that no mark starts or ends with whitespace (move the whitespace outside the mark; formatting whitespace has no meaning in Markdown), and prefer `*` over `_` delimiters for intraword emphasis, before falling back to anything that writes an entity. If you pick another approach, justify it in the module README. The document's text must be unchanged; only mark boundaries over whitespace may move.
4. **Degrade plus flag.** `crdt.render` already returns degraded block indices. Add `engine.renderForSave(doc) -> {text, degraded}` that also writes a review flag with reason `serialization-best-effort` on each degraded block (keyed like other review flags), and clears it when the block serializes cleanly again. Use it in the relay's draft flush and commit paths. Commit still succeeds with the best effort.
5. **Cache.** Confirm the parse cache persists across `parseMarkdown` and `serializeDoc` calls; add a unit test that a second serialization of an unchanged 240 KB corpus file (`corpus/fetched/real/nodejs-node-docapinapimd.md`, skipped with a message if not fetched) is at least five times faster than the first.
6. **Gate H** (`gates/h.ts`): (i) spike 1 gate A on every corpus file (fetched real plus handwritten), byte identical, plus A2 (ProseMirror JSON round trip) and A3b (through the crdt codec and a binary update); (ii) spike 1 gate B, five seeded one-word edits per file through ProseMirror transactions, output re-parses to the edited doc and every changed line lies inside the edited paragraph; thresholds as spike 1 (A 100 percent, B at least 98 percent of files; report exact numbers); (iii) the four fixes from task 1 as checks, plus a small randomized concurrent-formatting check (two replicas toggling bold and italic over overlapping word ranges, merged; at least 200 seeded cases; count outputs containing new `&#` references, must be 0); (iv) cache check. `--quick` samples 30 corpus files and 50 formatting cases. Add H to the runner.
7. `npm test`, `npm run typecheck`, `npm run gates:quick` pass (A to H). Do not run the full `npm run gates`. Update `src/markdown/README.md` with every change to code copied from spikes 1 and 3.

## Definition of done

Tests from task 1 fail before the fixes and pass after (say so in the log with the run output); `npm test`, typecheck and `gates:quick` pass.

## Constraints

- Only add new files, except files inside the spike package created by earlier briefs.
- Log: `context/logs/2026-09-27-builder-spike-6-serializer.md`. Do not commit.
- Ports 4300 to 4399 if any server is needed; stop it.
- Bash refuses commands that mention `git` inside pipes, loops, `cd &&` chains or heredocs; run git commands as single plain commands. Prefer the Write tool for files.
- Never weaken a check silently; report what does not meet its threshold.
- Handback under 300 words.
