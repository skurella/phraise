// Attribution (plan section 7): for every textblock, runs of visible
// characters grouped by inserting client id, mapped through `authors`.
import * as Y from "yjs";
import { docPlainText } from "./text.js";
import { AUTHORS_MAP, PM_FRAGMENT } from "./seed.js";
import { collectBlocks, isVisibleAt } from "./integrate.js";

export interface AttributionAuthorInfo {
  kind: "human" | "git" | "unknown";
  name: string;
  userId?: string;
  email?: string;
  commit?: string;
}

export interface AttributionRun {
  // Simplification (logged): no structural node-path scheme exists
  // elsewhere in this codebase, so blockPath is a single-element array with
  // the block's ordinal position in document order (matching
  // docPlainText(doc).segments). from/to are *global* doc-plain-text
  // offsets (the same coordinate space comments use), not block-local ones.
  blockPath: number[];
  // The block's stable item-id key (see integrate.ts's idKey), so callers
  // (e.g. gate F) can cross-reference against `needsReview`'s flagged ids
  // without re-deriving the block/segment correspondence themselves.
  blockId: string;
  from: number;
  to: number;
  text: string;
  clientID: number;
  author: AttributionAuthorInfo;
}

function collectClientRuns(xmlText: Y.XmlText): Array<{ clientID: number; text: string }> {
  const out: Array<{ clientID: number; text: string }> = [];
  let n: any = (xmlText as any)._start;
  while (n) {
    if (!n.deleted && n.countable && n.content instanceof Y.ContentString) {
      const str: string = (n.content as any).str;
      const last = out[out.length - 1];
      if (last && last.clientID === n.id.client) last.text += str;
      else out.push({ clientID: n.id.client, text: str });
    }
    n = n.right;
  }
  return out;
}

/** Runs of visible text grouped by inserting client id, for every currently-live textblock, mapped through the `authors` map. */
export function listAttribution(doc: Y.Doc): AttributionRun[] {
  const authors = doc.getMap(AUTHORS_MAP);
  const { segments } = docPlainText(doc);
  const root = doc.getXmlFragment(PM_FRAGMENT);
  // collectBlocks + docPlainText both walk textblocks in the same document
  // order; filtering to currently-visible ones lines them up 1:1 so we can
  // attach each segment's stable block id.
  const visibleBlocks = collectBlocks(root).filter((b) => isVisibleAt(b.item, undefined));

  const out: AttributionRun[] = [];
  segments.forEach((seg, blockIndex) => {
    if (!seg.xmlText) return;
    const blockId = visibleBlocks[blockIndex]?.id ?? `unknown:${blockIndex}`;
    let offset = seg.start;
    for (const run of collectClientRuns(seg.xmlText)) {
      const from = offset;
      const to = offset + run.text.length;
      const authorRecord = authors.get(String(run.clientID)) as any;
      out.push({
        blockPath: [blockIndex],
        blockId,
        from,
        to,
        text: run.text,
        clientID: run.clientID,
        author: authorRecord ?? { kind: "unknown", name: `client ${run.clientID}` },
      });
      offset = to;
    }
  });
  return out;
}
