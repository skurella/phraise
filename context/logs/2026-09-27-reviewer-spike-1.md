# Reviewer log: spike 1 fresh-context review

Status: in progress
Author: reviewer (Sonnet 5, fresh context)
Updated: 2026-09-27
Plan: [brief 05](../plans/2026-09-27-spike-1-brief-05-review.md)

Timezone: local machine time, Europe/Warsaw-ish (system clock), stated as printed by `date`.

## 06:01 — task received

Read AGENTS.md, brief 05, the charter (context/plans/2026-09-27-spike-1-charter-markdown-round-trip.md), D4 in architecture-decisions.md. Starting review of spikes/2026-09-27-markdown-core-remark-splice/.

README already self-reports two known gate-B failure categories (blockquote lazy-continuation merge; list renumbering spreads diff) and one gate-A real-world failure (nested list trailing `<br>` isolation re-parse mismatch), plus two y-prosemirror (gate A3) limitations. Noted as prior art before independent adversarial testing.

## 06:15 — code read: schema.ts, compare.ts, serialize.ts, parse.ts (self-description check), gateB.ts, gateE.ts, style.ts

Read `src/schema.ts` (`isMetaAttrName`: src, gap, refType, leafMarks, `*Hint` are meta/ignored by `semanticEq`), `src/compare.ts` (`semanticEq`), `src/serialize.ts` (splice ladder + the unverified fallback), `src/parse.ts` (self-description/opaque-block check, `buildDefsContextFromDoc`), `gates/gateB.ts` + `gates/lib/words.ts` (word-edit selection), `gates/gateE.ts` + `src/style.ts` (convention detection).

Verified sound:
- `refType` marked meta is correct: it only encodes reference-link syntax form (full/collapsed/shortcut); `identifier`/`label`/`href`/`title` are semantic and do get compared, so a definition retarget is still caught.
- Gate B's own pass/fail (`semanticOk`) independently re-parses the *entire serialized output* and compares every top-level child against the edited doc with `semanticEq` — it does not trust the serializer's own `trace.kind`. So a serializer that silently ignored the edit, or emitted wrong content via the "unverified" fallback, would be caught as `semantic-mismatch`, not scored `ok`. Gate B's methodology is sound.
- The opaque-block ("unstable:") mechanism (`src/parse.ts` ~L765-790) is transparent and rare: gates.md reports exactly 1 unstable top-level block across the entire corpus (1621 files' worth of blocks) — it is not hiding a systemic problem behind the opaque bucket.
- `corpus/manifest.json`/`specs.json` (committed) contain only repo/sha/license/url/bytes/sha256 metadata, no third-party file content; `corpus/fetched/` is gitignored. Gate C's "do not commit third-party files" rule is honored.
- `npm test` (20/20 pass) and `npm run gates -- --quick` (all gates pass, ~55s) both ran clean from the existing checkout; corpus already fetched. Reproducibility looks sound. (I accidentally overwrote `results/gates.md`/`.json` with the --quick numbers when running this; restored both with `git checkout --` immediately after — verified `git status` clean on that path afterward.)

## 06:35 — adversarial edits (own script: `spikes/2026-09-27-markdown-core-remark-splice/review/adversarial.ts`)

Six hand-written cases per the brief's list (word next to escaped char, word in a table cell, word at start of a list-item continuation line, word in a CRLF file, word in a heading inside a blockquote, plus a raw-html-with-blank-lines case) all passed: `splice`/`textblock-splice` path chosen, `semanticOk` true, diff contained to the single expected source line in every case. A seventh probe (replacement text containing markdown-special characters `a*b_c[d]e`, which gate B's fixed 'zebra'/'quokka' vocabulary never inserts) also passed and correctly escaped (`a\*b\_c\[d\]e`) — confirms `escapeMarkdownText` works, but flags that gate B's numbers never actually exercise that code path (see minor finding below).

## 06:45 — confirmed the concrete gate-B failure behind "unverified" (10 edits, all sets)

`npx tsx tools/debug-edit.ts commonmark/0039:1` reproduces it directly. Input file `corpus/fetched/commonmark/0039.md` is the literal bytes `foo&#10;&#10;bar\n` (a CommonMark spec example for numeric character-reference decoding: the two `&#10;` are *text content* inside one paragraph, not block separators). Editing word "foo" -> "zebra": serializer trace is `unverified`, output is `"zebra\n\nbar\n"` — the decoded literal newlines get re-emitted as real newlines, which `mdast-util-to-markdown`/re-parse reads back as a paragraph break, silently splitting one paragraph into what looks like a blank-line gap. This is exactly the `serializeDoc` "unverified" fallback (`src/serialize.ts` L759-768: `reserializeBlock` is *always* returned even when its own verification (`semanticEq` against the edited block) fails — there is no further fallback, e.g. to the original verbatim `src` with the edit simply not applied, or to surfacing an error). Confirmed by reading the code: the `trace?.({kind: verified ? 're-serialize' : 'unverified', ...})` call sets the trace label but does not gate the `return result;` on the next line.

## 06:55 — gate E vacuous-pass mechanism (own scripts: `review/gate-e-vacuous.ts`, `review/gate-e-vacuous-corpus.ts`)

`gates/gateE.ts`'s `isNonDefault()` (which decides whether a file counts toward the ">=10 files" threshold) checks *all* of `Style`'s fields: bullet, bulletOrdered, emphasis, strong, fence, fenceLen, headingStyle1, headingStyle2, setext, closeAtx, rule, ruleRepetition, listItemIndent, eol. But `conventionsMatch()` (which decides pass/fail) only ever actually re-verifies bullet, emphasis, fence, setext+closeAtx (as one combined "heading" check), rule+ruleRepetition, and eol -- it never checks `strong`, `bulletOrdered`, `fenceLen`, `headingStyle1`/`headingStyle2` individually, or `listItemIndent`. Built three synthetic one-convention-off fixtures (`__bold__`-only-non-default, `1)`-ordered-delimiter-only, tab-indented-list-continuation-only): all three are counted `isNonDefault: true` and score `pass: true`, with `checkedConventions` either empty or `['eol']` only (eol trivially matches since these are LF files) -- i.e. a **vacuous pass**: the file counts toward the ">=10" threshold and "passes" without the actual differing convention ever being checked. Ran the same query over the real corpus (`review/gate-e-vacuous-corpus.ts`, `loadCorpus(false)` + `corpusFiles`): of the 149 non-default/passing files gates.md reports, **0** are vacuous in the current corpus -- every one of the 149 also has at least one of the actually-checked conventions (bullet/emphasis/fence/heading/rule) as its non-default field, so today's reported number is not inflated. But the check's soundness is coincidental to this corpus's composition, not structural: a corpus with more files whose only stylistic quirk is e.g. an unusual list-item indent or `1)`-style ordered lists would inflate the ">=10" count without verifying anything.

## Findings (by severity)

### Major
1. **Silent unverified fallback in `serializeDoc` (`src/serialize.ts` L759-768).** When every splice candidate fails and the last-resort re-serialize also fails its own semantic verification, the code still returns that (wrong) text -- there is no fallback to leaving the block untouched (verbatim `src`) or surfacing an error to the caller. Repro: `npx tsx tools/debug-edit.ts commonmark/0039:1` from the spike root -- edits word "foo" in the literal file `foo&#10;&#10;bar\n`, produces `"zebra\n\nbar\n"`, silently turning one paragraph into what re-parses as two. Gate B's own harness *does* catch this (it independently re-parses the whole output and compares against the edited doc, so it's scored `semantic-mismatch`, not `ok` — see gates.md's 10 unverified/semantic-mismatch failures, all commonmark-set, correctly excluded from the real+handwritten threshold). But in the product (not the gate harness) this path has no such independent check: a real edit that happens to hit this fallback would silently corrupt the user's file with no error and no guardrail. Recommend the design (not just this spike) define a hard floor for the "every candidate fails" case: e.g. fail the edit / reject the transaction rather than write unverified text.
2. **Gate E's ">=10 non-default files pass" threshold can be satisfied vacuously.** `isNonDefault()` and `conventionsMatch()` check different, only partially-overlapping sets of `Style` fields (see 06:55 entry above); a file whose only non-default convention is `strong`, `bulletOrdered`, `fenceLen`, `headingStyle1`/`headingStyle2`, or `listItemIndent` counts toward the threshold and scores `pass: true` without that convention ever being verified against the forced re-serialization. Repro: `npx tsx review/gate-e-vacuous.ts` (three synthetic one-field fixtures, all vacuous). Empirically, none of the current 149 non-default/passing corpus files are vacuous in this way (`npx tsx review/gate-e-vacuous-corpus.ts`), so the reported number is not currently misleading, but the check itself does not structurally guarantee that.

### Minor
3. **Gate B's fixed replacement vocabulary (`'zebra'`/`'quokka'`, `gates/lib/words.ts` `replacementFor`) never inserts a markdown-special character**, so `tryTextSplice`'s `escapeMarkdownText` path is never exercised by any of the reported gate-B numbers. Manually verified it does work correctly (`review/adversarial.ts`'s last case: inserting `a*b_c[d]e` produces a correctly-escaped, round-trippable splice) -- this is a test-coverage gap in the gate's own numbers, not a bug I could find.
4. **README's "Findings from the first full run" section names two gate-B failure categories (blockquote lazy-continuation merge, list renumbering) but not the third, which is actually the one behind all 10 `unverified`/`semantic-mismatch` failures in gates.md** (decoded numeric character references, e.g. `&#10;`, producing literal control characters inside paragraph text that re-serialization turns into real block separators -- see the commonmark/0039 repro above). The builder log (`context/logs/2026-09-27-builder-spike-1-structural.md` ~L242) mentions a related-but-different entity issue (`&nbsp;` decoding to a literal char in gate E's byte-identity metric, explicitly deprioritized) which is not the same failure mode and doesn't cover the paragraph-splitting case. Worth a corrected/expanded README findings note so the lead doesn't under-rate this failure category's severity relative to the other two.
5. Gate B's word selection (`findEligibleWords`) only picks words from `paragraph` nodes; `heading` and `table_cell` textblocks (both explicitly supported by `tryTextblockSplice` per the README) are never exercised by the official gate-B numbers, only by tests/hand-checks. My own adversarial heading-in-blockquote and table-cell cases (above) both passed, so no bug found, but the 98%/100% gate-B numbers say nothing quantitative about heading/table-cell edits specifically.

### Nothing found wrong with
- `semanticEq`'s choice of meta vs. semantic attrs (`isMetaAttrName`): `refType` is correctly meta (syntax form only); `identifier`/`label`/`href`/`url`/`title` are semantic and are compared, so definition-target or link-text changes are caught.
- The opaque-block ("unstable:") escape hatch: rare (1 block across the whole corpus), transparent, counted.
- Corpus/manifest hygiene: no third-party content committed; `corpus/fetched/` gitignored.
- `npm test` and `npm run gates -- --quick` both reproduce cleanly from this checkout.

## Handback

Findings above. Log complete; committing this file and `spikes/2026-09-27-markdown-core-remark-splice/review/*.ts` next.
