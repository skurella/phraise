// Doc plain text and offset mapping for comment selectors, ported to Yjs
// 14's unified Y.Node model.
//
// Unlike stack13 (a textblock is a Y.XmlElement wrapping a nested
// Y.XmlText), spike 2's schema has no inline atoms, so in this stack a
// textblock's own Y.Node content IS its plain text -- there is no nested
// text child to find. That removes a whole layer stack13's version needed.
//
// `node.toDelta()` would work for a live, current-state read, but we walk
// the item chain directly (item.content instanceof ContentString) instead,
// matching src/attribution.ts's own established pattern (brief 04) for the
// same reason: it is the primitive integrate.ts also needs for
// snapshot-filtered reads, so both files share one mental model.
import * as Y from "yjs";
import { ContentString, ContentType } from "yjs";
import { PM_FRAGMENT } from "./seed.js";

const TEXTBLOCK_NAMES = new Set(["paragraph", "heading", "code_block"]);

function plainText(node: any): string {
  let out = "";
  let item = node._start;
  while (item) {
    if (!item.deleted && item.content instanceof ContentString) {
      out += (item.content as any).str;
    }
    item = item.right;
  }
  return out;
}

export interface TextSegment {
  node: any | null; // the textblock's own Y.Node, or null for an empty block
  text: string;
  start: number;
  end: number;
}

function collectTextblocks(parent: any, out: TextSegment[]): void {
  let item = parent._start;
  while (item) {
    if (!item.deleted && item.content instanceof ContentType) {
      const child = item.content.type;
      if (TEXTBLOCK_NAMES.has(child.name)) {
        out.push({ node: child, text: plainText(child), start: 0, end: 0 });
      } else {
        collectTextblocks(child, out);
      }
    }
    item = item.right;
  }
}

export interface DocPlainText {
  text: string;
  segments: TextSegment[];
}

/** Textblock texts in document order joined with "\n". */
export function docPlainText(doc: Y.Doc): DocPlainText {
  const fragment = doc.get(PM_FRAGMENT);
  const segments: TextSegment[] = [];
  collectTextblocks(fragment, segments);

  let offset = 0;
  const parts: string[] = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    seg.start = offset;
    parts.push(seg.text);
    offset += seg.text.length;
    seg.end = offset;
    if (i < segments.length - 1) {
      offset += 1; // the "\n" joiner
    }
  }
  return { text: parts.join("\n"), segments };
}

export interface TextPosition {
  node: any; // the textblock's own Y.Node
  index: number;
}

/** Map a global offset (into `docPlainText(doc).text`) back to (Y.Node, index). */
export function offsetToPosition(segments: TextSegment[], offset: number): TextPosition | null {
  for (const seg of segments) {
    if (seg.node && offset >= seg.start && offset <= seg.end) {
      return { node: seg.node, index: offset - seg.start };
    }
  }
  return null;
}
