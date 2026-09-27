// Doc plain text and offset mapping for comment selectors (plan section 2),
// Loro version. Adapted from
// spikes/2026-09-27-crdt-rebase-yjs-fork/src/text.ts: same shape (textblock
// texts in document order joined with "\n", plus a mapping from a global
// offset back to a text container + local index), walking LoroMap/LoroText
// instead of Y.XmlElement/Y.XmlText. Unlike Y.XmlText, LoroText's own
// `.toString()` *is* plain text (verified in this spike, see README), so no
// "toDelta().map(insert).join()" workaround is needed here -- kept anyway via
// the shared `plainText` helper for symmetry with the marks-aware code paths.
import { LoroDoc, LoroMap, LoroText } from "loro-crdt";
import type { LoroChildrenListType, LoroNode } from "loro-prosemirror";
import { ROOT_DOC_KEY, getChildren, isTextblockName, nodeName, plainText } from "./loro-doc.js";

export interface TextSegment {
  loroText: LoroText | null;
  text: string;
  start: number;
  end: number;
}

function collectTextblocks(children: LoroChildrenListType, out: TextSegment[]): void {
  for (const child of children.toArray()) {
    if (child instanceof LoroMap) {
      const name = nodeName(child as LoroNode);
      if (isTextblockName(name)) {
        const kids = getChildren(child as LoroNode).toArray();
        if (kids.length === 0 || !(kids[0] instanceof LoroText)) {
          out.push({ loroText: null, text: "", start: 0, end: 0 });
        } else {
          const t = kids[0] as LoroText;
          out.push({ loroText: t, text: plainText(t), start: 0, end: 0 });
        }
      } else {
        collectTextblocks(getChildren(child as LoroNode), out);
      }
    }
  }
}

export interface DocPlainText {
  text: string;
  segments: TextSegment[];
}

/** Textblock texts in document order joined with "\n". */
export function docPlainText(doc: LoroDoc): DocPlainText {
  const root = doc.getMap(ROOT_DOC_KEY) as unknown as LoroNode;
  const segments: TextSegment[] = [];
  collectTextblocks(getChildren(root), segments);

  let offset = 0;
  const parts: string[] = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    seg.start = offset;
    parts.push(seg.text);
    offset += seg.text.length;
    seg.end = offset;
    if (i < segments.length - 1) offset += 1; // the "\n" joiner
  }
  return { text: parts.join("\n"), segments };
}

export interface TextPosition {
  loroText: LoroText;
  index: number;
}

/** Map a global offset (into docPlainText(doc).text) back to (LoroText, index). */
export function offsetToPosition(segments: TextSegment[], offset: number): TextPosition | null {
  for (const seg of segments) {
    if (seg.loroText && offset >= seg.start && offset <= seg.end) {
      return { loroText: seg.loroText, index: offset - seg.start };
    }
  }
  return null;
}
