// Plan section 3 point 5 (anchors) and the brief's "the plain-text
// projection for anchors must be defined once in src/crdt/ and used
// consistently by anchor creation, fuzzy matching and resolution".
// Generalizes spike 2's `docPlainText`/`offsetToPosition`
// (collab-stack-yjs13-hocuspocus, branch spike/2026-09-27-collab-stack,
// commit eeb3fe2, src/rebase/text.ts -- itself spike 2's), which assumed one
// XmlText per textblock, to the full schema: several text runs and inline
// atoms per textblock.
//
// Projection: every textblock's content, in document order, joined with
// "\n" between blocks; within a block, each visible Y.XmlText run
// contributes its plain text and each inline-atom Y.XmlElement (image,
// hard_break, raw_inline) contributes exactly one placeholder character
// (U+FFFC OBJECT REPLACEMENT CHARACTER, the conventional placeholder for an
// embedded non-text object). An empty textblock contributes nothing to the
// text but still occupies an anchorable position (its own "before any
// children" slot).
//
// Anchors are opaque, serializable values: base64 of `Y.encodeRelativePosition`
// (not JSON -- "base64 of an encoded RelativePosition" per plan section 3
// point 5). A position inside a text run anchors via
// `createRelativePositionFromTypeIndex(xmlText, charIndex, assoc)`; a
// position at or adjacent to an inline atom, or in an empty block, anchors
// via the SAME primitive but against the block's own XmlElement with a
// child-index (Y's array-like indexing for XmlFragment/XmlElement), since
// there is no XmlText to index there.
import * as Y from 'yjs';
import { FRAGMENT_NAME } from './codec.js';
import { isTextblockName } from './blocks.js';

/** U+FFFC OBJECT REPLACEMENT CHARACTER: one placeholder char per inline atom in the plain-text projection. */
export const ATOM_PLACEHOLDER = '￼';

type Segment =
  | { kind: 'text'; start: number; end: number; xmlText: Y.XmlText }
  | { kind: 'atom'; start: number; end: number; container: Y.XmlElement; childIndex: number }
  | { kind: 'empty'; start: number; end: number; container: Y.XmlElement; childIndex: 0 };

interface Projection {
  text: string;
  segments: Segment[];
  /** Each textblock element's own [start, end) in `text`, for mapping a resolved container-level position back to a global offset. */
  blockOf: Map<Y.XmlElement, { start: number; end: number }>;
}

function plainTextOf(yText: Y.XmlText): string {
  return (yText.toDelta() as any[]).map((d) => d.insert).join('');
}

function buildProjection(doc: Y.Doc): Projection {
  const root = doc.getXmlFragment(FRAGMENT_NAME);
  const segments: Segment[] = [];
  const blockOf = new Map<Y.XmlElement, { start: number; end: number }>();
  const parts: string[] = [];
  let offset = 0;
  let sawBlock = false;

  function visit(container: Y.XmlFragment | Y.XmlElement): void {
    for (const child of container.toArray()) {
      if (!(child instanceof Y.XmlElement)) continue;
      if (isTextblockName(child.nodeName)) {
        if (sawBlock) {
          parts.push('\n');
          offset += 1;
        }
        sawBlock = true;
        const blockStart = offset;
        const kids = child.toArray();
        if (kids.length === 0) {
          segments.push({ kind: 'empty', start: offset, end: offset, container: child, childIndex: 0 });
        }
        kids.forEach((k, i) => {
          if (k instanceof Y.XmlText) {
            const text = plainTextOf(k);
            segments.push({ kind: 'text', start: offset, end: offset + text.length, xmlText: k });
            parts.push(text);
            offset += text.length;
          } else if (k instanceof Y.XmlElement) {
            segments.push({ kind: 'atom', start: offset, end: offset + 1, container: child, childIndex: i });
            parts.push(ATOM_PLACEHOLDER);
            offset += 1;
          }
        });
        blockOf.set(child, { start: blockStart, end: offset });
      } else {
        visit(child);
      }
    }
  }
  visit(root);
  return { text: parts.join(''), segments, blockOf };
}

/** The document's plain-text projection: textblocks in document order joined by "\n", inline atoms as one placeholder char each. Defined once here; engine's fuzzy quote matching and this module's own anchorAt/resolveAnchor all use it. */
export function textProjection(doc: Y.Doc): string {
  return buildProjection(doc).text;
}

function findSegment(segments: Segment[], offset: number): Segment | undefined {
  return segments.find((s) => offset >= s.start && offset <= s.end);
}

/**
 * Anchor `offset` (into `textProjection(doc)`) as an opaque, serializable
 * string. `assoc` follows Yjs's convention (0: sticks to content on/after
 * the position; -1: sticks to content before it) -- callers creating a
 * comment's start use 0, its end use -1 (S2-9's convention, carried over).
 */
export function anchorAt(doc: Y.Doc, offset: number, assoc: number): string {
  const { segments, text } = buildProjection(doc);
  if (offset < 0 || offset > text.length) throw new Error(`anchorAt: offset ${offset} out of bounds [0, ${text.length}]`);
  const seg = findSegment(segments, offset);
  if (!seg) throw new Error('anchorAt: document has no textblocks to anchor against');

  let rel: Y.RelativePosition;
  if (seg.kind === 'text') {
    rel = Y.createRelativePositionFromTypeIndex(seg.xmlText, offset - seg.start, assoc);
  } else if (seg.kind === 'empty') {
    rel = Y.createRelativePositionFromTypeIndex(seg.container, 0, assoc);
  } else {
    // 'atom': offset === seg.start (before the atom) or seg.end (after it).
    const idx = seg.childIndex + (offset > seg.start ? 1 : 0);
    rel = Y.createRelativePositionFromTypeIndex(seg.container, idx, assoc);
  }
  return Buffer.from(Y.encodeRelativePosition(rel)).toString('base64');
}

/**
 * Resolve a previously-created anchor against `doc`'s CURRENT state, as a
 * global offset into the current `textProjection(doc)`. `null` if the
 * anchored content is no longer visible (deleted, or its containing
 * textblock was deleted) -- the caller falls back to fuzzy quote matching.
 */
export function resolveAnchor(doc: Y.Doc, anchor: string): number | null {
  const rel = Y.decodeRelativePosition(new Uint8Array(Buffer.from(anchor, 'base64')));
  const abs = Y.createAbsolutePositionFromRelativePosition(rel, doc);
  if (!abs) return null;
  const { segments, blockOf } = buildProjection(doc);

  if (abs.type instanceof Y.XmlText) {
    const seg = segments.find((s): s is Extract<Segment, { kind: 'text' }> => s.kind === 'text' && s.xmlText === abs.type);
    if (!seg) return null;
    return seg.start + Math.max(0, Math.min(abs.index, seg.end - seg.start));
  }
  if (abs.type instanceof Y.XmlElement) {
    const block = blockOf.get(abs.type);
    if (!block) return null;
    const kids = abs.type.toArray();
    let local = 0;
    for (let i = 0; i < Math.min(abs.index, kids.length); i++) {
      const k = kids[i];
      local += k instanceof Y.XmlText ? plainTextOf(k).length : 1;
    }
    return block.start + local;
  }
  return null;
}
