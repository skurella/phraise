// Integration on every replica: needs-review and resurrection (plan section
// 5), ported to Yjs 14's unified Y.Node.
//
// gc:false still means a deleted Item's ContentType is never replaced (same
// reasoning as stack13's header), so a plain walk of `_start`/`.right` over
// a Y.Node finds every textblock element ever created, live or deleted.
//
// `Y.isDeleted(ds, id)` has no Yjs14 equivalent; reading `@y/y`'s own
// (unexported) `isVisible(item, snapshot)` in ynode.js shows it now checks
// `snapshot.ds.hasId(item.id)` (an `IdSet` method) instead -- `isVisibleAt`
// below is a direct, verified (scratch/probe-rebase-primitives.ts) port of
// that exact logic under a different name (it stays exported here, same as
// stack13, since gate D2 uses it directly).
//
// Spike 2's schema has no inline atoms, so unlike stack13 (which read a
// textblock's nested Y.XmlText), a "block" here IS a Y.Node whose own item
// chain holds ContentString (text) and ContentFormat (mark boundary)
// items directly -- no separate text child. `Y.Node#toDelta()` has no
// raw-Snapshot parameter (its `itemsToRender: IdSet` option is for
// attribution/diff rendering, not point-in-time reconstruction of an
// arbitrary older state), and this file needs THREE different points in
// time (base A, target B, pre-merge P) on the SAME live tree, so
// `blockDeltaAt` hand-rolls the same item-chain walk Yjs's own
// Text#toDelta(snapshot) does internally (track a running format map from
// visible ContentFormat items, emit merged runs for visible ContentString
// items) -- verified structurally sound by reading @y/y's own `isVisible`
// and `Item`/`ContentFormat`/`ContentString` source before writing it.
//
// Resurrection: stack13 hand-rebuilt a fresh XmlElement/XmlText op-by-op.
// Yjs14 has no such need for op-by-op text reconstruction either: a brand
// new detached `Y.Node`, given content via `applyDelta` while still
// detached (deferred to Yjs's own `_prelim` mechanism until the node is
// inserted somewhere), reads back correctly once inserted -- verified in
// scratch/probe-rebase-primitives.ts (`clone()`) and a follow-up probe
// (building nested detached nodes directly with `new Y.Node(name)` +
// `applyDelta`, wrapping in a `list_item` the same way, before inserting).
import * as Y from "yjs";
import { ContentString, ContentFormat } from "yjs";
import * as delta from "lib0/delta";
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

/** Yjs14 port of `@y/y`'s own private `isVisible(item, snapshot)` (ynode.js). */
export function isVisibleAt(item: any, snapshot: Y.Snapshot | undefined): boolean {
  if (snapshot === undefined) return !item.deleted;
  return (
    snapshot.sv.has(item.id.client) &&
    (snapshot.sv.get(item.id.client) || 0) > item.id.clock &&
    !(snapshot.ds as any).hasId(item.id)
  );
}

interface DeltaOp {
  insert: string;
  attributes: Record<string, any>;
}

/**
 * Reconstruct a textblock's formatted text as of `snapshot` (or the live
 * state if `snapshot` is undefined): walk the item chain, track a running
 * format map from visible ContentFormat markers, emit merged
 * {insert,attributes} runs for visible ContentString items. Mirrors Yjs's
 * own internal Text#toDelta(snapshot) algorithm (Yjs13); spike 2's schema
 * has no inline atoms, so there is nothing else (no ContentType child) to
 * handle inside a textblock.
 */
function blockDeltaAt(node: any, snapshot: Y.Snapshot | undefined): DeltaOp[] {
  const ops: DeltaOp[] = [];
  const formats = new Map<string, any>();
  let item = node._start;
  while (item) {
    if (isVisibleAt(item, snapshot)) {
      const content = item.content;
      if (content instanceof ContentFormat) {
        if (content.value === null) formats.delete(content.key);
        else formats.set(content.key, content.value);
      } else if (content instanceof ContentString) {
        const attrs = Object.fromEntries(formats);
        const last = ops[ops.length - 1];
        const attrsJSON = JSON.stringify(attrs);
        if (last && JSON.stringify(last.attributes) === attrsJSON) {
          last.insert += content.str;
        } else {
          ops.push({ insert: content.str, attributes: attrs });
        }
      }
    }
    item = item.right;
  }
  return ops;
}

export interface BlockRef {
  id: string;
  item: any;
  node: any; // the block's own Y.Node
}

/** Walk the whole tree, including subtrees under deleted ancestors, collecting every textblock element ever created. */
export function collectBlocks(root: any): BlockRef[] {
  const out: BlockRef[] = [];
  function walk(node: any) {
    let item = node._start;
    while (item) {
      const content = item.content;
      if (content && content.type) {
        const el = content.type;
        if (TEXTBLOCK_NAMES.has(el.name)) {
          out.push({ id: idKey(item.id), item, node: el });
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

/**
 * Signature of a block at `snapshot` for change detection: node attributes
 * plus the formatted delta, so mark-only and attribute-only changes count.
 * null if the block is not visible there.
 */
export function blockSignatureAt(block: BlockRef, snapshot: Y.Snapshot | undefined): string | null {
  if (!isVisibleAt(block.item, snapshot)) return null;
  return JSON.stringify([block.node.getAttrs(snapshot), blockDeltaAt(block.node, snapshot)]);
}

/** The block's text at `snapshot` (current doc state if omitted), or null if not visible there. Exported for gates that need to compare specific blocks (e.g. gate F). */
export function blockContentAt(block: BlockRef, snapshot: Y.Snapshot | undefined): string | null {
  if (!isVisibleAt(block.item, snapshot)) return null;
  return blockDeltaAt(block.node, snapshot)
    .map((o) => o.insert)
    .join("");
}

function hasOwnVisibleEditSince(node: any, myClientId: number, baseClock: number, P: Y.Snapshot): boolean {
  let item = node._start;
  while (item) {
    if (item.id.client === myClientId && item.id.clock >= baseClock && isVisibleAt(item, P)) {
      return true;
    }
    item = item.right;
  }
  return false;
}

function decodeStoredSnapshot(phraise: any, id: string): Y.Snapshot | null {
  const b64 = phraise.getAttr(`snapshot:${id}`) as string | undefined;
  if (!b64) return null;
  return Y.decodeSnapshot(base64ToUint8(b64));
}

/** Order pending rebase records oldest-base-first, following the baseId chain. Deterministic regardless of attr enumeration order. */
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

// Simplification (logged, same as stack13): append at the end of the live
// ancestor's current children rather than trying to preserve original
// sibling ordering among other resurrected/live blocks.
function resurrect(block: BlockRef, P: Y.Snapshot, rebaseId: string, review: any): void {
  const ancestor = nearestLiveAncestor(block.item);
  const nodeName = block.node.name;
  const attrs = block.node.getAttrs(P);
  const ops = blockDeltaAt(block.node, P);

  const newBlock = new Y.Node(nodeName);
  const d = delta.create(nodeName);
  d.setAttrs(attrs);
  for (const op of ops) d.insert(op.insert, op.attributes);
  newBlock.applyDelta(d.done(false));

  let toInsert: any = newBlock;
  if (LIST_NAMES.has(ancestor.name)) {
    const li = new Y.Node("list_item");
    li.applyDelta(delta.create("list_item").insert([newBlock]).done(false));
    toInsert = li;
  }

  const index = ancestor.length;
  ancestor.insert(index, [toInsert]);
  const newItem = newBlock._item;
  if (!newItem) throw new Error("resurrect: inserted block has no _item after insertion");
  review.setAttr(idKey(newItem.id), {
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
  const phraise = doc.get(PHRAISE_MAP);
  const allRecords: RebaseRecord[] = [];
  (phraise as any).forEachAttr((v: any, k: string) => {
    if (k.startsWith("rebase:")) allRecords.push(v as RebaseRecord);
  });
  const pending = allRecords.filter((r) => phraise.getAttr(`ack:${r.id}:${myClientId}`) === undefined);
  if (pending.length === 0) return;
  const ordered = orderRecords(pending);
  const root = doc.get(PM_FRAGMENT);

  doc.transact(() => {
    const review = doc.get(REVIEW_MAP);
    for (const record of ordered) {
      const snapA = decodeStoredSnapshot(phraise, record.baseId);
      const snapB = decodeStoredSnapshot(phraise, record.id);
      if (!snapA || !snapB) continue; // snapshot not delivered yet; will retry on a later batch

      const blocks = collectBlocks(root);
      for (const block of blocks) {
        const aContent = blockSignatureAt(block, snapA);
        const bContent = blockSignatureAt(block, snapB);
        const pContent = blockSignatureAt(block, P);
        const upstreamChanged = aContent !== bContent;
        const localChanged = aContent !== pContent;

        if (upstreamChanged && localChanged) {
          review.setAttr(block.id, { rebaseId: record.id, reason: "concurrent-edit" } as ReviewEntry);
        }

        if (aContent !== null && bContent === null) {
          // Deleted upstream. Resurrect if *this replica's own* edits since
          // the base are still visible at P (only the author resurrects).
          const baseClock = snapA.sv.get(myClientId) ?? 0;
          if (hasOwnVisibleEditSince(block.node, myClientId, baseClock, P)) {
            resurrect(block, P, record.id, review);
          }
        }
      }

      phraise.setAttr(`ack:${record.id}:${myClientId}`, true);
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
  const review = doc.get(REVIEW_MAP);
  const root = doc.get(PM_FRAGMENT);
  const byId = new Map(collectBlocks(root).map((b) => [b.id, b] as const));
  const out: NeedsReviewEntry[] = [];
  (review as any).forEachAttr((entry: any, id: string) => {
    const block = byId.get(id);
    if (!block || !isVisibleAt(block.item, undefined)) return;
    out.push({
      blockId: id,
      rebaseId: entry.rebaseId,
      reason: entry.reason,
      text: blockDeltaAt(block.node, undefined)
        .map((o) => o.insert)
        .join(""),
    });
  });
  return out;
}
