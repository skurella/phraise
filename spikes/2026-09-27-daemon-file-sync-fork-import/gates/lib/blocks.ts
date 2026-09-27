// Brief 03 task 2, gate A: "the top-level blocks of the file, split with
// `parseMarkdown` `src` attributes [i.e. its position spans], are identical
// to the previous file's except the one holding the new token." `parseMarkdown`'s
// `positions` option (see src/md/parse.ts) already returns one `BlockPos` per
// top-level node with its own mdast source span; this just slices the text by
// those spans.
import { parseMarkdown } from '../../src/md/index.js';

export interface TopLevelBlock {
  index: number;
  start: number;
  end: number;
  text: string;
}

/** The document's top-level blocks, each as its own source-text slice, in document order. */
export function topLevelBlocks(text: string): TopLevelBlock[] {
  const { positions } = parseMarkdown(text, { positions: true });
  const pos = positions ?? [];
  return pos.map((p, index) => ({ index, start: p.source[0], end: p.source[1], text: text.slice(p.source[0], p.source[1]) }));
}

/**
 * Compares two texts' top-level blocks. Returns the indices of blocks that differ
 * (by content) between `before` and `after`. Block *count* mismatches (an edit that
 * added/removed a top-level block) are reported as a single synthetic index `-1` so
 * the caller can tell "shape changed" apart from "some block's content changed".
 */
export function diffingTopLevelBlocks(before: string, after: string): number[] {
  const a = topLevelBlocks(before);
  const b = topLevelBlocks(after);
  if (a.length !== b.length) return [-1];
  const out: number[] = [];
  for (let i = 0; i < a.length; i++) {
    if (a[i].text !== b[i].text) out.push(i);
  }
  return out;
}
