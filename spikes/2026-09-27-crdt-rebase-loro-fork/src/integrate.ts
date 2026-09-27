// Integration on every replica: needs-review and resurrection (plan section
// 5; brief 4 item 3), Loro version. Adapted from
// spikes/2026-09-27-crdt-rebase-yjs-fork/src/integrate.ts.
//
// Real simplification vs. the Yjs fork, found while building this: Yjs does
// not export `isVisible` or a historical-content reader, so that fork had to
// reimplement `isVisible` from exported primitives and walk `Y.Item` linked
// lists by hand. Loro's container ids are stable across `forkAt` (verified:
// `fork.getMap(...).get(0).id === original.id` for an untouched container),
// and `LoroText.getEditorOf(pos)` gives per-character authorship directly --
// so "content of block X at snapshot S" is just `doc.forkAt(S)` + a normal
// tree walk, and "did my peer edit this" is a direct `getEditorOf` check, no
// clock bookkeeping needed.
//
// Resurrection scope cut (logged, per the brief's own "only if simple;
// otherwise measure the loss and report" for this item): this
// implementation appends a resurrected block at the end of the ROOT
// document's children, not the Yjs fork's already-simplified "nearest live
// ancestor" (which itself doesn't preserve original ordering). Walking a
// partially-deleted Loro ancestor chain to find "nearest live ancestor" was
// judged not simple enough for the remaining time budget; root-level append
// is still sound (the block and the local author's text are never lost).
import { LoroDoc, LoroMap, LoroText, type Frontiers } from "loro-crdt";
import type { LoroNode } from "loro-prosemirror";
import { ROOT_DOC_KEY, PHRAISE_MAP, getChildren, getAttrs, isTextblockName, nodeName, plainText } from "./loro-doc.js";
import type { RebaseRecord } from "./rebase.js";

export type ReviewReason = "concurrent-edit" | "deleted-upstream-edited-locally";

export interface ReviewEntry {
  rebaseId: string;
  reason: ReviewReason;
}

export const REVIEW_MAP = "review";

export interface BlockSnapshot {
  id: string;
  nodeName: string;
  attrs: Record<string, any>;
  text: string;
}

/** Walk the whole tree of `doc` (at its current, possibly forked/checked-out state), collecting every textblock. */
export function collectBlocks(doc: LoroDoc): BlockSnapshot[] {
  const out: BlockSnapshot[] = [];
  function walk(node: LoroNode) {
    for (const child of getChildren(node).toArray()) {
      if (!(child instanceof LoroMap)) continue;
      const cNode = child as LoroNode;
      const name = nodeName(cNode);
      if (isTextblockName(name)) {
        const kids = getChildren(cNode).toArray();
        const text = kids.length > 0 && kids[0] instanceof LoroText ? plainText(kids[0] as LoroText) : "";
        out.push({ id: cNode.id, nodeName: name, attrs: getAttrs(cNode).toJSON(), text });
      } else {
        walk(cNode);
      }
    }
  }
  walk(doc.getMap(ROOT_DOC_KEY) as unknown as LoroNode);
  return out;
}

function orderRecords(records: RebaseRecord[]): RebaseRecord[] {
  const byId = new Map(records.map((r) => [r.id, r] as const));
  const result: RebaseRecord[] = [];
  const visited = new Set<string>();
  function visit(r: RebaseRecord): void {
    if (visited.has(r.id)) return;
    visited.add(r.id);
    const parent = byId.get(r.baseId);
    if (parent) visit(parent);
    result.push(r);
  }
  for (const r of records) visit(r);
  return result;
}

function hasOwnEdit(text: string, loroText: LoroText, myPeer: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if (loroText.getEditorOf(i) === myPeer) return true;
  }
  return false;
}

function resurrect(block: BlockSnapshot, doc: LoroDoc, rebaseId: string): void {
  const root = doc.getMap(ROOT_DOC_KEY) as unknown as LoroNode;
  const children = getChildren(root);
  const map = children.insertContainer(children.length, new LoroMap()) as LoroNode;
  map.set("nodeName", block.nodeName);
  const attrs = getAttrs(map);
  for (const [k, v] of Object.entries(block.attrs)) {
    if (v !== null && v !== undefined) attrs.set(k, v);
  }
  if (block.text.length > 0) {
    const t = getChildren(map).insertContainer(0, new LoroText());
    t.insert(0, block.text);
  }
  doc.getMap(REVIEW_MAP).set(map.id, {
    rebaseId,
    reason: "deleted-upstream-edited-locally",
  } as ReviewEntry);
}

/**
 * Run integration for every rebase record this replica (`myPeer`, a Loro
 * PeerID string) has not yet processed: needs-review flags and resurrection
 * of blocks deleted upstream but edited locally since the base. `priorFrontiers`
 * must be `doc.frontiers()` taken *before* the update batch that is about to
 * be (or has just been) applied to `doc`. Idempotent per (record, myPeer)
 * via `ack:<id>:<myPeer>`.
 */
export function integrate(doc: LoroDoc, priorFrontiers: Frontiers, myPeer: string): void {
  const phraise = doc.getMap(PHRAISE_MAP);
  const allRecords: RebaseRecord[] = [];
  for (const [k, v] of phraise.entries()) {
    if (k.startsWith("rebase:")) allRecords.push(v as unknown as RebaseRecord);
  }
  const pending = allRecords.filter((r) => phraise.get(`ack:${r.id}:${myPeer}`) === undefined);
  if (pending.length === 0) return;
  const ordered = orderRecords(pending);

  for (const record of ordered) {
    const frontiersA = phraise.get(`snapshot:${record.baseId}`) as Frontiers | undefined;
    const frontiersB = phraise.get(`snapshot:${record.id}`) as Frontiers | undefined;
    if (!frontiersA || !frontiersB) continue; // not delivered yet; retry on a later batch

    const forkA = doc.forkAt(frontiersA);
    const forkB = doc.forkAt(frontiersB);
    const forkP = doc.forkAt(priorFrontiers);
    const blocksA = new Map(collectBlocks(forkA).map((b) => [b.id, b] as const));
    const blocksB = new Map(collectBlocks(forkB).map((b) => [b.id, b] as const));
    const blocksP = new Map(collectBlocks(forkP).map((b) => [b.id, b] as const));

    const review = doc.getMap(REVIEW_MAP);
    for (const [id, aBlock] of blocksA) {
      const bBlock = blocksB.get(id);
      const pBlock = blocksP.get(id);
      const upstreamChanged = (bBlock?.text ?? null) !== aBlock.text;
      const localChanged = (pBlock?.text ?? null) !== aBlock.text;

      if (upstreamChanged && localChanged) {
        review.set(id, { rebaseId: record.id, reason: "concurrent-edit" } as ReviewEntry);
      }

      if (bBlock === undefined && pBlock !== undefined) {
        // Deleted upstream. Resurrect only if this replica's own peer wrote
        // some of the surviving-at-P text (only the author resurrects).
        const loroText = findBlockText(forkP, id);
        if (loroText && hasOwnEdit(pBlock.text, loroText, myPeer)) {
          resurrect(pBlock, doc, record.id);
        }
      }
    }
    phraise.set(`ack:${record.id}:${myPeer}`, true);
  }
  doc.commit({ origin: "integrate" });
}

function findBlockText(doc: LoroDoc, blockId: string): LoroText | null {
  let found: LoroText | null = null;
  function walk(node: LoroNode) {
    for (const child of getChildren(node).toArray()) {
      if (!(child instanceof LoroMap)) continue;
      const cNode = child as LoroNode;
      if (cNode.id === blockId) {
        const kids = getChildren(cNode).toArray();
        if (kids.length > 0 && kids[0] instanceof LoroText) found = kids[0] as LoroText;
        return;
      }
      walk(cNode);
    }
  }
  walk(doc.getMap(ROOT_DOC_KEY) as unknown as LoroNode);
  return found;
}

export interface NeedsReviewEntry {
  blockId: string;
  rebaseId: string;
  reason: ReviewReason;
  text: string;
}

/** Currently-visible flagged blocks, with their current text. */
export function needsReview(doc: LoroDoc): NeedsReviewEntry[] {
  const review = doc.getMap(REVIEW_MAP);
  const byId = new Map(collectBlocks(doc).map((b) => [b.id, b] as const));
  const out: NeedsReviewEntry[] = [];
  for (const [id, entry] of review.entries()) {
    const block = byId.get(id);
    if (!block) continue;
    out.push({ blockId: id, rebaseId: (entry as any).rebaseId, reason: (entry as any).reason, text: block.text });
  }
  return out;
}
