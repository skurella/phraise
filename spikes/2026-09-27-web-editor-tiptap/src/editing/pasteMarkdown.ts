// Brief 02, task 3 (paste) / task 4 (unit test): "Decide the rule for when
// text/plain is treated as Markdown and document it."
//
// The rule this spike uses: plain-text clipboard content is treated as
// Markdown only when it contains a recognizable Markdown CONSTRUCT -- a
// heading, a list marker, a blockquote marker, a fenced code block, a table
// row, a thematic break, or an inline span (bold/italic/strikethrough/inline
// code/a link). Plain prose with no such marker (e.g. a sentence copied out
// of a chat message) is left as literal text, same as Google Docs treats any
// plain-text paste -- so an accidental `_id` or a stray `*` in ordinary text
// does not suddenly turn into emphasis. This intentionally over-recognizes
// slightly (a line that happens to start with `- ` is treated as a list even
// if the user meant a literal dash), which matches how every Markdown editor
// in the wild resolves this ambiguity.
//
// Separately: "a paste into the middle of a paragraph of a single-line
// Markdown fragment stays inline" -- decided as: if the recognized-as-
// Markdown text parses (via spike 1's `parseMarkdown`) to exactly one
// top-level block, that block is a plain paragraph, and the source text has
// no blank line (i.e. it is not asking to end up as its own separate
// top-level block), splice only that paragraph's own inline content into the
// caret position instead of inserting a whole new block. Anything else
// (multiple blocks, or a single non-paragraph block like a heading/list/
// table/fence) is inserted as block content.
import { Fragment, Node as PMNode } from 'prosemirror-model';
import type { Schema } from 'prosemirror-model';
import { parseMarkdown } from '../model/parse.js';
import { schema as modelSchema } from '../model/schema.js';

const BLOCK_MARKER_PATTERNS: RegExp[] = [
  /^ {0,3}#{1,6}(?:\s+\S|\s*$)/, // ATX heading
  /^ {0,3}[-*+]\s+\S/, // bullet list item
  /^ {0,3}\d{1,9}[.)]\s+\S/, // ordered list item
  /^ {0,3}>/, // blockquote
  /^ {0,3}(`{3,}|~{3,})/, // fenced code block
  /^ {0,3}\|.*\|\s*$/, // GFM table row
  /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/, // thematic break
];

const INLINE_MARKER_PATTERNS: RegExp[] = [
  /\*\*[^*\n]+\*\*/, // strong
  /(?<![*\w])\*[^*\n]+\*(?![*\w])/, // emphasis (not part of a longer run of *s)
  /(?<!~)~~[^~\n]+~~(?!~)/, // strikethrough
  /`[^`\n]+`/, // inline code
  /\[[^\]\n]+\]\([^)\n]*\)/, // inline link
  /\[[^\]\n]+\]\[[^\]\n]*\]/, // reference link
];

/** The Markdown-or-not rule described above. Exported for unit testing on its own. */
export function looksLikeMarkdown(text: string): boolean {
  if (!text.trim()) return false;
  const lines = text.split(/\r\n|\n/);
  if (lines.some((line) => BLOCK_MARKER_PATTERNS.some((re) => re.test(line)))) return true;
  return INLINE_MARKER_PATTERNS.some((re) => re.test(text));
}

export interface MarkdownPasteContent {
  /** True when this should be spliced as inline content at the caret (a
   * single-line, single-paragraph fragment); false for block content that
   * should be inserted as its own top-level block(s). */
  inline: boolean;
  fragment: Fragment;
}

/** Convert `src`/`gap`-carrying nodes' attrs onto a schema instance that may
 * not be the exact same object as `modelSchema` (the live editor's
 * Tiptap-converted schema is structurally equivalent, per
 * `checkSchemaEquivalence`, but a different JS object) -- the same
 * cross-schema move `web/src/main.ts`'s `markdown()` and this spike's
 * round-trip test both make, via `toJSON`/`fromJSON`. */
function toTargetSchema(node: PMNode, targetSchema: Schema): PMNode {
  if (targetSchema === (modelSchema as unknown as Schema)) return node;
  return PMNode.fromJSON(targetSchema, node.toJSON());
}

/**
 * Parse Markdown clipboard text into paste content for `targetSchema`
 * (spike 1's model schema, or a schema equivalent to it -- the live editor's
 * converted schema, in practice).
 */
export function buildMarkdownPasteContent(text: string, targetSchema: Schema): MarkdownPasteContent {
  const { doc } = parseMarkdown(text);
  const converted = toTargetSchema(doc, targetSchema);

  const hasBlankLine = /\r?\n\s*\r?\n/.test(text.trim());
  if (!hasBlankLine && converted.childCount === 1 && converted.firstChild!.type.name === 'paragraph') {
    return { inline: true, fragment: converted.firstChild!.content };
  }

  const children: PMNode[] = [];
  converted.forEach((child) => children.push(child));
  // `parseMarkdown` sets the LAST block's `gap` from whatever trailing text
  // followed it in the pasted snippet (typically `''`, not `null` -- an
  // isolated snippet has no "next block" of its own to separate from).
  // `serializeDoc` treats any non-null `gap` (including `''`) as the real
  // separator to emit verbatim, so left alone this glues the pasted
  // content directly onto whatever follows it in the REAL document with no
  // blank line at all. Null it so the real document's own default
  // separator applies once this is inserted, matching every other
  // "genuinely new block" in this spike (see `src/editing/freshSrc.ts`).
  const last = children[children.length - 1];
  if (last && (last.attrs.gap !== undefined || last.attrs.src !== undefined) && last.attrs.gap != null) {
    children[children.length - 1] = last.type.create({ ...last.attrs, gap: null }, last.content, last.marks);
  }
  return { inline: false, fragment: Fragment.fromArray(children) };
}
