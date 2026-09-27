// Gate B eligible-word selection. See brief 03: "maximal /[A-Za-z]{3,}/
// matches inside text nodes of paragraph nodes at any depth (inside lists
// and blockquotes too), where the text node has no code mark and the
// characters immediately before and after the match in the paragraph's
// textContent are not letters, digits or _."
import { Node as PMNode } from 'prosemirror-model';
import type { BlockPos } from '../../src/index.js';

export interface EligibleWord {
  /** Absolute PM position range of the match, in the (pre-edit) doc. */
  from: number;
  to: number;
  word: string;
  /** The enclosing paragraph's own PM start position. */
  paragraphPmStart: number;
}

const WORD_RE = /[A-Za-z]{3,}/g;
const BOUNDARY_RE = /[A-Za-z0-9_]/;

/** Eligible words inside one paragraph node, as PM positions relative to the paragraph's own start. */
function eligibleWordsInParagraph(para: PMNode): { from: number; to: number; word: string }[] {
  const full = para.textContent;
  const results: { from: number; to: number; word: string }[] = [];
  let charOffset = 0;
  let pmOffset = 0;
  para.forEach((child) => {
    if (child.isText) {
      const text = child.text ?? '';
      const hasCode = child.marks.some((m) => m.type.name === 'code');
      if (!hasCode) {
        WORD_RE.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = WORD_RE.exec(text))) {
          const startInFull = charOffset + m.index;
          const endInFull = startInFull + m[0].length;
          const before = startInFull > 0 ? full[startInFull - 1] : '';
          const after = endInFull < full.length ? full[endInFull] : '';
          if (!BOUNDARY_RE.test(before) && !BOUNDARY_RE.test(after)) {
            results.push({ from: pmOffset + m.index, to: pmOffset + m.index + m[0].length, word: m[0] });
          }
        }
      }
      charOffset += text.length;
      pmOffset += child.nodeSize;
    } else {
      charOffset += child.textContent.length;
      pmOffset += child.nodeSize;
    }
  });
  return results;
}

/** Every eligible word in the whole doc, across paragraphs at any depth, in document order. */
export function findEligibleWords(doc: PMNode): EligibleWord[] {
  const out: EligibleWord[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== 'paragraph') return true;
    const words = eligibleWordsInParagraph(node);
    for (const w of words) {
      out.push({ from: pos + 1 + w.from, to: pos + 1 + w.to, word: w.word, paragraphPmStart: pos });
    }
    return false; // paragraph content is inline-only; no need to descend further
  });
  return out;
}

export function replacementFor(word: string): string {
  return word.toLowerCase() === 'zebra' ? 'quokka' : 'zebra';
}

/** Look up a BlockPos entry by its node's PM start position. */
export function posIndex(positions: BlockPos[]): Map<number, BlockPos> {
  return new Map(positions.map((p) => [p.pmStart, p]));
}
