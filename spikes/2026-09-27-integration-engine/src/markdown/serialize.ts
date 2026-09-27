// Origin: spike 3 (daemon-file-sync-fork-import), branch spike/2026-09-27-daemon-file-sync, commit 9343b62, src/md/serialize.ts
// PM doc -> markdown. See brief 02 design: verbatim, splice, re-serialize.
import { Node as PMNode, Mark } from 'prosemirror-model';
import { toMarkdown, defaultHandlers } from 'mdast-util-to-markdown';
import { gfmToMarkdown } from 'mdast-util-gfm';
import { frontmatterToMarkdown } from 'mdast-util-frontmatter';
import { mathToMarkdown } from 'mdast-util-math';
import { parseBlock, parseMdast, buildDefsContextFromDoc, type TextRun } from './parse.js';
import { semanticEq } from './compare.js';
import { detectStyle, type Style } from './style.js';
import { isMetaAttrName } from './schema.js';

export interface TraceInfo {
  // 'opaque-edit': a raw_block (front matter, HTML, math, etc.) whose text
  // content was directly edited (no longer equal to its own `src`), so it is
  // emitted as its current text rather than the original bytes. Pre-existing
  // runtime value that the type union omitted (harmless in JS, but the gates
  // harness's path-distribution reporting needs it to type-check).
  kind: 'verbatim' | 'splice' | 'textblock-splice' | 're-serialize' | 'unverified' | 'opaque-edit';
  type: string;
  /**
   * The exact text this block emitted. Added for the gates harness (gate E's
   * per-block forced-reserialization byte-identity/verification-rate
   * metrics): reconstructing a single block's own output from the whole
   * document's serialized text is fragile (gaps can repeat or be empty), so
   * the trace reports it directly instead. Purely additive: existing
   * consumers that only read `kind`/`type` are unaffected.
   */
  text: string;
}

export interface SerializeOpts {
  useHints?: boolean;
  forceReserialize?: boolean;
  noSplice?: boolean;
  /** Disable only the textblock-splice candidate (brief 04 measurement: "before" vs "after"); text/link splice still apply. */
  noTextblockSplice?: boolean;
  /**
   * Reformat a re-serialized or textblock-spliced paragraph to one sentence
   * per line (brief 04, task 4). Never applied to a verbatim or text-spliced
   * paragraph.
   */
  semanticLineBreaks?: boolean;
  /**
   * What to do when no candidate for a changed block verifies (its output
   * would not re-parse to the edited block). 'throw' (default) raises
   * UnverifiedSerializationError so the caller never writes a file whose
   * meaning differs from the document; 'emit' returns the best effort and
   * reports it through `trace` (used by the gate harness to measure).
   */
  onUnverified?: 'throw' | 'emit';
  trace?: (info: TraceInfo) => void;
}

export class UnverifiedSerializationError extends Error {
  constructor(
    readonly blockIndex: number,
    readonly blockType: string,
    readonly candidate: string,
  ) {
    super(`serializeDoc: block ${blockIndex} (${blockType}) has no serialization that re-parses to the edited block`);
    this.name = 'UnverifiedSerializationError';
  }
}

// ---------------------------------------------------------------------------
// Style derivation: reconstruct the file's original-ish text from the doc's
// own src/gap attrs (exact for an untouched doc) and run detectStyle on it.
// ---------------------------------------------------------------------------

function detectDocStyle(doc: PMNode): Style {
  let reconstructed = (doc.attrs.lead as string) ?? '';
  doc.forEach((block) => {
    if (block.attrs.src != null) reconstructed += (block.attrs.src as string) + ((block.attrs.gap as string) ?? '');
  });
  if (reconstructed.length === 0) {
    return detectStyle('', { type: 'root', children: [] });
  }
  const mdast = parseMdast(reconstructed);
  return detectStyle(reconstructed, mdast);
}

// ---------------------------------------------------------------------------
// Splice candidate
// ---------------------------------------------------------------------------

function findLiteralRun(map: TextRun[], start: number, endOld: number): TextRun | undefined {
  for (const r of map) {
    if (!r.literal) continue;
    if (start === endOld) {
      if (start >= r.from && start <= r.to) return r;
    } else if (r.from <= start && endOld <= r.to) {
      return r;
    }
  }
  return undefined;
}

function sourceOffsetAt(run: TextRun, relIndex: number): number {
  if (relIndex < run.sourceOffsets.length) return run.sourceOffsets[relIndex]!;
  const last = run.sourceOffsets[run.sourceOffsets.length - 1] ?? -1;
  return last + 1;
}

function escapeMarkdownText(text: string): string {
  let out = text.replace(/[\\*_`[\]<>#]/g, '\\$&');
  if (/^[+\-=|]/.test(out)) out = '\\' + out;
  return out;
}

function tryTextSplice(block: PMNode, src: string, ctx: string): string | null {
  const { node: old, map } = parseBlock(src, ctx, { map: true });
  if (!map || old.type !== block.type) return null;

  const start = old.content.findDiffStart(block.content);
  if (start == null) return null;
  const diffEnd = old.content.findDiffEnd(block.content);
  if (diffEnd == null) return null;
  let endOld = diffEnd.a;
  let endNew = diffEnd.b;
  if (endOld < start) endOld = start;
  if (endNew < start) endNew = start;

  const run = findLiteralRun(map, start, endOld);
  if (!run) return null;

  // Positions are relative to the block's content and usually point inside a
  // nested textblock (list item > paragraph > text), so cutting the block's
  // own fragment would return the wrapping structure. Resolve both ends and
  // require them to sit in the same textblock, then cut that textblock's inline
  // content.
  const $s = block.resolve(start);
  const $e = block.resolve(endNew);
  if ($s.parent !== $e.parent || !$s.parent.isTextblock) return null;
  const newFrag = $s.parent.content.cut($s.parentOffset, $e.parentOffset);
  let newText: string;
  let newMarks: readonly Mark[];
  if (newFrag.childCount === 0) {
    newText = '';
    newMarks = run.marks;
  } else if (newFrag.childCount === 1 && newFrag.child(0).isText) {
    newText = newFrag.child(0).text ?? '';
    newMarks = newFrag.child(0).marks;
  } else {
    return null;
  }
  if (!Mark.sameSet(newMarks, run.marks)) return null;

  const sAbs = sourceOffsetAt(run, start - run.from);
  // Exclusive end: one past the source offset of the last replaced character,
  // so that source characters skipped by the alignment after it (an escaping
  // backslash of the next character, a line prefix) stay in place.
  const eAbs = start === endOld ? sAbs : sourceOffsetAt(run, endOld - 1 - run.from) + 1;
  const srcS = sAbs - ctx.length;
  const srcE = eAbs - ctx.length;
  if (srcS < 0 || srcE < srcS || srcE > src.length) return null;

  const escaped = escapeMarkdownText(newText);
  let candidate = src.slice(0, srcS) + escaped + src.slice(srcE);
  const ok = (c: string) => {
    const r = parseBlock(c, ctx);
    return r.count === 1 && semanticEq(r.node, block);
  };
  if (ok(candidate)) return candidate;

  candidate = src.slice(0, srcS) + newText + src.slice(srcE);
  if (ok(candidate)) return candidate;

  return null;
}

/**
 * Link-level splice. When the edited range lies inside one link (its text is
 * also its syntax: a shortcut reference `[label]`, or a bare URL whose text is
 * the URL), a text splice cannot express the edit. Re-serialize only that link
 * from the new document and splice it over the link's source span. Shortcut
 * and collapsed references whose text changed become full references so they
 * keep pointing at the same definition.
 */
function tryLinkSplice(block: PMNode, src: string, ctx: string, style: Style): string | null {
  const { node: old, links } = parseBlock(src, ctx, { map: true });
  if (!links || old.type !== block.type) return null;
  const start = old.content.findDiffStart(block.content);
  const diffEnd = old.content.findDiffEnd(block.content);
  if (start == null || diffEnd == null) return null;
  const endOld = Math.max(diffEnd.a, start);
  const endNew = Math.max(diffEnd.b, start);
  const link = links.find((l) => l.from <= start && endOld <= l.to);
  if (!link) return null;
  const newTo = link.to + (endNew - endOld);
  const $s = block.resolve(link.from);
  const $e = block.resolve(newTo);
  if ($s.parent !== $e.parent || !$s.parent.isTextblock) return null;
  const inline = $s.parent.content.cut($s.parentOffset, $e.parentOffset);
  const nodes: PMNode[] = [];
  inline.forEach((n) => nodes.push(n));
  const oldMark = old.resolve(link.from + 1).marks().find((m) => m.type.name === 'link');
  if (!oldMark || nodes.length === 0 || !nodes.every((n) => n.marks.some((m) => m.eq(oldMark)))) return null;
  const phrasing = pmInlineToMdast(nodes);
  if (phrasing.length !== 1) return null;
  const top = phrasing[0];
  if (top.type === 'linkReference' && top.referenceType !== 'full') top.referenceType = 'full';
  const options = optionsFor(block, style, true);
  const linkExtensions = [...toMarkdownExtensions, { handlers: { break: makeBreakHandler(true), literalAutolink: literalAutolinkHandler, rawInlineHtml: rawInlineHtmlHandler } }];
  let md = toMarkdown({ type: 'paragraph', children: phrasing.map(simplifyLiteralLinks) } as any, { extensions: linkExtensions, ...options } as any);
  md = md.replace(/\n+$/, '');
  if (md.includes('\n')) return null;
  const s0 = link.sourceStart - ctx.length;
  const e0 = link.sourceEnd - ctx.length;
  if (s0 < 0 || e0 > src.length || e0 < s0) return null;
  const candidate = src.slice(0, s0) + md + src.slice(e0);
  const r = parseBlock(candidate, ctx);
  return r.count === 1 && semanticEq(r.node, block) ? candidate : null;
}

/**
 * Textblock splice. When the diff between the old and new top-level block
 * lies entirely inside one textblock (paragraph, heading, or table cell) at
 * any depth -- e.g. a list item's paragraph, or a blockquote's paragraph --
 * re-serialize only that textblock's inline content and splice it over the
 * textblock's own mdast source span, instead of re-serializing the whole
 * top-level block. This is what lets a bold-toggle inside one list item, or
 * one blockquote paragraph, leave every sibling item/paragraph byte-for-byte
 * untouched.
 *
 * Unlike tryTextSplice (character-for-character literal reuse) this always
 * regenerates the textblock's markdown from scratch, so it also covers edits
 * that change marks (bold/italic/link) that a literal splice cannot express.
 * Every candidate is still verified before being returned.
 */
function tryTextblockSplice(block: PMNode, src: string, ctx: string, style: Style, semanticLineBreaks: boolean): string | null {
  const { node: old, positions } = parseBlock(src, ctx, { map: true });
  if (!positions || old.type !== block.type) return null;

  const start = old.content.findDiffStart(block.content);
  if (start == null) return null;
  const diffEnd = old.content.findDiffEnd(block.content);
  if (diffEnd == null) return null;
  const endOld = Math.max(diffEnd.a, start);
  const endNew = Math.max(diffEnd.b, start);

  let $sOld, $eOld, $sNew, $eNew;
  try {
    $sOld = old.resolve(start);
    $eOld = old.resolve(endOld);
    $sNew = block.resolve(start);
    $eNew = block.resolve(endNew);
  } catch {
    return null;
  }

  if ($sOld.parent !== $eOld.parent || !$sOld.parent.isTextblock) return null;
  if ($sNew.parent !== $eNew.parent || !$sNew.parent.isTextblock) return null;
  const oldTextblock = $sOld.parent;
  const newTextblock = $sNew.parent;
  if (oldTextblock.type !== newTextblock.type) return null;
  if (oldTextblock.type.spec.code) return null; // code/raw blocks: never this path

  const span = positions.get(oldTextblock);
  if (!span) return null;
  const spanStart = span.startOffset - ctx.length;
  const spanEnd = span.endOffset - ctx.length;
  if (spanStart < 0 || spanEnd > src.length || spanEnd < spanStart) return null;

  // Determine the inner splice range within [spanStart, spanEnd): for most
  // textblocks (paragraphs, table cells) this is the whole span, since mdast
  // positions for those already start at the first content character. ATX
  // headings need the leading `#`s/space (and any trailing closing hashes)
  // stripped; setext headings splice their text line(s) only, excluding the
  // underline row.
  let innerStart = spanStart;
  let innerEnd = spanEnd;
  const isTableCell = newTextblock.type.name === 'table_cell';

  if (newTextblock.type.name === 'heading') {
    const raw = src.slice(spanStart, spanEnd);
    const lines = raw.split(/\r\n|\n/);
    const firstLine = lines[0];
    const isSetext = firstLine.length > 0 && firstLine[0] !== '#';
    if (isSetext) {
      // Splice the text lines only; drop the underline row (last line) if present.
      const underlineRe = /^[ \t]*(=+|-+)[ \t]*$/;
      let textLineCount = lines.length;
      if (textLineCount > 1 && underlineRe.test(lines[textLineCount - 1])) textLineCount--;
      const textLen = lines.slice(0, textLineCount).join('\n').length;
      innerEnd = spanStart + textLen;
    } else {
      const m = /^#+ ?/.exec(firstLine);
      if (!m) return null;
      innerStart = spanStart + m[0].length;
      const closeMatch = /[ \t]+#+[ \t]*$/.exec(firstLine);
      innerEnd = closeMatch ? spanStart + closeMatch.index : spanStart + firstLine.length;
      if (innerEnd < innerStart) innerEnd = innerStart;
    }
  }

  // Serialize the new textblock's own inline content as a bare paragraph.
  const nodes: PMNode[] = [];
  newTextblock.forEach((n) => nodes.push(n));
  const phrasing = pmInlineToMdast(nodes);
  const options = optionsFor(block, style, true);
  // Semantic line breaks (brief 04, task 4) only ever apply to an actual
  // paragraph textblock -- this wrapper node is `type: 'paragraph'` purely
  // so mdast-util-to-markdown has something to hand phrasing content to; for
  // a heading or table cell being textblock-spliced it must not trigger.
  const applySLB = semanticLineBreaks && newTextblock.type.name === 'paragraph';
  const tbExtensions = [
    ...toMarkdownExtensions,
    { handlers: { break: makeBreakHandler(true), paragraph: makeParagraphHandler(applySLB), literalAutolink: literalAutolinkHandler, rawInlineHtml: rawInlineHtmlHandler } },
  ];
  let newInline = toMarkdown(
    { type: 'paragraph', children: phrasing.map(simplifyLiteralLinks) } as any,
    { extensions: tbExtensions, ...options } as any
  );
  newInline = newInline.replace(/\n+$/, '');

  if (isTableCell && (newInline.includes('\n') || /(?<!\\)\|/.test(newInline))) return null;

  // If either the original span or the freshly serialized text spans more
  // than one physical line, every continuation line needs the enclosing
  // container's line prefix (blockquote `>` markers, list continuation
  // indent) re-applied, since we are splicing into a source string that
  // still carries those prefixes on its other lines.
  const newLines = newInline.split('\n');
  let replacedInner = newInline;
  if (newLines.length > 1) {
    const prefix = computeLinePrefix(src, spanStart, innerStart, innerEnd);
    replacedInner = newLines[0] + newLines.slice(1).map((l) => '\n' + prefix + l).join('');
  }

  const candidate = src.slice(0, innerStart) + replacedInner + src.slice(innerEnd);
  const r = parseBlock(candidate, ctx);
  return r.count === 1 && semanticEq(r.node, block, { equateSoftBreaks: applySLB }) ? candidate : null;
}

/**
 * The container-line prefix (spaces and/or `>` markers) that every
 * continuation line of a textblock's own source carries, per brief 04: taken
 * from the textblock's own second physical source line when its span is
 * already multi-line; otherwise derived from its first line's column, with
 * list markers blanked out and `>` kept.
 */
function computeLinePrefix(src: string, spanStart: number, innerStart: number, innerEnd: number): string {
  const lineStart = src.lastIndexOf('\n', spanStart - 1) + 1;
  const raw = src.slice(lineStart, innerEnd);
  const lines = raw.split(/\r\n|\n/);
  if (lines.length > 1) {
    const m = /^[ \t>]*/.exec(lines[1]);
    return m ? m[0] : '';
  }
  const prefixRaw = src.slice(lineStart, innerStart);
  return prefixRaw.replace(/[^\t>]/g, ' ');
}

function trySplice(block: PMNode, src: string, ctx: string, style: Style): string | null {
  return tryTextSplice(block, src, ctx) ?? tryLinkSplice(block, src, ctx, style);
}

// ---------------------------------------------------------------------------
// Re-serialize candidate: PM node -> mdast -> mdast-util-to-markdown
// ---------------------------------------------------------------------------

function childArray(node: PMNode): PMNode[] {
  const out: PMNode[] = [];
  node.forEach((c) => out.push(c));
  return out;
}

function marksGroupEq(a: Mark, b: Mark): boolean {
  if (a.type !== b.type) return false;
  const keys = new Set([...Object.keys(a.attrs), ...Object.keys(b.attrs)]);
  for (const k of keys) {
    if (isMetaAttrName(k)) continue;
    if (JSON.stringify((a.attrs as any)[k]) !== JSON.stringify((b.attrs as any)[k])) return false;
  }
  return true;
}

function mdastWrapperFor(mark: Mark): any {
  switch (mark.type.name) {
    case 'em':
      return { type: 'emphasis', children: [] };
    case 'strong':
      return { type: 'strong', children: [] };
    case 'strike':
      return { type: 'delete', children: [] };
    case 'link':
      if (mark.attrs.refType) {
        return {
          type: 'linkReference',
          identifier: mark.attrs.identifier,
          label: mark.attrs.label,
          referenceType: mark.attrs.refType,
          children: [],
        };
      }
      return { type: 'link', url: mark.attrs.href ?? '', title: mark.attrs.title ?? null, kindHint: mark.attrs.kindHint, children: [] };
    default:
      return { type: mark.type.name, children: [] };
  }
}

function pmLeafToMdast(node: PMNode): any | null {
  if (node.isText) {
    if (node.marks.some((m) => m.type.name === 'code')) {
      return { type: 'inlineCode', value: node.text };
    }
    return { type: 'text', value: node.text };
  }
  switch (node.type.name) {
    case 'hard_break':
      return { type: 'break', breakHint: node.attrs.breakHint ?? null };
    case 'image':
      if (node.attrs.refType) {
        return {
          type: 'imageReference',
          identifier: node.attrs.identifier,
          label: node.attrs.label,
          referenceType: node.attrs.refType,
          alt: node.attrs.alt || null,
        };
      }
      return { type: 'image', url: node.attrs.url ?? '', title: node.attrs.title ?? null, alt: node.attrs.alt || null };
    case 'raw_inline': {
      const kind = node.attrs.kind;
      if (kind === 'footnoteReference') {
        const m = /^\[\^([^\]]+)\]$/.exec(node.attrs.value ?? '');
        const id = m ? m[1] : node.attrs.value;
        return { type: 'footnoteReference', identifier: id, label: id };
      }
      if (kind === 'inlineMath') return { type: 'inlineMath', value: node.attrs.value };
      // html and unknown kinds: emit verbatim as raw html.
      return { type: 'rawInlineHtml', value: node.attrs.value };
    }
    default:
      return null;
  }
}

function pmInlineToMdast(nodes: PMNode[]): any[] {
  const result: any[] = [];
  const markStack: Mark[] = [];
  const containerStack: any[][] = [result];

  for (const child of nodes) {
    const marks = child.marks.filter((m) => m.type.name !== 'code');
    // Keep open the longest prefix of the open-mark stack that this node still
    // carries, whatever the schema order of its marks, and open only the rest.
    // Following schema order alone closed and reopened marks, so
    // `**bold _italic_**` came out as `**bold **_**italic**_`-like soup.
    let common = 0;
    while (common < markStack.length && marks.some((m) => marksGroupEq(m, markStack[common]))) common++;
    while (markStack.length > common) {
      markStack.pop();
      containerStack.pop();
    }
    for (const m of marks) {
      if (markStack.some((open) => marksGroupEq(open, m))) continue;
      const wrapper = mdastWrapperFor(m);
      containerStack[containerStack.length - 1].push(wrapper);
      markStack.push(m);
      containerStack.push(wrapper.children);
    }
    const leaf = pmLeafToMdast(child);
    if (leaf) containerStack[containerStack.length - 1].push(leaf);
  }
  return result;
}

function pmListItemToMdast(item: PMNode): any {
  const children = childArray(item);
  return {
    type: 'listItem',
    checked: item.attrs.checked,
    spread: false,
    children: children.length ? children.map(pmBlockToMdast) : [{ type: 'paragraph', children: [] }],
  };
}

function pmBlockToMdast(node: PMNode): any {
  switch (node.type.name) {
    case 'paragraph':
      return { type: 'paragraph', children: pmInlineToMdast(childArray(node)) };
    case 'heading':
      return { type: 'heading', depth: node.attrs.level, children: pmInlineToMdast(childArray(node)) };
    case 'blockquote':
      return { type: 'blockquote', children: childArray(node).map(pmBlockToMdast) };
    case 'bullet_list':
      return {
        type: 'list',
        ordered: false,
        start: null,
        spread: !node.attrs.tight,
        children: childArray(node).map(pmListItemToMdast),
      };
    case 'ordered_list':
      return {
        type: 'list',
        ordered: true,
        start: node.attrs.start,
        spread: !node.attrs.tight,
        children: childArray(node).map(pmListItemToMdast),
      };
    case 'code_block':
      return { type: 'code', lang: node.attrs.lang, meta: node.attrs.meta, value: node.textContent };
    case 'horizontal_rule':
      return { type: 'thematicBreak' };
    case 'table':
      return {
        type: 'table',
        align: node.attrs.align,
        children: childArray(node).map((row) => ({
          type: 'tableRow',
          children: childArray(row).map((cell) => ({ type: 'tableCell', children: pmInlineToMdast(childArray(cell)) })),
        })),
      };
    case 'raw_block':
      return { type: 'html', value: node.textContent };
    default:
      throw new Error(`serialize: cannot convert node type "${node.type.name}" to mdast`);
  }
}

function findFirstMark(block: PMNode, markName: string): Mark | null {
  let found: Mark | null = null;
  block.descendants((n) => {
    if (found) return false;
    for (const m of n.marks) {
      if (m.type.name === markName) {
        found = m;
        return false;
      }
    }
    return true;
  });
  return found;
}

function optionsFor(block: PMNode, style: Style, useHints: boolean): Record<string, unknown> {
  const emMark = useHints ? findFirstMark(block, 'em') : null;
  const strongMark = useHints ? findFirstMark(block, 'strong') : null;
  const emphasis = (emMark?.attrs.markerHint as string | undefined)?.[0] ?? style.emphasis;
  const strong = (strongMark?.attrs.markerHint as string | undefined)?.[0] ?? style.strong;

  let bullet = style.bullet;
  let bulletOrdered = style.bulletOrdered;
  if (block.type.name === 'bullet_list' && useHints && block.attrs.markerHint) bullet = block.attrs.markerHint;
  if (block.type.name === 'ordered_list' && useHints && block.attrs.delimHint) bulletOrdered = block.attrs.delimHint;

  let fence = style.fence;
  if (block.type.name === 'code_block' && useHints && block.attrs.fenceHint && block.attrs.fenceHint !== 'indent') {
    fence = block.attrs.fenceHint;
  }

  let closeAtx = style.closeAtx;
  let setext = style.setext;
  if (block.type.name === 'heading' && useHints) {
    closeAtx = !!block.attrs.closeHint;
    setext = !!block.attrs.setextHint;
  }

  let rule = style.rule;
  let ruleRepetition = style.ruleRepetition;
  if (block.type.name === 'horizontal_rule' && useHints && block.attrs.ruleHint) {
    const r = (block.attrs.ruleHint as string).trim();
    rule = r[0] ?? style.rule;
    ruleRepetition = r.split('').filter((c) => c === rule).length || style.ruleRepetition;
  }

  return {
    bullet,
    bulletOrdered,
    emphasis,
    strong,
    fence,
    fences: true,
    setext,
    closeAtx,
    rule,
    ruleRepetition,
    listItemIndent: style.listItemIndent,
    incrementListMarker: true,
  };
}

const toMarkdownExtensions = [gfmToMarkdown(), frontmatterToMarkdown(['yaml', 'toml']), mathToMarkdown()];

/**
 * Re-serializer fidelity (brief 04, task 3): a hard break's own `breakHint`
 * (recorded at parse time from the raw source: two-or-more spaces, or a
 * backslash, before the newline) picks which CommonMark spelling to emit,
 * instead of `mdast-util-to-markdown`'s default of always a backslash. Falls
 * back to the library default first, so a hard break inside an "unsafe"
 * construct (setext heading text, table cell) still gets the safe
 * space/empty spelling that construct requires.
 */
function makeBreakHandler(useHints: boolean) {
  return (node: any, parent: any, state: any, info: any): string => {
    const def = defaultHandlers.break(node, parent, state, info);
    if (!useHints || def !== '\\\n') return def;
    const hint = node.breakHint as string | null;
    return typeof hint === 'string' && hint[0] !== '\\' ? '  \n' : def;
  };
}

// ---------------------------------------------------------------------------
// Semantic line breaks (brief 04, task 4): one sentence per line, only for a
// re-serialized or textblock-spliced paragraph.
// ---------------------------------------------------------------------------

/**
 * Split after a `.`, `!`, or `?` that is followed by whitespace and then an
 * uppercase letter or digit, replacing that whitespace with a single
 * newline (a CommonMark soft break -- semantically still just a space).
 * Never splits inside a protected span: inline code (backtick-delimited, any
 * fence length), a link/image (`[...](...)`/`[...][...]`), an autolink
 * (`<...>`), or a bare URL -- those are matched and passed through untouched
 * before the sentence-boundary regex ever sees their contents.
 */
function applySemanticLineBreaks(text: string): string {
  const protectedRe = /(`+)[\s\S]*?\1(?!`)|!?\[[^\]\n]*\]\([^)\n]*\)|!?\[[^\]\n]*\]\[[^\]\n]*\]|<[^ <>\n]+>|\bhttps?:\/\/\S+|\bwww\.\S+/g;
  const splitSentences = (segment: string) => segment.replace(/([.!?])[ \t]+(?=[A-Z0-9])/g, '$1\n');

  let result = '';
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = protectedRe.exec(text))) {
    result += splitSentences(text.slice(last, m.index));
    result += m[0];
    last = m.index + m[0].length;
  }
  result += splitSentences(text.slice(last));
  return result;
}

function makeParagraphHandler(semanticLineBreaks: boolean) {
  return (node: any, parent: any, state: any, info: any): string => {
    const def = defaultHandlers.paragraph(node, parent, state, info);
    return semanticLineBreaks ? applySemanticLineBreaks(def) : def;
  };
}

/**
 * Re-serializer fidelity (brief 04, task 3): a link mark's `kindHint`
 * ('literal', the GFM bare-URL/bare-email autolink form with no surrounding
 * markup at all) whose text is exactly its own URL (allowing for the
 * `http://`/`https://`/`mailto:` prefix GFM's literal-autolink parsing adds)
 * is spliced back out to plain text instead of `[text](url)`, so it survives
 * as the same bare literal on re-parse. ('autolink', the `<url>` form,
 * already round-trips correctly through mdast-util-to-markdown's own
 * built-in `formatLinkAsAutolink` shortcut and needs no help here.) Left
 * alone -- kept as `[text](url)` -- whenever the text was edited to differ
 * from the URL.
 */
// Emits a bare GFM literal autolink verbatim. It is its own node type rather
// than an inline `html` node because to-markdown peeks at the next node's
// first character to decide what is safe before it: an html node peeks as
// `<`, so a soft line break right before a bare URL was turned into a space
// (a line starting with `<` could open an HTML block). This handler peeks as
// the URL's own first character.
function literalAutolinkHandler(node: any): string {
  return node.value;
}
(literalAutolinkHandler as any).peek = (node: any) => String(node.value).charAt(0);

// Inline HTML is emitted verbatim. to-markdown's own html handler peeks as
// `<`, which makes it replace a soft line break before inline HTML with a
// space (a line starting with `<` might open an HTML block). Only HTML block
// start conditions 1 to 6 can interrupt a paragraph, so peek as `<` only for
// those; verification catches anything this gets wrong.
const HTML_BLOCK_INTERRUPT = /^<(?:script|pre|style|textarea|!--|\?|![A-Za-z]|!\[CDATA\[|\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:[\s/>]|$))/i;
function rawInlineHtmlHandler(node: any): string {
  return node.value;
}
(rawInlineHtmlHandler as any).peek = (node: any) => (HTML_BLOCK_INTERRUPT.test(String(node.value)) ? '<' : 'x');

function simplifyLiteralLinks(node: any): any {
  if (node && typeof node === 'object') {
    if (Array.isArray(node.children)) {
      for (let i = 0; i < node.children.length; i++) node.children[i] = simplifyLiteralLinks(node.children[i]);
    }
    if (node.type === 'link' && node.kindHint === 'literal' && node.children?.length === 1 && node.children[0].type === 'text') {
      const text = node.children[0].value as string;
      const href = (node.url as string) ?? '';
      const matches = text === href || 'http://' + text === href || 'https://' + text === href || 'mailto:' + text === href;
      // Emitted verbatim through literalAutolinkHandler, not as `text`: the literal
      // form is written as-is with no markdown escaping in the source (a URL
      // routinely contains `_`/`*`/etc.), and GFM's literal-autolink parser
      // recognizes it as a single token regardless of those characters, so
      // escaping them here would only add backslashes the original never had.
      if (matches) return { type: 'literalAutolink', value: text };
    }
  }
  return node;
}

function reserializeBlock(block: PMNode, style: Style, useHints: boolean, eol: '\n' | '\r\n', semanticLineBreaks: boolean): string {
  const mdastNode = useHints ? simplifyLiteralLinks(pmBlockToMdast(block)) : pmBlockToMdast(block);
  const options = optionsFor(block, style, useHints);
  const reserializeExtensions = [
    ...toMarkdownExtensions,
    { handlers: { break: makeBreakHandler(useHints), paragraph: makeParagraphHandler(semanticLineBreaks), literalAutolink: literalAutolinkHandler, rawInlineHtml: rawInlineHtmlHandler } },
  ];
  let out = toMarkdown(mdastNode, { extensions: reserializeExtensions, ...options } as any);
  out = out.replace(/\n+$/, '');
  if (eol === '\r\n') out = out.replace(/\n/g, '\r\n');
  return out;
}

// ---------------------------------------------------------------------------
// Top-level serialize
// ---------------------------------------------------------------------------

export function serializeDoc(doc: PMNode, opts: SerializeOpts = {}): string {
  const useHints = opts.useHints ?? true;
  const forceReserialize = opts.forceReserialize ?? false;
  const noSplice = opts.noSplice ?? false;
  const semanticLineBreaks = opts.semanticLineBreaks ?? false;
  const trace = opts.trace;

  // Perf (brief 04): no `clearParseBlockCache()` here any more -- `parseBlock`'s
  // cache (keyed by the exact ctx+src content) now persists across calls so a
  // save/export that touches one block reuses every other block's isolation
  // re-parse from the previous call instead of paying it again. See that
  // cache's own comment in parse.ts for the full reasoning and the LRU bound.

  const eol: '\n' | '\r\n' = doc.attrs.eol === '\r\n' ? '\r\n' : '\n';
  const ctx = buildDefsContextFromDoc(doc);
  const style = detectDocStyle(doc);

  let currentIndex = 0;
  function emit(block: PMNode): string {
    // Opaque source blocks are their own source: emit the text as is.
    if (block.type.name === 'raw_block' && !forceReserialize) {
      const src = block.attrs.src as string | null;
      const text = block.textContent;
      const out = src != null && text === src ? src : text;
      trace?.({ kind: src != null && text === src ? 'verbatim' : 'opaque-edit', type: block.type.name, text: out });
      return out;
    }
    if (!forceReserialize) {
      const src = block.attrs.src as string | null;
      if (src != null) {
        let reparsed: PMNode | undefined;
        let reparsedCount = 0;
        try {
          const r = parseBlock(src, ctx);
          reparsed = r.node;
          reparsedCount = r.count;
        } catch {
          reparsed = undefined;
        }
        if (reparsed && reparsedCount === 1 && semanticEq(reparsed, block)) {
          trace?.({ kind: 'verbatim', type: block.type.name, text: src });
          return src;
        }
        if (!noSplice) {
          let spliced: string | null = null;
          try {
            spliced = trySplice(block, src, ctx, style);
          } catch {
            spliced = null;
          }
          if (spliced != null) {
            trace?.({ kind: 'splice', type: block.type.name, text: spliced });
            return spliced;
          }
          let tbSpliced: string | null = null;
          if (!opts.noTextblockSplice) {
            try {
              tbSpliced = tryTextblockSplice(block, src, ctx, style, semanticLineBreaks);
            } catch {
              tbSpliced = null;
            }
          }
          if (tbSpliced != null) {
            trace?.({ kind: 'textblock-splice', type: block.type.name, text: tbSpliced });
            return tbSpliced;
          }
        }
      }
    }

    const result = reserializeBlock(block, style, useHints, eol, semanticLineBreaks);
    let verified = false;
    try {
      const r = parseBlock(result, ctx);
      verified = r.count === 1 && semanticEq(r.node, block, { equateSoftBreaks: semanticLineBreaks });
    } catch {
      verified = false;
    }
    trace?.({ kind: verified ? 're-serialize' : 'unverified', type: block.type.name, text: result });
    if (!verified && !forceReserialize && (opts.onUnverified ?? 'throw') === 'throw') {
      throw new UnverifiedSerializationError(currentIndex, block.type.name, result);
    }
    return result;
  }

  let out = (doc.attrs.lead as string) ?? '';
  const n = doc.childCount;
  doc.forEach((block, _offset, index) => {
    currentIndex = index;
    out += emit(block);
    const gap = block.attrs.gap as string | null;
    if (gap != null) out += gap;
    else out += index === n - 1 ? eol : eol + eol;
  });
  return out;
}
