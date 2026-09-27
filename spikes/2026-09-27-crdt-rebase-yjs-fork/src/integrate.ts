// Integration on every replica: needs-review and resurrection (plan section 5).
//
// yjs does not export `isVisible` or a way to walk a type's history including
// deleted items, but with gc:false a deleted Item's ContentType is never
// replaced (verified in yjs source: Item.delete only sets the deleted flag
// and cascades to children, ContentType.delete never detaches `.type`), so a
// plain walk of `_start`/`.right` over the linked list finds every textblock
// element ever created, live or deleted. Combined with the exported
// `Y.isDeleted(ds, id)`, this lets us reimplement yjs's own (unexported)
// `isVisible(item, snapshot)` exactly. Since every element's Item id is
// stable forever (gc:false), we use the Item id itself as "the same element
// across snapshots" — no separate identity mapping is needed.
import * as Y from "yjs";
import { PM_FRAGMENT, PHRAISE_MAP, base64ToUint8 } from "./seed.js";
import type { RebaseRecord } from "./rebase.js";

export type ReviewReason = "concurrent-edit" | "deleted-upstream-edited-locally";

export interface ReviewEntry {
  rebaseId: string;
  reason: ReviewReason;
}

export const REVIEW_MAP = "review";

const TEXTBLOCK_NAMES = new Set(["paragraph", "heading", "code_block"]);
const LIST_NAMES = new Set(["bullet_list", "ordered_list"]);

export function idKey(id: Y.ID): string {
  return `${id.client}:${id.clock}`;
}

/** Reimplementation of yjs's private `isVisible`, from the exported primitives. */
export function isVisibleAt(item: any, snapshot: Y.Snapshot | undefined): boolean {
  if (snapshot === undefined) return !item.deleted;
  return (
    snapshot.sv.has(item.id.client) &&
    (snapshot.sv.get(item.id.client) || 0) > item.id.clock &&
    !Y.isDeleted(snapshot.ds, item.id)
  );
}

function plainTextDelta(yText: Y.XmlText, snapshot?: Y.Snapshot): string {
  return (yText.toDelta(snapshot) as any[]).map((d) => d.insert).join("");
}

export interface BlockRef {
  id: string;
  item: any;
  element: Y.XmlElement;
}

export function getXmlText(el: Y.XmlElement): Y.XmlText | null {
  const item = (el as any)._start;
  if (!item) return null;
  const content = item.content;
  return content && content.type instanceof Y.XmlText ? (content.type as Y.XmlText) : null;
}

/** Walk the whole tree, including subtrees under deleted ancestors, collecting every textblock element ever created. */
export function collectBlocks(root: Y.XmlFragment): BlockRef[] {
  const out: BlockRef[] = [];
  function walk(type: any) {
    let item = type._start;
    while (item) {
      const content = item.content;
      if (content && content.type && content.type instanceof Y.XmlElement) {
        const el: Y.XmlElement = content.type;
        if (TEXTBLOCK_NAMES.has(el.nodeName)) {
          out.push({ id: idKey(item.id), item, element: el });
        } else {
          walk(el);
        }
      }
      item = item.right;
    }
  }
  walk(root);
  return out;
}

/** The block's text at `snapshot` (current doc state if omitted), or null if not visible there. Exported for gates that need to compare specific blocks (e.g. gate F). */
export function blockContentAt(block: BlockRef, snapshot: Y.Snapshot | undefined): string | null {
  if (!isVisibleAt(block.item, snapshot)) return null;
  const xmlText = getXmlText(block.element);
  if (!xmlText) return "";
  return plainTextDelta(xmlText, snapshot);
}

function hasOwnVisibleEditSince(
  xmlText: Y.XmlText,
  myClientId: number,
  baseClock: number,
  P: Y.Snapshot
): boolean {
  let item: any = (xmlText as any)._start;
  while (item) {
    if (item.id.client === myClientId && item.id.clock >= baseClock && isVisibleAt(item, P)) {
      return true;
    }
    item = item.right;
  }
  return false;
}

function decodeStoredSnapshot(phraise: Y.Map<any>, id: string): Y.Snapshot | null {
  const b64 = phraise.get(`snapshot:${id}`) as string | undefined;
  if (!b64) return null;
  return Y.decodeSnapshot(base64ToUint8(b64));
}

/** Order pending rebase records oldest-base-first, following the baseId chain. Deterministic regardless of Y.Map iteration order. */
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

function nearestLiveAncestor(blockItem: any): any {
  let container = blockItem.parent;
  while (container._item !== null && container._item.deleted) {
    container = container._item.parent;
  }
  return container;
}

// Simplification (logged): the plan says "at the nearest valid position
// under its nearest live ancestor" without specifying the exact index. We
// append at the end of the live ancestor's current children, which is sound
// (the block is not lost, and lands under the right container) but does not
// try to preserve original sibling ordering among other resurrected/live
// blocks.
function resurrect(
  block: BlockRef,
  text: string,
  rebaseId: string,
  review: Y.Map<any>
): void {
  const ancestor = nearestLiveAncestor(block.item);
  const nodeName = block.element.nodeName;
  const attrs = block.element.getAttributes();
  const newBlock = new Y.XmlElement(nodeName);
  for (const k in attrs) {
    if (attrs[k] !== null && attrs[k] !== undefined) newBlock.setAttribute(k, attrs[k]);
  }
  if (text.length > 0) {
    const yText = new Y.XmlText();
    yText.insert(0, text);
    newBlock.insert(0, [yText]);
  }
  let toInsert: Y.XmlElement = newBlock;
  if (LIST_NAMES.has(ancestor.nodeName)) {
    const li = new Y.XmlElement("list_item");
    li.insert(0, [newBlock]);
    toInsert = li;
  }
  const index = ancestor.toArray().length;
  ancestor.insert(index, [toInsert]);
  const newItem = (newBlock as any)._item;
  review.set(idKey(newItem.id), {
    rebaseId,
    reason: "deleted-upstream-edited-locally",
  } as ReviewEntry);
}

/**
 * Run integration for every rebase record this replica (`myClientId`) has
 * not yet processed: needs-review flags and resurrection of blocks deleted
 * upstream but edited locally since the base. `P` must be `Y.snapshot(doc)`
 * taken *before* the update batch that is about to be (or has just been)
 * applied to `doc`. Idempotent per (record, myClientId) via `ack:<id>:<clientID>`.
 */
export function integrate(doc: Y.Doc, P: Y.Snapshot, myClientId: number): void {
  const phraise = doc.getMap(PHRAISE_MAP);
  const allRecords: RebaseRecord[] = [];
  phraise.forEach((v, k) => {
    if (k.startsWith("rebase:")) allRecords.push(v as RebaseRecord);
  });
  const pending = allRecords.filter(
    (r) => phraise.get(`ack:${r.id}:${myClientId}`) === undefined
  );
  if (pending.length === 0) return;
  const ordered = orderRecords(pending);
  const root = doc.getXmlFragment(PM_FRAGMENT);

  doc.transact(() => {
    const review = doc.getMap(REVIEW_MAP);
    for (const record of ordered) {
      const snapA = decodeStoredSnapshot(phraise, record.baseId);
      const snapB = decodeStoredSnapshot(phraise, record.id);
      if (!snapA || !snapB) continue; // snapshot not delivered yet; will retry on a later batch

      const blocks = collectBlocks(root);
      for (const block of blocks) {
        const aContent = blockContentAt(block, snapA);
        const bContent = blockContentAt(block, snapB);
        const pContent = blockContentAt(block, P);
        const upstreamChanged = aContent !== bContent;
        const localChanged = aContent !== pContent;

        if (upstreamChanged && localChanged) {
          review.set(block.id, { rebaseId: record.id, reason: "concurrent-edit" } as ReviewEntry);
        }

        if (aContent !== null && bContent === null) {
          // Deleted upstream. Resurrect if *this replica's own* edits since
          // the base are still visible at P (only the author resurrects).
          const baseClock = snapA.sv.get(myClientId) ?? 0;
          const xmlText = getXmlText(block.element);
          if (xmlText && hasOwnVisibleEditSince(xmlText, myClientId, baseClock, P)) {
            resurrect(block, pContent ?? "", record.id, review);
          }
        }
      }

      phraise.set(`ack:${record.id}:${myClientId}`, true);
    }
  }, "integrate");
}

export interface NeedsReviewEntry {
  blockId: string;
  rebaseId: string;
  reason: ReviewReason;
  text: string;
}

/** Currently-visible flagged blocks, with their current text. */
export function needsReview(doc: Y.Doc): NeedsReviewEntry[] {
  const review = doc.getMap(REVIEW_MAP);
  const root = doc.getXmlFragment(PM_FRAGMENT);
  const byId = new Map(collectBlocks(root).map((b) => [b.id, b] as const));
  const out: NeedsReviewEntry[] = [];
  review.forEach((entry: any, id: string) => {
    const block = byId.get(id);
    if (!block || !isVisibleAt(block.item, undefined)) return;
    const xmlText = getXmlText(block.element);
    out.push({
      blockId: id,
      rebaseId: entry.rebaseId,
      reason: entry.reason,
      text: xmlText ? plainTextDelta(xmlText) : "",
    });
  });
  return out;
}
