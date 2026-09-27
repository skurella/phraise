// Doc plain text and offset mapping for comment selectors (plan section 2):
// textblock texts in document order joined with "\n", plus a mapping from a
// global offset back to (Y.XmlText, index within it).
import * as Y from "yjs";
import { PM_FRAGMENT } from "./seed.js";

const TEXTBLOCK_NAMES = new Set(["paragraph", "heading", "code_block"]);

// Y.XmlText's own `toString()` serializes to an XML-ish string with mark
// tags, not plain text (see the same note in diff.ts). Plain text is the
// concatenation of the delta's insert strings.
function plainText(yText: Y.XmlText): string {
  return yText
    .toDelta()
    .map((d: any) => d.insert)
    .join("");
}

export interface TextSegment {
  xmlText: Y.XmlText | null;
  text: string;
  start: number;
  end: number;
}

function collectTextblocks(
  parent: Y.XmlFragment | Y.XmlElement,
  out: TextSegment[]
): void {
  for (const child of parent.toArray()) {
    if (child instanceof Y.XmlElement) {
      if (TEXTBLOCK_NAMES.has(child.nodeName)) {
        const kids = child.toArray();
        if (kids.length === 0) {
          out.push({ xmlText: null, text: "", start: 0, end: 0 });
        } else {
          const xmlText = kids[0] as Y.XmlText;
          out.push({ xmlText, text: plainText(xmlText), start: 0, end: 0 });
        }
      } else {
        collectTextblocks(child, out);
      }
    }
  }
}

export interface DocPlainText {
  text: string;
  segments: TextSegment[];
}

/** Textblock texts in document order joined with "\n". */
export function docPlainText(doc: Y.Doc): DocPlainText {
  const fragment = doc.getXmlFragment(PM_FRAGMENT);
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
  xmlText: Y.XmlText;
  index: number;
}

/** Map a global offset (into `docPlainText(doc).text`) back to (XmlText, index). */
export function offsetToPosition(
  segments: TextSegment[],
  offset: number
): TextPosition | null {
  for (const seg of segments) {
    if (seg.xmlText && offset >= seg.start && offset <= seg.end) {
      return { xmlText: seg.xmlText, index: offset - seg.start };
    }
  }
  return null;
}
