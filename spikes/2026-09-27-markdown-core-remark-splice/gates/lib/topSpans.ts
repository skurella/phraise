import { posIndex } from './words.js';
import type { ParsedFile } from './parsedFile.js';

export interface TopSpan {
  pmStart: number;
  pmEnd: number;
  startLine: number;
  endLine: number;
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
