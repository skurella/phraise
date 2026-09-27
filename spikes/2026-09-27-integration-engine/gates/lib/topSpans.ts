// Gate E2. Origin: spike 1 (markdown-core-remark-splice), branch
// spike/2026-09-27-markdown-round-trip, commit 1e1f4a6,
// gates/lib/topSpans.ts. Retargeted: `BlockPos` comes from this spike's own
// `src/markdown/index.js` (identical shape -- spike 3 carried spike 1's
// `BlockPos` forward unchanged, and this spike's `src/markdown/parse.ts`
// is adapted from spike 3's), and `ParsedFile` is a local, gate-only type
// (this spike never ported spike 1's `gates/lib/parsedFile.ts` as a
// separate module; gate E builds it inline).
import type { Node as PMNode } from 'prosemirror-model';
import type { BlockPos } from '../../src/markdown/index.js';

export interface ParsedFile {
  doc: PMNode;
  positions: BlockPos[];
}

export interface TopSpan {
  pmStart: number;
  pmEnd: number;
  startLine: number;
  endLine: number;
}

function posIndex(positions: BlockPos[]): Map<number, BlockPos> {
  return new Map(positions.map((p) => [p.pmStart, p]));
}

/** Top-level block spans (PM range + source line range) for one parsed doc. */
export function topLevelSpans(pf: ParsedFile): TopSpan[] {
  const byStart = posIndex(pf.positions);
  const spans: TopSpan[] = [];
  pf.doc.forEach((block, offset) => {
    const info = byStart.get(offset);
    spans.push({
      pmStart: offset,
      pmEnd: offset + block.nodeSize,
      startLine: info?.startLine ?? 1,
      endLine: info?.endLine ?? 1,
    });
  });
  return spans;
}

export function containingTopIndex(spans: { pmStart: number; pmEnd: number }[], pos: number): number {
  for (let i = 0; i < spans.length; i++) {
    if (pos >= spans[i].pmStart && pos < spans[i].pmEnd) return i;
  }
  return -1;
}
