// Attribution (plan section 7; brief 4 item 5), Loro version. Adapted from
// spikes/2026-09-27-crdt-rebase-yjs-fork/src/attribution.ts: same output
// shape (runs of visible text per textblock, grouped by author, mapped
// through the `authors` map), but the per-character authorship comes
// directly from `LoroText.getEditorOf(pos): PeerID | undefined` -- Loro
// *does* give per-character authorship directly, unlike Yjs where we had to
// reimplement `isVisible` and walk the item linked list ourselves
// (`collectClientRuns` in the Yjs fork's attribution.ts). This is a real
// simplification: one public, documented method call per character instead
// of reaching into Y.Item internals.
import { LoroDoc, LoroText } from "loro-crdt";
import { docPlainText } from "./text.js";
import { AUTHORS_MAP } from "./loro-doc.js";

export interface AttributionAuthorInfo {
  kind: "human" | "git" | "unknown";
  name: string;
  userId?: string;
  email?: string;
  commit?: string;
}

export interface AttributionRun {
  // Simplification (logged, mirroring the Yjs fork's own note): no
  // structural node-path scheme exists elsewhere in this codebase, so
  // blockPath is a single-element array with the block's ordinal position in
  // document order (matching docPlainText(doc).segments).
  blockPath: number[];
  // The block's own LoroText container id (stable across edits to that
  // block, analogous to the Yjs fork's stable item-id `blockId`).
  blockId: string;
  from: number;
  to: number;
  text: string;
  peer: string;
  author: AttributionAuthorInfo;
}

function collectPeerRuns(text: LoroText): Array<{ peer: string; text: string }> {
  const plain = text.toString();
  const out: Array<{ peer: string; text: string }> = [];
  for (let i = 0; i < plain.length; i++) {
    const peer = text.getEditorOf(i) ?? "unknown";
    const last = out[out.length - 1];
    if (last && last.peer === peer) last.text += plain[i];
    else out.push({ peer, text: plain[i] });
  }
  return out;
}

/** Runs of text grouped by inserting peer id, for every textblock, mapped through the `authors` map. */
export function listAttribution(doc: LoroDoc): AttributionRun[] {
  const authors = doc.getMap(AUTHORS_MAP);
  const { segments } = docPlainText(doc);

  const out: AttributionRun[] = [];
  segments.forEach((seg, blockIndex) => {
    if (!seg.loroText) return;
    const blockId = seg.loroText.id;
    let offset = seg.start;
    for (const run of collectPeerRuns(seg.loroText)) {
      const from = offset;
      const to = offset + run.text.length;
      const authorRecord = authors.get(String(run.peer)) as any;
      out.push({
        blockPath: [blockIndex],
        blockId,
        from,
        to,
        text: run.text,
        peer: run.peer,
        author: authorRecord ?? { kind: "unknown", name: `peer ${run.peer}` },
      });
      offset = to;
    }
  });
  return out;
}
