// Origin: adapted from spike 3 (daemon-file-sync-fork-import), branch
// spike/2026-09-27-daemon-file-sync, commit 9343b62, src/core/docsync.ts
// (DocSync.renderDetailed). That method mixed a Yjs read (yDocToDoc) with
// pure PM-doc serialization logic; this module keeps only the serialization
// half, which needs nothing but a ProseMirror doc. src/crdt/render.ts reads
// the CrdtDoc into a PMNode and calls this.
//
// Best effort plus a flag on the block (D9): never refuses to render, never
// silently changes meaning. A block whose serialization does not verify is
// emitted as the serializer's best effort and listed in `degraded`.
// Serialization is verified per block in isolation, which is not
// compositional (an unclosed fence can swallow what follows, or a last
// block's dropped gap can merge it with an appended one); `boundaryRepairs`
// counts how many times the repair loop below fixed a composition mismatch
// by widening a gap or dropping a `src` (up to 8 attempts), and `composed`
// reports whether the output's top-level block count matches the doc's
// after those repairs.
import { Node as PMNode } from 'prosemirror-model';
import { parseMarkdown, parseMdast } from './parse.js';
import { serializeDoc } from './serialize.js';
import { semanticEq } from './compare.js';

export interface RenderResult {
  text: string;
  /** Indexes of top-level blocks whose serialization did not verify (best effort emitted). */
  degraded: number[];
  /** Number of boundary-repair attempts the loop below made. */
  boundaryRepairs: number;
  /** Whether the final output's top-level block count matches doc.childCount. */
  composed: boolean;
}

/** Render a ProseMirror doc to Markdown text, best effort plus a degraded/boundary-repair report. */
export function renderDoc(doc: PMNode): RenderResult {
  const degraded: number[] = [];
  const serialize = (d: PMNode) => {
    degraded.length = 0;
    let index = -1;
    return serializeDoc(d, {
      onUnverified: 'emit',
      trace: (info) => {
        index++;
        if (info.kind === 'unverified') degraded.push(index);
      },
    });
  };
  let out = serialize(doc);
  let boundaryRepairs = 0;
  const blankGap = doc.attrs.eol === '\r\n' ? '\r\n\r\n' : '\n\n';
  const tried = new Set<string>();
  let topLevelCount = parseMdast(out).children.length;
  while (topLevelCount !== doc.childCount && boundaryRepairs < 8) {
    const reparsed = parseMarkdown(out).doc;
    let i = 0;
    while (i < doc.childCount && i < reparsed.childCount && semanticEq(doc.child(i), reparsed.child(i))) i++;
    let at = -1;
    let replacement: PMNode | undefined;
    for (const [kind, k] of [
      ['gap', i],
      ['gap', i - 1],
      ['src', i - 1],
      ['src', i],
    ] as const) {
      if (k < 0 || k >= doc.childCount || tried.has(`${kind}:${k}`)) continue;
      const node = doc.child(k);
      tried.add(`${kind}:${k}`);
      if (kind === 'gap' && k < doc.childCount - 1 && !/\r?\n[ \t]*\r?\n/.test((node.attrs.gap as string | null) ?? '')) {
        replacement = node.type.create({ ...node.attrs, gap: blankGap }, node.content, node.marks);
      } else if (kind === 'src' && node.attrs.src != null) {
        replacement = node.type.create({ ...node.attrs, src: null }, node.content, node.marks);
      } else {
        continue;
      }
      at = k;
      break;
    }
    if (!replacement) break;
    const children: PMNode[] = [];
    doc.forEach((c, _o, idx) => children.push(idx === at ? replacement! : c));
    doc = doc.type.create(doc.attrs, children, doc.marks);
    out = serialize(doc);
    boundaryRepairs++;
    topLevelCount = parseMdast(out).children.length;
  }
  const composed = topLevelCount === doc.childCount;
  return { text: out, degraded: [...degraded], boundaryRepairs, composed };
}
