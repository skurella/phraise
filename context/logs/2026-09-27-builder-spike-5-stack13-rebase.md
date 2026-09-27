# Log: builder, spike 5, stack 13 rebase (gate F)

Status: in-progress
Author: builder (Sonnet 5)
Updated: 2026-09-27
Plan: [spike 5 plan](../plans/2026-09-27-spike-5-plan.md)
Brief: [brief 05](../plans/2026-09-27-spike-5-brief-05-stack13-rebase.md)

Time zone: local machine time (CEST), from `date`.

## 11:43 — task received, read AGENTS.md, brief 05, plan, charter
## 11:50 — task 1 done: ported spike 2 into src/rebase/

Copied spike 2's src/{schema,ids,text,markdown,diff,seed,rebase,integrate,comments,replica}.ts
and src/gates/{scenario,gate-a-c,gate-b,gate-d,gate-d2,gate-idempotent,convergence,types}.ts
(origin: branch spike/2026-09-27-crdt-rebase, commit 88bd85c) into this package's
src/rebase/ and src/rebase/gates/, from the scratchpad ref checkout.

Only two files needed a change (per the brief's own schema/converter instruction --
everything else is verbatim): src/rebase/seed.ts and src/rebase/diff.ts each imported
`y-prosemirror`; retargeted both to `@tiptap/y-tiptap` (this package's existing binding
choice, confirmed to re-export prosemirrorToYXmlFragment/yXmlFragmentToProseMirrorRootNode/
updateYFragment with identical names/signatures -- checked directly against
node_modules/@tiptap/y-tiptap's exports before relying on it).

Added 3 runtime deps spike 2's code needs that this package didn't have:
markdown-it@^14.1.0, prosemirror-markdown@^1.13.1, approx-string-match@^2.0.0, plus
@types/markdown-it as a devDependency (prosemirror-markdown ships its own types;
approx-string-match ships build/src/index.d.ts next to its "main" entry with no
"types" field in package.json, which TS's classic resolution still finds -- confirmed
tsc sees it with no shim needed).

`npx tsc --noEmit`: clean.

Wrote scripts/rebase-baseline.ts (not part of `npm run gates`): runs spike 2's own
gates A/B/C/D + D2 + idempotent (its own lettering, distinct from stack 13's gate
A-G table) headlessly via the copied src/rebase/replica.ts in-memory harness. All
six pass, matching spike 2's own results:
- A (untouched-paragraph comment resolves via crdt): PASS
- B (word/char via crdt, block via fuzzy): PASS
- C (deleted-paragraph comment orphans, negative control holds): PASS
- D (6 permutations + 50 shuffles all converge): PASS
- D2 (resurrection of deleted-but-locally-edited block): PASS
- idempotent (byte-identical rebase update from two replicas, no duplication on reapply): PASS

Task 1 done. Moving to task 2 (relay: rebase: seeding, gc off, rebase route,
relay-side integration).
