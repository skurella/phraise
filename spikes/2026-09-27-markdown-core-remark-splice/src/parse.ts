import { semanticEq } from './compare.js';
// Markdown -> ProseMirror doc. See brief 02 design.
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';
import remarkMath from 'remark-math';
import { Node as PMNode, Fragment, Mark } from 'prosemirror-model';
import { schema } from './schema.js';

export interface BlockPos {
  /** PM position (doc-relative) where this block node starts. */
  pmStart: number;
  /**
   * This node's own mdast source span [startOffset, endOffset) -- not the
   * enclosing top-level block's span. For a top-level node these coincide
   * (module the lead-indentation "hug" and gap-folding adjustments below);
   * for a node nested inside a list/blockquote/etc, this is its own
   * paragraph/heading/etc range, which is what gate B needs to confirm an
   * edit's diff stayed inside the edited paragraph itself, not just inside
   * its enclosing top-level block.
   */
  source: [number, number];
  startLine: number;
  endLine: number;
}

/** A node's own mdast position, recorded during mdast->PM conversion. */
interface NodePosInfo {
  startLine: number;
  endLine: number;
  startOffset: number;
  endOffset: number;
}

/** Per-doc-parse side table: PM node identity -> its own mdast position. */
type BlockPosMap = WeakMap<PMNode, NodePosInfo>;

function recordPos(posMap: BlockPosMap | undefined, pmNode: PMNode, mdastNode: any): void {
  if (!posMap || !mdastNode?.position) return;
  posMap.set(pmNode, {
    startLine: mdastNode.position.start.line,
    endLine: mdastNode.position.end.line,
    startOffset: mdastNode.position.start.offset,
    endOffset: mdastNode.position.end.offset,
  });
}

export interface ParseResult {
  doc: PMNode;
  positions?: BlockPos[];
}

export interface ParseOpts {
  positions?: boolean;
}

let cachedProcessor: any;
function getProcessor(): any {
  if (!cachedProcessor) {
    cachedProcessor = unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkFrontmatter, ['yaml', 'toml'])
      .use(remarkMath);
  }
  return cachedProcessor;
}

/** Parse markdown into an mdast tree (exported for style.ts / tests). */
export function parseMdast(md: string): any {
  return getProcessor().parse(md);
}

export function detectEol(md: string): '\n' | '\r\n' {
  let crlf = 0;
  let total = 0;
  for (let i = 0; i < md.length; i++) {
    if (md[i] === '\n') {
      total++;
      if (i > 0 && md[i - 1] === '\r') crlf++;
    }
  }
  const lfOnly = total - crlf;
  return crlf > lfOnly ? '\r\n' : '\n';
}

const WHITESPACE_RE = /^[ \t\r\n\f\v]*$/;

// ---------------------------------------------------------------------------
// Text-run map (used by serialize.ts splice candidate)
// ---------------------------------------------------------------------------

export interface TextRun {
  from: number; // PM position, relative to the block node's own content
  to: number;
  literal: boolean;
  marks: readonly Mark[];
  /** Source offset for each character in [from,to); null if unmapped. */
  sourceOffsets: (number | null)[];
}

interface MapCollector {
  runs: { value: string; literal: boolean; marks: readonly Mark[]; sourceOffsets: (number | null)[] }[];
}

// ---------------------------------------------------------------------------
// Inline conversion
// ---------------------------------------------------------------------------

function emphasisMarker(node: any, source: string): string {
  return source[node.position.start.offset] ?? '*';
}
function strongMarker(node: any, source: string): string {
  return source.slice(node.position.start.offset, node.position.start.offset + 2) || '**';
}
function linkKind(node: any, source: string): string {
  if (!node.position) return 'inline';
  const raw = source.slice(node.position.start.offset, node.position.end.offset);
  if (raw.startsWith('<')) return 'autolink';
  if (raw.startsWith('[')) return 'inline';
  return 'literal';
}

/** Greedy alignment of `value` against `slice`, per brief: skip whitespace, >, \, \r in source when chars don't match. */
function alignText(value: string, slice: string, sourceBase: number): { offsets: (number | null)[]; literal: boolean } {
  const offsets: (number | null)[] = new Array(value.length).fill(null);
  let vi = 0;
  let si = 0;
  let literal = true;
  while (vi < value.length) {
    if (si < slice.length && slice[si] === value[vi]) {
      offsets[vi] = sourceBase + si;
      vi++;
      si++;
      continue;
    }
    if (si < slice.length && /[\s>\\\r]/.test(slice[si])) {
      si++;
      continue;
    }
    literal = false;
    break;
  }
  if (vi < value.length) literal = false;
  return { offsets, literal };
}

function pushText(
  out: PMNode[],
  value: string,
  marks: readonly Mark[],
  source: string,
  node: any,
  map: MapCollector | undefined,
  opts: { valueStartInSource?: number } = {}
) {
  if (value.length === 0) return;
  out.push(schema.text(value, marks as Mark[]));
  if (map) {
    let literal = false;
    let offsets: (number | null)[] = new Array(value.length).fill(null);
    if (node?.position) {
      const base = opts.valueStartInSource ?? node.position.start.offset;
      const slice = source.slice(base, node.position.end.offset);
      const aligned = alignText(value, slice, base);
      offsets = aligned.offsets;
      literal = aligned.literal;
    }
    map.runs.push({ value, literal, marks, sourceOffsets: offsets });
  }
}

/**
 * PM disallows two marks of the same type on one node. Doubly-nested
 * identical mark types (e.g. `*a *b* c*`, em-in-em) are rare but legal
 * CommonMark; collapse to a single instance (the outer one) rather than
 * crash. This loses the redundant-nesting distinction but keeps content and
 * round-trip stable, since parse and re-parse apply the same rule.
 */
function addMark(marks: readonly Mark[], m: Mark): readonly Mark[] {
  if (marks.some((x) => x.type === m.type)) return marks;
  return [...marks, m];
}

function walkInline(node: any, source: string, marks: readonly Mark[], out: PMNode[], map: MapCollector | undefined) {
  switch (node.type) {
    case 'text':
      pushText(out, node.value, marks, source, node, map);
      return;
    case 'inlineCode': {
      const codeMark = schema.marks.code.create();
      const nm = [...marks, codeMark];
      // Value starts after the opening backtick run.
      const raw = node.position ? source.slice(node.position.start.offset, node.position.end.offset) : '';
      const openMatch = /^`+/.exec(raw);
      const openLen = openMatch ? openMatch[0].length : 1;
      const base = node.position ? node.position.start.offset + openLen : undefined;
      pushText(out, node.value, nm, source, node, map, { valueStartInSource: base });
      return;
    }
    case 'emphasis': {
      const m = schema.marks.em.create({ markerHint: emphasisMarker(node, source) });
      const nm = addMark(marks, m);
      for (const child of node.children) walkInline(child, source, nm, out, map);
      return;
    }
    case 'strong': {
      const m = schema.marks.strong.create({ markerHint: strongMarker(node, source) });
      const nm = addMark(marks, m);
      for (const child of node.children) walkInline(child, source, nm, out, map);
      return;
    }
    case 'delete': {
      const m = schema.marks.strike.create();
      const nm = addMark(marks, m);
      for (const child of node.children) walkInline(child, source, nm, out, map);
      return;
    }
    case 'link': {
      const m = schema.marks.link.create({
        href: node.url ?? '',
        title: node.title ?? null,
        kindHint: linkKind(node, source),
      });
      const nm = addMark(marks, m);
      for (const child of node.children) walkInline(child, source, nm, out, map);
      return;
    }
    case 'linkReference': {
      const m = schema.marks.link.create({
        href: '',
        title: null,
        refType: node.referenceType ?? null,
        identifier: node.identifier ?? null,
        label: node.label ?? null,
        kindHint: 'reference',
      });
      const nm = addMark(marks, m);
      for (const child of node.children) walkInline(child, source, nm, out, map);
      return;
    }
    case 'image': {
      out.push(
        schema.node(
          'image',
          { url: node.url ?? '', alt: node.alt ?? '', title: node.title ?? null },
          undefined,
          marks as Mark[]
        )
      );
      return;
    }
    case 'imageReference': {
      out.push(
        schema.node(
          'image',
          {
            url: '',
            alt: node.alt ?? '',
            title: null,
            refType: node.referenceType ?? null,
            identifier: node.identifier ?? null,
            label: node.label ?? null,
          },
          undefined,
          marks as Mark[]
        )
      );
      return;
    }
    case 'break': {
      const raw = node.position ? source.slice(node.position.start.offset, node.position.end.offset) : '  \n';
      out.push(schema.node('hard_break', { breakHint: raw }, undefined, marks as Mark[]));
      return;
    }
    case 'html': {
      const value = node.position ? source.slice(node.position.start.offset, node.position.end.offset) : node.value ?? '';
      out.push(schema.node('raw_inline', { kind: 'html', value }, undefined, marks as Mark[]));
      return;
    }
    case 'inlineMath': {
      out.push(schema.node('raw_inline', { kind: 'inlineMath', value: node.value ?? '' }, undefined, marks as Mark[]));
      return;
    }
    case 'footnoteReference': {
      const value = node.position ? source.slice(node.position.start.offset, node.position.end.offset) : '';
      out.push(schema.node('raw_inline', { kind: 'footnoteReference', value }, undefined, marks as Mark[]));
      return;
    }
    default: {
      const value = node.position ? source.slice(node.position.start.offset, node.position.end.offset) : String(node.value ?? '');
      out.push(schema.node('raw_inline', { kind: node.type, value }, undefined, marks as Mark[]));
      return;
    }
  }
}

function mergeAdjacentText(nodes: PMNode[]): PMNode[] {
  const out: PMNode[] = [];
  for (const n of nodes) {
    const prev = out[out.length - 1];
    if (prev && prev.isText && n.isText && Mark.sameSet(prev.marks, n.marks)) {
      out[out.length - 1] = schema.text((prev.text ?? '') + (n.text ?? ''), n.marks as Mark[]);
    } else {
      out.push(n);
    }
  }
  return out;
}

export function inlineChildrenFromMdast(children: any[], source: string, map?: MapCollector): PMNode[] {
  const out: PMNode[] = [];
  for (const child of children ?? []) walkInline(child, source, [], out, map);
  return mergeAdjacentText(out);
}

// ---------------------------------------------------------------------------
// Block conversion
// ---------------------------------------------------------------------------

function headingHints(node: any, source: string): { setextHint: boolean; closeHint: boolean } {
  const raw = node.position ? source.slice(node.position.start.offset, node.position.end.offset) : '#';
  const firstLine = raw.split(/\r\n|\n/, 1)[0];
  const setextHint = firstLine[0] !== '#';
  if (setextHint) return { setextHint: true, closeHint: false };
  const trimmed = firstLine.replace(/[ \t]+$/, '');
  const closeHint = /(?:^|[ \t])#+$/.test(trimmed);
  return { setextHint: false, closeHint };
}

function fenceHints(node: any, source: string): { fenceHint: string; fenceLenHint: number } {
  if (node.lang == null && node.meta == null) {
    const raw = node.position ? source.slice(node.position.start.offset, node.position.end.offset) : '';
    if (!/^[`~]/.test(raw)) return { fenceHint: 'indent', fenceLenHint: 0 };
  }
  const raw = node.position ? source.slice(node.position.start.offset, node.position.end.offset) : '```';
  const m = /^(`{3,}|~{3,})/.exec(raw);
  if (!m) return { fenceHint: 'indent', fenceLenHint: 0 };
  return { fenceHint: m[1][0], fenceLenHint: m[1].length };
}

function ruleHint(node: any, source: string): string {
  return node.position ? source.slice(node.position.start.offset, node.position.end.offset) : '---';
}

function markerHintOf(node: any, source: string): string {
  // node is the mdast `list` node; look at its first item's own start.
  const item = node.children?.[0];
  const at = item?.position?.start.offset ?? node.position?.start.offset;
  return at != null ? source[at] : '-';
}

function delimHintOf(node: any, source: string): string {
  const item = node.children?.[0];
  if (!item?.position) return '.';
  const raw = source.slice(item.position.start.offset, item.position.end.offset);
  const m = /^\d+([.)])/.exec(raw);
  return m ? m[1] : '.';
}

function stripContainerIndentation(raw: string): string {
  const lines = raw.split(/\r\n|\n/);
  if (lines.length <= 1) return raw;
  let minIndent = Infinity;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '') continue;
    const m = /^[ \t]*/.exec(lines[i]);
    minIndent = Math.min(minIndent, m ? m[0].length : 0);
  }
  if (!isFinite(minIndent) || minIndent === 0) return raw;
  return [lines[0], ...lines.slice(1).map((l) => l.slice(minIndent))].join('\n');
}

export function blockFromMdast(node: any, source: string, map?: MapCollector, posMap?: BlockPosMap): PMNode {
  let result: PMNode;
  switch (node.type) {
    case 'paragraph':
      result = schema.node('paragraph', {}, inlineChildrenFromMdast(node.children, source, map));
      break;

    case 'heading': {
      const hints = headingHints(node, source);
      result = schema.node(
        'heading',
        { level: node.depth ?? 1, setextHint: hints.setextHint, closeHint: hints.closeHint },
        inlineChildrenFromMdast(node.children, source, map)
      );
      break;
    }

    case 'blockquote': {
      // CommonMark allows an empty blockquote (`>` with nothing after); our
      // schema requires blockquote content `block+`, so fill with an empty
      // paragraph placeholder (same pattern as empty list items).
      const children = node.children.map((c: any) => blockFromMdast(c, source, map, posMap));
      result = schema.node('blockquote', {}, children.length ? children : [schema.node('paragraph', {}, [])]);
      break;
    }

    case 'list': {
      const items = node.children.map((c: any) => listItemFromMdast(c, source, map, posMap));
      const tight = !node.spread;
      if (node.ordered) {
        result = schema.node(
          'ordered_list',
          { start: node.start ?? 1, tight, delimHint: delimHintOf(node, source) },
          items
        );
      } else {
        result = schema.node('bullet_list', { tight, markerHint: markerHintOf(node, source) }, items);
      }
      break;
    }

    case 'code': {
      const hints = fenceHints(node, source);
      const text = node.value ? [schema.text(node.value)] : [];
      result = schema.node(
        'code_block',
        { lang: node.lang ?? null, meta: node.meta ?? null, fenceHint: hints.fenceHint, fenceLenHint: hints.fenceLenHint },
        text
      );
      break;
    }

    case 'thematicBreak':
      result = schema.node('horizontal_rule', { ruleHint: ruleHint(node, source) });
      break;

    case 'table': {
      const align = node.align ?? [];
      const rows = node.children.map((row: any, ri: number) => {
        const cells = row.children.map((cell: any) => {
          const cellNode = schema.node('table_cell', {}, inlineChildrenFromMdast(cell.children, source, map));
          recordPos(posMap, cellNode, cell);
          return cellNode;
        });
        const rowNode = schema.node('table_row', { header: ri === 0 }, cells);
        recordPos(posMap, rowNode, row);
        return rowNode;
      });
      result = schema.node('table', { align }, rows);
      break;
    }

    case 'html':
    case 'yaml':
    case 'toml':
    case 'math':
    case 'definition':
    case 'footnoteDefinition': {
      const kind = node.type;
      let text: string;
      // The text of an opaque block is its Markdown source, including fences
      // and delimiters (`---` for yaml, `$$` for math), so that editing it as
      // source and emitting it verbatim is lossless. Only html uses the parser's
      // value, because for nested html that already has container prefixes removed.
      if (node.type === 'html' && typeof node.value === 'string') {
        text = node.value;
      } else {
        const raw = node.position ? source.slice(node.position.start.offset, node.position.end.offset) : '';
        text = stripContainerIndentation(raw);
      }
      result = schema.node('raw_block', { kind }, text ? [schema.text(text)] : []);
      break;
    }

    default: {
      const raw = node.position ? source.slice(node.position.start.offset, node.position.end.offset) : '';
      const text = stripContainerIndentation(raw);
      result = schema.node('raw_block', { kind: node.type }, text ? [schema.text(text)] : []);
      break;
    }
  }
  recordPos(posMap, result, node);
  return result;
}

function listItemFromMdast(node: any, source: string, map?: MapCollector, posMap?: BlockPosMap): PMNode {
  const checked = node.checked === true ? true : node.checked === false ? false : null;
  const children = (node.children ?? []).map((c: any) => blockFromMdast(c, source, map, posMap));
  const result = schema.node('list_item', { checked }, children.length ? children : [schema.node('paragraph', {}, [])]);
  recordPos(posMap, result, node);
  return result;
}

function withAttrs(node: PMNode, extra: Record<string, unknown>): PMNode {
  return node.type.create({ ...node.attrs, ...extra }, node.content, node.marks);
}

// ---------------------------------------------------------------------------
// Context (link/footnote definitions) for isolation parsing
// ---------------------------------------------------------------------------

/** Build the definitions context string from a full document's mdast root. */
export function buildDefsContext(mdastRoot: any, source: string): string {
  let ctx = '';
  const walk = (node: any) => {
    if (node.type === 'definition' || node.type === 'footnoteDefinition') {
      if (node.position) {
        ctx += source.slice(node.position.start.offset, node.position.end.offset) + '\n\n';
      }
    }
    if (node.children) for (const c of node.children) walk(c);
  };
  walk(mdastRoot);
  return ctx;
}

/** Build the definitions context string from a doc's raw_blocks (for serialization time). */
export function buildDefsContextFromDoc(doc: PMNode): string {
  let ctx = '';
  doc.descendants((node) => {
    if (node.type.name === 'raw_block' && (node.attrs.kind === 'definition' || node.attrs.kind === 'footnoteDefinition')) {
      ctx += node.textContent + '\n\n';
    }
    return true;
  });
  return ctx;
}

export interface ParseBlockResult {
  node: PMNode;
  map?: TextRun[];
  /** Number of top-level blocks the source parsed into; anything but 1 means the block is not self-describing. */
  count: number;
}

const parseBlockCache = new Map<string, ParseBlockResult>();
// Perf: parseBlock is called once per top-level block (self-description check
// at parse time, splice/verify at serialize time), always with the same `ctx`
// string for a given document. Re-parsing `ctx` alone just to count how many
// top-level nodes it produces (`skip`) was O(blocks) reparses of the same
// text; cache it by content so it is paid once per distinct ctx, not once per
// block. On a large real-world file with many link/footnote definitions and
// many blocks this was the dominant cost (see builder log, gate harness
// profiling, 2026-09-27).
const ctxSkipCache = new Map<string, number>();

export function clearParseBlockCache(): void {
  parseBlockCache.clear();
  ctxSkipCache.clear();
}

/**
 * Parse a single top-level block's source in isolation, using `ctx`
 * (concatenated definitions, each followed by a blank line) prepended so
 * link/footnote references resolve as they did in the full document.
 */
export function parseBlock(src: string, ctx: string, opts?: { map?: boolean }): ParseBlockResult {
  // Perf: link references (`[text][id]`, `[text]`), image references
  // (`![alt][id]`) and footnote references (`[^id]`) all require a literal
  // `[` in the source. A block with no `[` cannot resolve against `ctx` no
  // matter its content, so skip prepending it entirely: this avoids
  // reparsing `ctx + src` (often much larger than `src` alone) for the
  // common case of a plain paragraph/heading/etc. Restricted to the
  // no-map path: the map's sourceOffsets are relative to `ctx + src`
  // (serialize.ts's trySplice subtracts `ctx.length` to get a src-relative
  // offset), so the map path must always parse against the real `ctx` to
  // keep that arithmetic correct.
  const effectiveCtx = !opts?.map && ctx.length > 0 && !src.includes('[') ? '' : ctx;

  const cacheKey = (opts?.map ? 'M\u0000' : 'N\u0000') + effectiveCtx + '\u0000' + src;
  const cached = parseBlockCache.get(cacheKey);
  if (cached) return cached;

  const full = effectiveCtx + src;
  const tree = parseMdast(full);
  let skip = 0;
  if (effectiveCtx.length > 0) {
    const existing = ctxSkipCache.get(effectiveCtx);
    if (existing !== undefined) {
      skip = existing;
    } else {
      const ctxTree = parseMdast(effectiveCtx);
      const count: number = ctxTree.children.length;
      ctxSkipCache.set(effectiveCtx, count);
      skip = count;
    }
  }
  const remaining = tree.children.slice(skip);
  const mapCollector: MapCollector | undefined = opts?.map ? { runs: [] } : undefined;

  let node: PMNode;
  if (remaining.length === 0) {
    node = schema.node('paragraph', {}, []);
  } else if (remaining.length === 1) {
    node = blockFromMdast(remaining[0], full, mapCollector);
  } else {
    // Shouldn't normally happen for a single top-level block's src, but be
    // defensive: wrap as the first node type would be wrong, so just take
    // the first and note the rest are lost (isolation parse instability).
    node = blockFromMdast(remaining[0], full, mapCollector);
  }

  let map: TextRun[] | undefined;
  if (mapCollector) {
    map = [];
    let i = 0;
    node.descendants((n, pos) => {
      if (n.isText) {
        const info = mapCollector.runs[i++];
        if (info) {
          map!.push({ from: pos, to: pos + n.nodeSize, literal: info.literal, marks: info.marks, sourceOffsets: info.sourceOffsets });
        }
      }
      return true;
    });
  }

  const result: ParseBlockResult = { node, map, count: remaining.length };
  parseBlockCache.set(cacheKey, result);
  return result;
}

// ---------------------------------------------------------------------------
// Top-level document parse
// ---------------------------------------------------------------------------

export function parseMarkdown(md: string, opts: ParseOpts = {}): ParseResult {
  const eol = detectEol(md);
  const tree = parseMdast(md);
  const children: any[] = tree.children ?? [];

  if (children.length === 0) {
    const doc = schema.node('doc', { lead: md, eol }, [schema.node('paragraph', {}, [])]);
    return opts.positions ? { doc, positions: [] } : { doc };
  }

  // Indentation-sensitive constructs (list nesting depth, fenced-code content
  // stripping) are parsed relative to a block's own column, which mdast
  // position offsets do not include (they start right at the first
  // significant character, e.g. `-` or backtick, never at earlier
  // same-line spaces/tabs). If that leading indentation is left in the
  // previous block's gap (or `lead`), re-parsing this block's `src` in
  // isolation sees a different column than the full-document parse did,
  // which can change list nesting or fence-indent stripping and make the
  // isolation reparse diverge from the original structurally (verbatim
  // fails spuriously). Fix: "hug" any pure horizontal-whitespace prefix on
  // the block's own first line into `src` instead of `lead`/`gap`.
  function lineStartOf(offset: number): number {
    let i = offset;
    while (i > 0 && md[i - 1] !== '\n') i--;
    return i;
  }
  function hugLineIndent(offset: number): number {
    const ls = lineStartOf(offset);
    return /^[ \t]*$/.test(md.slice(ls, offset)) ? ls : offset;
  }

  const lead = md.slice(0, hugLineIndent(children[0].position.start.offset));
  const blocks: PMNode[] = [];
  const rawSpans: [number, number][] = [];
  const rawLines: [number, number][] = [];
  const gaps: string[] = [];
  const posMap: BlockPosMap | undefined = opts.positions ? new WeakMap() : undefined;

  // Rare micromark/mdast quirk: a link/footnote definition immediately
  // followed (no blank line) by a setext-heading-eligible paragraph can
  // report the heading's position as starting before the definition ends
  // (both "compete" for the same span; mdast keeps both nodes). Clamp each
  // block's start to the previous block's end so spans never overlap and
  // gaps never go negative.
  let prevEnd = 0;

  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const startOff = Math.max(hugLineIndent(child.position.start.offset), prevEnd);
    let endOff = Math.max(child.position.end.offset, startOff);
    const nextStart = i + 1 < children.length ? hugLineIndent(children[i + 1].position.start.offset) : md.length;
    let gap = md.slice(endOff, Math.max(endOff, nextStart));
    const wsTrailMatch = /\s*$/.exec(gap);
    const wsStart = wsTrailMatch ? wsTrailMatch.index : gap.length;
    if (wsStart > 0 && !WHITESPACE_RE.test(gap.slice(0, wsStart))) {
      // Non-whitespace content in the gap: fold it into this block's src.
      endOff = endOff + wsStart;
      gap = gap.slice(wsStart);
    }
    const src = md.slice(startOff, endOff);
    let block = blockFromMdast(child, md, undefined, posMap);
    block = withAttrs(block, { src, gap });
    blocks.push(block);
    rawSpans.push([startOff, endOff]);
    rawLines.push([child.position.start.line, child.position.end.line]);
    prevEnd = endOff + gap.length;
    gaps.push(gap);
  }

  let doc = schema.node('doc', { lead, eol }, blocks);

  // Self-description check. A modeled block must re-parse in isolation (with
  // the document's definitions prepended) to the same node it was in context,
  // because D4's write-time compare only ever sees `src`. micromark has rare
  // context-dependent behaviour (for example an html line lazily following a
  // paragraph inside a nested list parses differently at the document start),
  // so blocks that fail the check become opaque source blocks. This makes the
  // no-edit round trip exact by construction and counts how often it happens.
  const ctx = buildDefsContextFromDoc(doc);
  let changed = false;
  const checked = blocks.map((block) => {
    const src = block.attrs.src as string;
    if (block.type.name === 'raw_block') {
      if (block.textContent === src) return block;
      changed = true;
      return schema.node('raw_block', { kind: block.attrs.kind, src, gap: block.attrs.gap }, src ? [schema.text(src)] : []);
    }
    let ok = false;
    try {
      const r = parseBlock(src, ctx);
      ok = r.count === 1 && semanticEq(r.node, block);
    } catch {
      ok = false;
    }
    if (ok) return block;
    changed = true;
    return schema.node('raw_block', { kind: 'unstable:' + block.type.name, src, gap: block.attrs.gap }, src ? [schema.text(src)] : []);
  });
  clearParseBlockCache();
  if (changed) doc = schema.node('doc', { lead, eol }, checked);

  if (!opts.positions || !posMap) return { doc };

  // Top-level nodes need an explicit override: `withAttrs` (src/gap) and the
  // self-description check (opaque replacement) both construct a new node
  // instance for the top-level block, so the position `blockFromMdast`
  // recorded against the pre-withAttrs/pre-replacement instance is orphaned.
  // Re-key it against the actual final top-level node using the block's own
  // (hug- and gap-adjusted) span, which is also what `src`/`gap` reflect.
  // Nested descendants are untouched by either step (same child fragment),
  // so their own recorded positions still resolve.
  checked.forEach((topBlock, i) => {
    const [tStart, tEnd] = rawSpans[i];
    const [tStartLine, tEndLine] = rawLines[i];
    posMap.set(topBlock, { startOffset: tStart, endOffset: tEnd, startLine: tStartLine, endLine: tEndLine });
  });

  // For every non-inline, non-text node at any depth that has a recorded
  // position, report its own mdast source span/lines (not the enclosing
  // top-level block's). A node inside a top-level block that became opaque
  // (raw_block) has no descendants left to record, so it naturally has no
  // entries -- consistent with brief 03.
  const positions: BlockPos[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === 'text' || node.isInline) return true;
    const info = posMap.get(node);
    if (info) {
      positions.push({
        pmStart: pos,
        source: [info.startOffset, info.endOffset],
        startLine: info.startLine,
        endLine: info.endLine,
      });
    }
    return true;
  });

  return { doc, positions };
}
