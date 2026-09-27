// Brief 06 (comments, gate F), task 1/2: a plain-text projection of a
// ProseMirror document, with a two-way mapping between a PM position and an
// offset into the projected text.
//
// Spike 2's own comment anchoring (`src/rebase/comments.ts` /
// `src/rebase/text.ts` at `origin/spike/2026-09-27-collab-stack`,
// `eeb3fe2`) built this over the raw `Y.XmlFragment` tree directly
// (`docPlainText`/`offsetToPosition`), because its toy schema guaranteed
// exactly one `Y.XmlText` child per textblock. This editor's real schema
// does not: a textblock's inline content can mix `Y.XmlText` runs with
// sibling `Y.XmlElement` inline atoms (`image`, `hard_break`, `raw_inline`),
// and non-textblock containers nest arbitrarily (`list_item > paragraph`,
// `table_cell`, `blockquote`). Walking a ProseMirror `Node` tree instead
// (`doc.descendants`) is far simpler to get right: a `NodeType`'s own
// `isTextblock`/`isText`/`isLeaf` already answer exactly the questions
// spike 2 had to answer by hand against Yjs internals.
import type { Node as PMNode } from 'prosemirror-model';

/** Textblocks are joined by this separator in the projected text, so a
 * quote/prefix/suffix selector never silently spans a block boundary with
 * no visible gap (spike 2's schema joined textblocks with a single `\n`;
 * this uses two so it does not collide with a `hard_break`'s own single
 * placeholder character appearing adjacent to a block boundary). */
export const BLOCK_SEPARATOR = '\n\n';

/** One inline atom (image, hard_break, raw_inline) is represented by this
 * single placeholder character in the projected text, keeping the
 * projection's offsets advancing exactly 1 per PM position step, same as a
 * real character. U+FFFC is the Unicode "object replacement character",
 * the conventional choice for "there is a non-text thing here". */
export const ATOM_PLACEHOLDER = '￼';

export interface TextRun {
  /** Offset into the projected text where this run's first character sits. */
  offset: number;
  /** PM position of this run's first character (i.e. `pos` such that `doc.resolve(pos)` sits just before it). */
  pos: number;
  /** The run's own text: either a text node's real characters, or one `ATOM_PLACEHOLDER`. */
  text: string;
}

export interface DocTextProjection {
  text: string;
  /** Ascending by both `offset` and `pos` (document order). */
  runs: TextRun[];
}

/** Project a ProseMirror document to plain text plus a run table for
 * offset<->position conversion. Recomputed fresh from whatever `doc` is
 * passed in -- cheap enough at spike scale to redo on every resolution
 * rather than maintain incrementally. */
export function projectDocText(doc: PMNode): DocTextProjection {
  const runs: TextRun[] = [];
  let text = '';
  let sawTextblock = false;

  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true; // recurse into block containers (list_item, blockquote, table_row, table, doc itself)

    if (sawTextblock) text += BLOCK_SEPARATOR;
    sawTextblock = true;

    let innerPos = pos + 1; // position of this textblock's first child
    node.forEach((child) => {
      if (child.isText) {
        const t = child.text ?? '';
        if (t.length > 0) runs.push({ offset: text.length, pos: innerPos, text: t });
        text += t;
      } else {
        // Inline atom: image, hard_break, raw_inline. Always nodeSize 1.
        runs.push({ offset: text.length, pos: innerPos, text: ATOM_PLACEHOLDER });
        text += ATOM_PLACEHOLDER;
      }
      innerPos += child.nodeSize;
    });

    return false; // this textblock's children are already handled above; don't recurse into them again
  });

  return { text, runs };
}

/** Convert a PM position to an offset into `projection.text`. Returns null
 * if `pos` does not fall inside any run's own span (e.g. it points at a
 * block boundary/structural position rather than inline content). */
export function posToOffset(projection: DocTextProjection, pos: number): number | null {
  const { runs } = projection;
  // Runs are in ascending pos order; linear scan is fine at spike scale.
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    const runEndPos = run.pos + run.text.length;
    if (pos >= run.pos && pos <= runEndPos) {
      return run.offset + (pos - run.pos);
    }
  }
  return null;
}

/** Convert an offset into `projection.text` back to a PM position. Returns
 * null for an offset that falls inside `BLOCK_SEPARATOR` (not a real
 * position) or outside the text entirely. */
export function offsetToPos(projection: DocTextProjection, offset: number): number | null {
  const { runs } = projection;
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    const runEndOffset = run.offset + run.text.length;
    if (offset >= run.offset && offset <= runEndOffset) {
      return run.pos + (offset - run.offset);
    }
  }
  return null;
}
