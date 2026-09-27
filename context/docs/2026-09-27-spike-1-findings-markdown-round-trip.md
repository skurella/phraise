# Spike 1 findings: block-preserving Markdown round trip

Status: final for spike 1
Author: spike 1 orchestrator (Opus 5.5)
Updated: 2026-09-27
Charter: [spike 1 charter](../plans/2026-09-27-spike-1-charter-markdown-round-trip.md)
Code: [`spikes/2026-09-27-markdown-core-remark-splice/`](../../spikes/2026-09-27-markdown-core-remark-splice/README.md)
Results: [`results/gates.md`](../../spikes/2026-09-27-markdown-core-remark-splice/results/gates.md)
Log: [orchestrator log](../logs/2026-09-27-orchestrator-spike-1.md)

## Answer

D4 works. On 294 corpus files (266 real READMEs and design docs, 28 hand-written edge cases) an untouched file round-trips byte for byte, and a one-word edit made through a ProseMirror transaction changes only the edited paragraph's lines in every file, usually exactly one line. remark positions were enough; no CST parser is needed. Two things must change in how D4 and D5 are carried out, see the recommendation.

## Gate results

Full run from a clean checkout: `npm ci && npm run gates`, 6.5 minutes on the owner's laptop. Thresholds apply to the 294 corpus files; the 655 CommonMark and 672 GFM spec examples are stress tests.

| Gate | Threshold | Corpus files | Spec examples |
|---|---|---|---|
| A. No-edit round trip, byte identical | 100% | 294/294 | 1327/1327 |
| A2. Same after ProseMirror JSON round trip | 100% | 294/294 | 1327/1327 |
| A3. Same after plain y-prosemirror round trip | measured | 160/294 | 1313/1327 |
| A3b. Same through `src/yjs.ts` codec and a binary Yjs update | 100% | 294/294 | 1327/1327 |
| B. One-word edit: output re-parses to the edited doc and every changed line is inside the edited paragraph | 98% of files | 293/293 files, 1465/1465 edits (1 file has no eligible word) | 818/820 files, 4090/4100 edits |
| B, exactly one line changed | measured | 1464/1465 edits | 4100/4100 |
| B2. Bold toggle on the same words, same criteria | measured | 293/293 files, 1465/1465 edits | 805/820 files, 4049/4100 edits |
| C. Front matter, HTML, MDX, math, footnotes, definitions, Mermaid, fences, tables survive A and B | every file | pass for all 10 construct kinds; 37,837 checks of construct blocks outside the edited block, all byte-identical | |
| D. Real ProseMirror schema, `doc.check()` on every parsed and edited doc, edits are transactions | 100% | 1621/1621 parsed, 5565/5565 edited | |
| E. Forced re-serialization uses the file's own conventions | 10 files | 145 of 148 non-default files | |

B's word choice: five seeded words per file, any paragraph at any depth (lists, blockquotes), letters only, not in inline code, replaced by `zebra`. Containment is measured on the prefix/suffix line envelope, which is stricter than an LCS diff. Gate C's coverage is thin for front matter (2 files), math blocks (1), Mermaid (1), MDX (2) and footnotes (2); those rely mostly on hand-written fixtures.

## Approach and why

One approach was built; it passed, so no second approach was needed.

1. **Parse** with unified, remark-parse, remark-gfm, remark-frontmatter and remark-math. Convert mdast to a ProseMirror document. Each top-level block carries `src` (its exact bytes, including same-line leading indentation) and `gap` (the whitespace after it). The doc carries `lead` and `eol`.
2. **Self-description check at load.** Each top-level block must re-parse in isolation, with the document's link and footnote definitions prepended, to exactly one semantically equal node. Blocks that fail become opaque source blocks (`raw_block`, kind `unstable:<type>`). This makes gate A exact by construction; it happened to 1 block in 1621 files.
3. **Serialize** each top-level block with a verified candidate ladder. Every candidate must re-parse (in isolation, with the definitions context) to one block that is semantically equal to the current node:
   1. verbatim `src` (D4's write-time compare);
   2. **text splice**: ProseMirror `findDiffStart`/`findDiffEnd` between `parse(src)` and the node; if the change sits in one literal text run, map positions to source offsets and splice the new text in;
   3. **link splice**: if the change sits inside a link whose text is also syntax (a shortcut reference `[label]`, a bare URL), re-serialize only that link over its source span;
   4. **textblock splice**: re-serialize only the changed paragraph, heading or table cell, re-applying the container line prefixes (list indentation, `>`) to continuation lines;
   5. full re-serialization of the block with mdast-util-to-markdown in the file's style: per-node hints first (marker, fence, heading style, break style, link kind), then file conventions, then defaults.
   If no candidate verifies, `serializeDoc` throws `UnverifiedSerializationError` rather than write a file whose meaning differs from the document.
4. **Opaque blocks** hold their exact source as text: HTML blocks, front matter, math blocks, footnote definitions, link reference definitions, and any mdast type the converter does not know.

Word edits almost always take the text or link splice (5476 of 5565 edits); bold toggles take the textblock splice (4616) or the text or link splice (898). Full re-serialization is now rare in edits, but it is still the path for inserted blocks, pasted content and structural changes to lists.

## Tried, fixed, abandoned

- **Nested `src` on every block** (the literal reading of D4) was not built. Top-level `src` plus the splice ladder gives item-level precision in lists and cell-level precision in tables without more meta attributes in the CRDT.
- **Positions-only splicing** failed at first on 5 percent of files; causes and fixes: splice positions inside nested blocks resolved to the wrong node; text-run records were misattributed when remark text leaves merged into one ProseMirror text node; an LCS line diff blamed a correct change on a neighbouring identical line. All fixed and covered by tests.
- **Re-serializing the whole list** for a bold toggle rewrote every item (and renumbered `1. 1. 1.` lists). Replaced by the textblock splice; B2 went from 66.7 to 100 percent of corpus files on the quick subset.
- **mdast-util-to-markdown defaults** needed three fixes to verify reliably: bare URLs and inline HTML after a soft line break had the line break turned into a space (the library peeks at `<`), hard breaks were always written as backslashes, and marks were closed and reopened in schema order (`**bold _italic_**` became unparseable soup).

## Constructs: modeled versus opaque

| Modeled as ProseMirror nodes and marks | Opaque source blocks or atoms |
|---|---|
| paragraph, heading (ATX and setext), blockquote, bullet and ordered lists, task list items, fenced and indented code (including Mermaid, as `code_block` with its language), thematic break, GFM table with alignment | HTML blocks, YAML and TOML front matter, `$$` math blocks, footnote definitions, link reference definitions, any unknown block type, blocks that fail the self-description check |
| text, emphasis, strong, strikethrough, inline code, inline links, autolinks, bare-URL literals, reference links (identifier is semantic, reference form is a hint), images, hard breaks | inline HTML, inline math, footnote references (inline atoms holding their source) |

MDX is parsed as CommonMark: JSX blocks become HTML blocks, `import` and `export` lines become paragraphs. This round-trips, but a real MDX file with JSX expressions inside paragraphs has not been tested; remark-mdx would be needed to model it.

## Gate B and B2 failure categories

Corpus files: none. Spec examples, B: 10 edits, all "semantic mismatch" in files where numeric character references decode to newlines or other structure (`foo&#10;&#10;bar`); writing the decoded text back changes the block structure, so no candidate verifies and the serializer refuses. B2: 51 spec-example edits fail the same way, in the same entity examples and in the spec's nested-emphasis examples (CommonMark 396 to 434, such as `***foo** bar*`), where mdast-util-to-markdown cannot write back an equivalent nesting.

## Did remark positions suffice?

Yes, with workarounds that are all in the code and logged:
- Block offsets start at the first significant character, not at same-line indentation; the indentation is folded into `src` or isolation parsing changes list nesting and fence indentation.
- A definition followed by a setext-eligible paragraph can report overlapping spans; spans are clamped.
- mdast does not record syntax choices (link kind, reference form, fence character and length, break style, emphasis marker); they are recovered by slicing the source at the node's offsets.
- Text leaves have no per-character map; the splice builds one by aligning each text value against its source slice, skipping container prefixes and escapes. Entities make a run non-literal, which is safe (it falls through to the next candidate).
- micromark is occasionally context dependent (1 block in the corpus); handled by the self-description check.

A CST parser (comrak, markdown.mbt) would remove the alignment step and the syntax recovery, but none of this blocked the gates. Not needed now.

## Open risks

1. **y-prosemirror loses data** (high, affects D5). Plain y-prosemirror 1.3.7 and `@tiptap/y-tiptap` 3.0.9 drop the root node's attributes and all marks on inline leaf nodes: 134 of 294 corpus files lose something, typically linked badge images `[![ci](badge)](link)`. Because the CRDT is where the document lives between commits, the next commit would silently drop those links. `src/yjs.ts` fixes seeding and reading (A3b 100 percent), but the live `ySyncPlugin` converts editor transactions itself and still drops leaf marks created while editing. Needs an upstream patch or fork, or a schema where links around images are not marks. Spike 2 should own this.
2. **Serialization cost.** Median 22 ms to parse and 22 ms to serialize a README; the largest file (240 KB Node.js API doc) takes about 2 s each, because every block is re-parsed for the write-time compare. Fine for commit and debounced flush; not fine per keystroke. Cache verification by ProseMirror node identity (unchanged nodes keep identity across transactions) before the daemon materializes files on every change.
3. **Style of new content.** Forced re-serialization of every block reproduces the original bytes for 94.7 percent of blocks with hints and 93.9 percent without; 99.9 percent verify semantically. Known gaps: fence length above 3, files mixing setext and ATX headings, and some list indentation. These only affect new or structurally rewritten blocks.
4. **Refusal UX.** When no candidate verifies, the save fails for that block. The product needs a path for it (show the block as source, or keep the user's edit as an opaque block).
5. **Thin corpus coverage** of front matter, math, Mermaid, MDX and footnotes in real files, and no real MDX files.
6. **`$` in prose.** remark-math treats `$...$` as inline math; this round-trips (opaque atoms) but makes text between dollar signs uneditable as prose.

## Recommendation

- **D4: confirm, with amendments.** Keep `src` and write-time structural compare. Amend: (a) `src` and `gap` only on top-level blocks, with the verified splice ladder instead of `src` on nested blocks; (b) a load-time self-description check that turns context-dependent blocks opaque; (c) every serialization candidate is verified by re-parsing, and an unverified serialization is refused, never written; (d) reference form, marker, fence and break style are hint attributes excluded from the compare; (e) semantic line breaks work as an option on re-serialized and textblock-spliced paragraphs (implemented and tested; untouched paragraphs are never reflowed).
- **D10b: confirm TypeScript with remark.** No Rust or wasm parser is needed. Revisit only if the serialization cost above cannot be cached away.
- **D5: flag.** The y-prosemirror data loss in risk 1 is a D5 issue, not a D4 one; spike 2 should decide between an upstream fix, a maintained fork, or schema changes.
