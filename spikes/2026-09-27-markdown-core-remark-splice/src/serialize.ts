// PM doc -> markdown. See brief 02 design: verbatim, splice, re-serialize.
import { Node as PMNode, Mark } from 'prosemirror-model';
import { toMarkdown } from 'mdast-util-to-markdown';
import { gfmToMarkdown } from 'mdast-util-gfm';
import { frontmatterToMarkdown } from 'mdast-util-frontmatter';
import { mathToMarkdown } from 'mdast-util-math';
import { parseBlock, parseMdast, buildDefsContextFromDoc, clearParseBlockCache, type TextRun } from './parse.js';
import { semanticEq } from './compare.js';
import { detectStyle, type Style } from './style.js';
import { isMetaAttrName } from './schema.js';

export interface TraceInfo {
  kind: 'verbatim' | 'splice' | 're-serialize' | 'unverified';
  type: string;
}

export interface SerializeOpts {
  useHints?: boolean;
  forceReserialize?: boolean;
  noSplice?: boolean;
  trace?: (info: TraceInfo) => void;
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

function trySplice(block: PMNode, src: string, ctx: string): string | null {
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

  const newFrag = block.content.cut(start, endNew);
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
  const eAbs = start === endOld ? sAbs : sourceOffsetAt(run, endOld - run.from);
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
      return { type: 'link', url: mark.attrs.href ?? '', title: mark.attrs.title ?? null, children: [] };
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
      return { type: 'break' };
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
      return { type: 'html', value: node.attrs.value };
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
    let common = 0;
    while (common < marks.length && common < markStack.length && marksGroupEq(marks[common], markStack[common])) common++;
    while (markStack.length > common) {
      markStack.pop();
      containerStack.pop();
    }
    for (let i = common; i < marks.length; i++) {
      const wrapper = mdastWrapperFor(marks[i]);
      containerStack[containerStack.length - 1].push(wrapper);
      markStack.push(marks[i]);
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

function reserializeBlock(block: PMNode, style: Style, useHints: boolean, eol: '\n' | '\r\n'): string {
  const mdastNode = pmBlockToMdast(block);
  const options = optionsFor(block, style, useHints);
  let out = toMarkdown(mdastNode, { extensions: toMarkdownExtensions, ...options } as any);
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
  const trace = opts.trace;

  clearParseBlockCache();

  const eol: '\n' | '\r\n' = doc.attrs.eol === '\r\n' ? '\r\n' : '\n';
  const ctx = buildDefsContextFromDoc(doc);
  const style = detectDocStyle(doc);

  function emit(block: PMNode): string {
    // Opaque source blocks are their own source: emit the text as is.
    if (block.type.name === 'raw_block' && !forceReserialize) {
      const src = block.attrs.src as string | null;
      const text = block.textContent;
      trace?.({ kind: src != null && text === src ? 'verbatim' : 'opaque-edit', type: block.type.name });
      return src != null && text === src ? src : text;
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
          trace?.({ kind: 'verbatim', type: block.type.name });
          return src;
        }
        if (!noSplice) {
          let spliced: string | null = null;
          try {
            spliced = trySplice(block, src, ctx);
          } catch {
            spliced = null;
          }
          if (spliced != null) {
            trace?.({ kind: 'splice', type: block.type.name });
            return spliced;
          }
        }
      }
    }

    const result = reserializeBlock(block, style, useHints, eol);
    let verified = false;
    try {
      const r = parseBlock(result, ctx);
      verified = r.count === 1 && semanticEq(r.node, block);
    } catch {
      verified = false;
    }
    trace?.({ kind: verified ? 're-serialize' : 'unverified', type: block.type.name });
    return result;
  }

  let out = (doc.attrs.lead as string) ?? '';
  const n = doc.childCount;
  doc.forEach((block, _offset, index) => {
    out += emit(block);
    const gap = block.attrs.gap as string | null;
    if (gap != null) out += gap;
    else out += index === n - 1 ? eol : eol + eol;
  });
  return out;
}
