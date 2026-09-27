# Brief 03: source blocks, Mermaid, unverifiable blocks, clean styling (gates C and H, part of J)

Status: dispatched
Author: spike 7 orchestrator (Opus 5.5)
Updated: 2026-09-27
Plan: [spike 7 plan](2026-09-27-spike-7-plan.md). Charter: [spike 7 charter](2026-09-27-spike-7-charter-web-editor.md), gates C, H and J.
Model: Sonnet (builder)

## Goal

Blocks the editor does not model must look tidy to a non-technical reader, be editable as source, and never be corrupted by edits around them; Mermaid renders as a diagram; and when the serializer cannot verify a block the user sees what will be saved and confirms it, as D4 amendment 4 decides. The page gets plain, clean document styling. Serves D4.

## Inputs

- `AGENTS.md`; the charter's "Rules for every agent in this spike"; the plan's "Key choices".
- D4 and its amendments after spike 1 (`git show origin/spike/2026-09-27-markdown-round-trip:context/docs/2026-09-27-architecture-decisions.md`, section "D4 amendments after spike 1").
- The spike directory as briefs 01 and 02 left it: README, `web/src/`, `src/editing/`, `src/model/schema.ts` (`raw_block` is `text*` with `code: true` and a `kind` attribute; `raw_inline` is an atom with `kind` and `value`; Mermaid is `code_block` with `lang: mermaid`), `src/model/serialize.ts` (`serializeDoc`, `onUnverified`, `trace`, `UnverifiedSerializationError`), `src/model/parse.ts` (which `kind` values exist). The builder logs `context/logs/2026-09-27-builder-spike-7-{foundation,typing}.md`.

## Scope, in order

1. **Empty paragraphs.** Pressing Enter twice leaves an empty paragraph, which has no Markdown form; today `serializeDoc` throws on it. Add a page-level serialize wrapper that omits empty top-level paragraphs (no text and no inline atoms) before serializing, keeping neighbours' bytes intact, so an empty line is never reported as unverifiable. Unit-test it.
2. **Source block view** (`raw_block`, every `kind` the parser produces: HTML, YAML and TOML front matter, math, footnote definition, link reference definition, unknown and `unstable:*`). A Tiptap node view with a small grey label naming the kind in plain words ("HTML", "Page properties", "Formula", "Footnote", "Link reference", "Source"), a rendered preview where sensible, and the source text editable in a monospaced area that is the node's content DOM. Previews: HTML sanitized with DOMPurify (no scripts, no event handlers, no `javascript:` URLs, no iframes); math with KaTeX; front matter as a small key-value list or the raw text; others as the raw text. Show the source editor when the caret is inside the block or the user clicks "Edit source", the preview otherwise. Inline atoms (`raw_inline`: inline HTML, inline math, footnote references) render as unobtrusive chips or rendered math, not as Markdown syntax.
3. **No corruption around source blocks.** Backspace at the start of the block after a source block, and Delete at the end of the block before one, must not merge text into or out of the source block; select the source block instead (as Google Docs does with an image). Enter at the end of a source block's source adds a line inside it; a way out (ArrowDown at the end, or Mod-Enter) moves to a new paragraph after it. Pasting into a source block inserts plain text only.
4. **Mermaid.** A `code_block` with `lang: mermaid` shows the rendered diagram, with the source editable (same pattern as step 2). Load `mermaid` with a dynamic `import()` so it is a separate chunk. A render error shows the error text and the source, not a blank. Other code blocks stay plain monospaced blocks with a small language label.
5. **Gate H, unverifiable blocks.** After a local transaction (never a remote one, so that two users never both convert the same block), check the top-level blocks that changed, not the whole document: keep a cache of serialized output keyed by top-level node identity and serialize only new or changed blocks, with the document's link and footnote definitions as context, using `onUnverified: 'emit'` and `trace` to find blocks that do not verify. Debounce the check. For a block that does not verify: replace it with a `raw_block` of kind `unverified` holding the best-effort Markdown, and show on it a plain-language banner, for example "Phraise can't save this formatting exactly. This is what will be saved." with two buttons: "Keep this" (parse the shown Markdown and put the resulting rich blocks in its place) and "Undo my change" (undo through the Yjs undo manager). Pick the demonstration from spike 1's failure list by trying them with the real serializer: a paragraph whose text contains `&#10;&#10;` entities, or nested emphasis such as `***foo** bar*` with a bold toggle. Record which edit triggers it. Measure how long the check takes on an edit in a large document from `corpus/fetched/real/` and log it.
6. **Styling.** Plain and clean, no design system: readable serif-free body font from the system stack, a centred page column about 720 px wide, comfortable line height, clear heading sizes, tables with thin borders and header shading, code blocks and source blocks as light grey cards, blockquotes with a left rule, list markers styled normally, links underlined and coloured, images constrained to the column. A slim top bar with the document name, the user's name and the Markdown toggle. Nothing in normal editing shows Markdown syntax: no `#`, `*`, backticks or brackets in rendered text.
7. **Tests**, titled `[C] ...` and `[H] ...`:
   - C: a fixture with front matter, an HTML block, a `$$` math block, a footnote with its definition, a link reference definition, a Mermaid fence and an unknown construct. Each renders with its label and no visible Markdown syntax in the preview; editing each source through the keyboard changes exactly that block's bytes; typing, Enter, Backspace and Delete in the paragraphs next to each block leave the block byte-identical; the Mermaid block renders an `svg`; an HTML block containing `<img src=x onerror=...>` and `<script>` sets no global flag and inserts no script element.
   - H: the chosen edit shows the banner with the best-effort Markdown; "Keep this" leaves a document that serializes without error and matches the shown text; "Undo my change" restores the original bytes; a second connected browser context does not also convert the block.
   - Unit tests for the empty-paragraph wrapper, the per-block cache, the label mapping and the sanitizer configuration.

Not in scope: comments, collaboration beyond the one H check, offline, IME, screenshots, other browsers.

## Definition of done, and stopping point

Stop when `npm test` passes; `npm run gates` shows A, B, C and H PASS in Chromium (A and B must still pass), or a test is `test.fixme` with a one-line reason recorded in your log; `npx tsc --noEmit` passes; nothing listens on 4400 to 4499; work committed with explicit paths, not pushed; README updated. Report the page bundle sizes after the Mermaid split.

## Constraints

- Work only inside `/Users/skk/code/phraise/.claude/worktrees/agent-a40b6e74050a061e9`; absolute paths. Do not launch other agents. npm, not pnpm. Tests on 127.0.0.1, ports 4400 to 4449.
- Add behaviour as extensions and node views; if a node view needs a spec change on an existing node (for example `selectable`), make it in the converter layer and keep `checkSchemaEquivalence` passing, or explain in the log why that is impossible.
- Log to `context/logs/2026-09-27-builder-spike-7-source-blocks.md` at every task boundary, timestamps from `date`.

## Handback

Under 300 words: outcome per gate; what you verified and how; `fixme`s with reasons; the gate H trigger you chose and the check's measured cost; bundle sizes; paths of log and README.
