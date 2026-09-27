# Builder log: spike 1 core (markdown schema, parse, serialize)

Status: done
Author: builder (Sonnet 5)
Updated: 2026-09-27
Plan: [spike 1 brief 02](../plans/2026-09-27-spike-1-brief-02-core.md)

Timezone: local machine time (CEST, Europe, UTC+2), from `date`.

## 03:26 — Task received

Read AGENTS.md and brief 02. Ran `node scripts/fetch-corpus.mjs` in the spike dir; corpus already present (266/266 skipped, 655 CommonMark + 672 GFM examples). Starting scaffolding per brief layout under `spikes/2026-09-27-markdown-core-remark-splice/`.

## 03:30 — Scaffolding, exploration

Wrote `package.json` (npm, tsx, prosemirror-model/state/transform, unified+remark stack, mdast-util-to-markdown + gfm/frontmatter/math extensions), `tsconfig.json` (strict, NodeNext). `npm install` clean, Node v22.12.0 confirmed.

Explored mdast shapes with throwaway scripts (deleted before commit) to ground the schema/parse design in what remark actually produces, rather than assuming: heading position strips leading indentation and, for setext, spans both the text line(s) and the underline; `thematicBreak`/`break` raw slices are exactly the hint text needed; fenced code `value` already has CommonMark's indent-stripping applied; `definition`/`footnoteDefinition` have no `.value`; inline `html`/`inlineMath`/`footnoteReference` need source slices since mdast doesn't reproduce their exact text; GFM literal autolinks and CommonMark autolinks are both plain `link` mdast nodes distinguished only by looking at the raw source's first character.

## 03:35 — Wrote schema.ts, parse.ts, compare.ts, style.ts, serialize.ts, index.ts

Implemented per the brief's design: verbatim/splice/re-serialize candidate chain, isolation `parseBlock` with definitions context, splice text-run map via greedy alignment, style majority-vote detection. `npx tsc --noEmit` clean after two rounds of type fixes (Processor generic mismatch worked around with `any`; `Fragment.findDiffEnd` nullable return handled explicitly).

Initial smoke: all 28 handwritten corpus files round-tripped byte-identically on the first try, all via the verbatim path. Encouraging, but the harder test is the fetched real-world + spec corpus.

## 03:40 — Corpus smoke, found and fixed three real bugs

First pass on 50 real + 200 CommonMark: 41/50 real, 197/200 CommonMark. Diagnosed each:

1. **Leading-indentation "hug" (the big one).** mdast `position.start` for any block begins at the construct's first significant character (`#`, backtick, `-`), never at same-line leading spaces. My original split left that indentation in the *previous* block's `gap` (or in `lead` for the first block). That's fine for byte reconstruction, but it breaks the *isolation* re-parse: list nesting depth and fenced-code content indent-stripping are both column-relative, so re-parsing a block's `src` alone with its first line's indentation stripped can parse to a *different* structure than the same text had in the full document (e.g. a flat top-level list whose items are all indented 3 spaces gets its first item's indentation dropped in isolation, making CommonMark treat the following same-indented items as a nested sublist instead of siblings). Fixed by "hugging" any pure-whitespace same-line prefix into the block's own `src` instead of the neighboring gap/lead. This alone fixed 7 of the 9 real-file failures and both fenced-code CommonMark failures (0131-0133, 1-space-indented fence content).
2. **Duplicate mark type.** PM disallows two marks of the same type on a node (`Mark.sameSet`/`check()` throws "Invalid collection of marks"), but CommonMark permits doubly-nested identical emphasis (`*a *b* c*` etc). Fixed by collapsing to the outer mark instance when a mark of that type is already open (`addMark` helper). Documented as a content-fidelity trade-off in the README; round-trip stays consistent since parse and isolation-reparse apply the same rule.
3. **Missing null guard.** `linkKind()` read `node.position.start` without checking `node.position` first; some link nodes (rare) lack position. Guarded, defaults to `'inline'`.

Re-ran: 49/50 real, 200/200 CommonMark.

## 03:45 — Full corpus run, two more fixes

Ran all 266 real + all 655 CommonMark + all 672 GFM examples (not just samples), to get real numbers for the handback rather than guessing from a sample:

- 265/266 real, 652/655 CommonMark, 669/672 GFM on the first full pass.
- Fixed: **empty blockquote** (`>` alone parses to an mdast blockquote with zero children; schema requires `block+`) — filled with an empty-paragraph placeholder, same pattern already used for empty list items.
- Fixed: **overlapping top-level spans.** A link/footnote definition immediately followed, with no blank line, by a setext-heading-eligible paragraph (CommonMark spec examples 0217/0241-ish family) is a case where mdast reports the *heading's* `position.start` starting before the *definition's* `position.end` — the two top-level nodes genuinely overlap in mdast's own position data (verified directly on the raw mdast tree, not just our conversion). Fixed by clamping each block's start to the previous block's end, so spans/gaps never go negative or overlap.
- After both fixes: **655/655 CommonMark, 672/672 GFM, 265/266 real.**

## 03:48 — Diagnosed the one remaining real-file failure

`kubernetes-enhancements-kepssignode2837podlevelresourcespecr.md`: a list nested 3 levels deep, whose last (deepest) list item ends with a paragraph immediately followed (no blank line) by a bare `<br>` line, at end-of-file. Compared the raw mdast trees directly (before any of our conversion runs): parsing the *full document* attaches `<br>` as a nested `html` sibling inside the deepest `listItem`; parsing the *identical substring in isolation* drops it — the isolated tree has one fewer node. This is a genuine remark/micromark parser-statefulness divergence between full-document and standalone parsing of the same text, not a bug in this code's conversion or splitting logic. It makes verbatim+splice (correctly, conservatively) fall back to re-serialize, which doesn't reproduce the file's non-canonical multi-level list indentation. Affects 1 of 1593 corpus files tested. Not fixed — outside what "isolation re-parsing must reproduce the same structure" can guarantee, and not worth chasing further within budget. Documented in README.md.

## 03:50 — Wrote the test suite

`test/roundtrip.test.ts` (handwritten corpus + all-verbatim assertion; corpus smoke for first 50 real + first 200 CommonMark, per the brief's exact DoD wording), `test/edit.test.ts` (single-word edit via `EditorState...tr.insertText` for the six named fixtures, asserting exact replacement and splice-path use; structural edit toggling `strong` in a list item, asserting semantic re-parse equality and that only one top-level block's byte range changed), `test/style.test.ts` (`detectStyle` per style-*.md file, forced-reserialize convention test from the brief).

First run: 7/9 pass. Two failures diagnosed and fixed:
- `style-plus-bullets.md` closeAtx: file has one closed and one unclosed ATX heading (genuine 1-1 tie); changed the tie-break to favor the marked/non-default variant, matching the same reasoning already used for the setext tie-break (an even split signals the file deliberately uses the convention rather than lacking it).
- The known kubernetes corpus-smoke failure above: left failing, per "be honest about failures... rather than weakening tests" — the assertion clearly names the failing file and reason rather than being loosened to exclude it.

Final: **8/9 tests pass** (1 known, diagnosed, documented failure).

## 03:54 — Cleanup and handback

Deleted scratch/ (throwaway exploration scripts, never intended for commit). Wrote README.md covering goal, layout, test results, deviations, and what remark positions could not provide. Committing now.
