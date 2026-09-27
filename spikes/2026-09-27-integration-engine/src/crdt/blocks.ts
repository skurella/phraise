// Plan section 3 point 4 (blockStatesAt/resurrectBlock) and section 4's
// generalization note: spike 2's rebase/integrate.ts (collab-stack-yjs13-
// hocuspocus, branch spike/2026-09-27-collab-stack, commit eeb3fe2, itself
// spike 2's src/rebase/integrate.ts) assumed one XmlText per textblock
// (paragraph/heading/code_block only). Ported and generalized here for the
// full schema (brief 03): a textblock is any element whose ProseMirror node
// type `isTextblock` (checked dynamically via `schema.nodes`, not a
// hardcoded name set), and its children -- at a given snapshot -- may be
// several `Y.XmlText` runs interleaved with inline-atom `Y.XmlElement`s
// (image, hard_break, raw_inline, footnote references encoded as
// raw_inline). See `README.md` for the generalized signature's shape.
//
// yjs does not export `isVisible` or a way to walk a type's history
// including deleted items, but with gc:false a deleted Item's ContentType is
// never replaced (Item.delete only sets the deleted flag and cascades to
// children; ContentType.delete never detaches `.type`), so a plain walk of
// `_start`/`.right` over the linked list finds every element ever created,
// live or deleted. Combined with the exported `Y.isDeleted(ds, id)`, this
// reimplements yjs's own (unexported) `isVisible(item, snapshot)` exactly.
// Every element's Item id is stable forever (gc:false), so the Item id
// itself is "the same element across snapshots" -- no separate identity
// mapping is needed. (Spike 2's comment, carried over verbatim: still true
// on the full schema.)
import * as Y from 'yjs';
import { schema, isMetaAttrName } from '../markdown/index.js';
import { FRAGMENT_NAME } from './codec.js';

// 'serialization-best-effort' (brief 07 task 4): written by
// engine/renderForSave.ts, not by integrate.ts's rebase-time scan -- a
// block whose best-effort serialization did not verify (D9's "best effort
// plus a flag on the block"), unrelated to any `rebaseId`.
export type ReviewReason = 'concurrent-edit' | 'deleted-upstream-edited-locally' | 'serialization-best-effort';

export function idKey(id: Y.ID): string {
  return `${id.client}:${id.clock}`;
}

/** Reimplementation of yjs's private `isVisible`, from the exported primitives (spike 2's `isVisibleAt`). */
export function isVisibleAt(item: any, snapshot: Y.Snapshot | undefined): boolean {
  if (snapshot === undefined) return !item.deleted;
  return snapshot.sv.has(item.id.client) && (snapshot.sv.get(item.id.client) || 0) > item.id.clock && !Y.isDeleted(snapshot.ds, item.id);
}

/** True if `name` is a textblock node type in the shared schema (paragraph, heading, code_block, table_cell, raw_block, ...), decided dynamically rather than a hardcoded name set (brief 03's "generalize, do not special-case"). */
export function isTextblockName(name: string): boolean {
  return schema.nodes[name]?.isTextblock === true;
}

export interface BlockRef {
  id: string;
  item: any;
  element: Y.XmlElement;
  /** Ancestor node names from the root down to (not including) this block, e.g. `['table', 'table_row', 'table_cell']`. Diagnostic only. */
  path: string[];
}

/**
 * Walk the whole tree, including subtrees under deleted ancestors,
 * collecting every textblock element ever created (generalizes spike 2's
 * `collectBlocks`, which only matched a fixed `paragraph`/`heading`/
 * `code_block` name set, to any `isTextblock` node type at any depth --
 * table cells, list items' paragraphs, etc.).
 */
function collectBlocksFrom(root: Y.XmlFragment): BlockRef[] {
  const out: BlockRef[] = [];
  function walk(container: { _start: any } & object, path: string[]): void {
    let item = (container as any)._start;
    while (item) {
      const content = item.content;
      if (content && content.type instanceof Y.XmlElement) {
        const el: Y.XmlElement = content.type;
        if (isTextblockName(el.nodeName)) {
          out.push({ id: idKey(item.id), item, element: el, path });
        } else {
          walk(el as any, [...path, el.nodeName]);
        }
      }
      item = item.right;
    }
  }
  walk(root as any, []);
  return out;
}

/** Every textblock ever created (live or deleted) in `doc`, generalizing spike 2's `collectBlocks` (see the exported `BlockRef`'s own comment). Doc-level, not fragment-level: engine (which never touches a raw `Y.XmlFragment`) calls this with a `CrdtDoc` directly. */
export function collectBlocks(doc: Y.Doc): BlockRef[] {
  return collectBlocksFrom(doc.getXmlFragment(FRAGMENT_NAME));
}

/**
 * The document's LIVE top-level elements, in order -- matches `read(doc)`'s
 * PMNode child order (and therefore `renderDoc`'s `degraded` top-level
 * block indices; brief 07 task 4). Deleted top-level items are skipped,
 * same as a normal (non-snapshot) read.
 */
function liveTopLevelElements(doc: Y.Doc): Y.XmlElement[] {
  const frag = doc.getXmlFragment(FRAGMENT_NAME) as any;
  const out: Y.XmlElement[] = [];
  let item = frag._start;
  while (item) {
    if (!item.deleted) {
      const content = item.content;
      if (content && content.type instanceof Y.XmlElement) out.push(content.type);
    }
    item = item.right;
  }
  return out;
}

/** Every textblock id (`idKey`) living under `el`: itself if it is one, else every textblock nested inside it (a container -- blockquote, list, table -- has no blockId of its own; `review` flags are always keyed by a textblock). */
function collectTextblockIdsUnder(el: Y.XmlElement): string[] {
  const item = (el as any)._item;
  if (isTextblockName(el.nodeName)) return item ? [idKey(item.id)] : [];
  const out: string[] = [];
  let child = (el as any)._start;
  while (child) {
    if (!child.deleted) {
      const content = child.content;
      if (content && content.type instanceof Y.XmlElement) out.push(...collectTextblockIdsUnder(content.type));
    }
    child = child.right;
  }
  return out;
}

/**
 * Every textblock id living under the top-level block at `index` (an
 * index into `renderDoc`'s `degraded` list, i.e. into the live top-level
 * elements in document order) -- the block itself if it is a textblock,
 * else every textblock nested inside it, since the serializer reports a
 * degraded CONTAINER (a whole blockquote/list/table) as one top-level
 * index without knowing which nested textblock specifically failed to
 * verify. Brief 07 task 4 (`engine.renderForSave`'s review-flag mapping).
 */
export function textblockIdsAtTopLevel(doc: Y.Doc, index: number): string[] {
  const el = liveTopLevelElements(doc)[index];
  return el ? collectTextblockIdsUnder(el) : [];
}

/** The block's current plain text (live doc state), or `null` if `blockId` does not exist or is not currently visible. Convenience wrapper for engine's review listings, which only have a blockId string, not a `BlockRef`. */
export function currentBlockText(doc: Y.Doc, blockId: string): string | null {
  const block = collectBlocks(doc).find((b) => b.id === blockId);
  if (!block) return null;
  return blockPlainTextAt(block, undefined);
}

function attrsForSignature(attrs: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const k in attrs) {
    // leafMarks is a meta attr by isMetaAttrName's general definition (it is
    // ignored by semanticEq, which compares decoded PM marks instead), but
    // it is the ONLY place an inline atom's marks live at the raw CRDT
    // level (see codec.ts): a link added to an image changes `leafMarks`,
    // not any "semantic" attr. Brief 03 explicitly asks for it to count
    // here even though isMetaAttrName excludes it in general.
    if (isMetaAttrName(k) && k !== 'leafMarks') continue;
    out[k] = attrs[k];
  }
  return out;
}

/** Every visible (at `snapshot`) direct child of `container`, in order: `Y.XmlText` runs and inline-atom `Y.XmlElement`s alike. Walks the item chain directly (not `.toArray()`) so an explicit snapshot is honored, not just "currently live". */
function visibleChildrenAt(container: Y.XmlElement, snapshot: Y.Snapshot | undefined): Array<Y.XmlText | Y.XmlElement> {
  const out: Array<Y.XmlText | Y.XmlElement> = [];
  let item: any = (container as any)._start;
  while (item) {
    if (isVisibleAt(item, snapshot)) {
      const type = item.content?.type;
      if (type instanceof Y.XmlText || type instanceof Y.XmlElement) out.push(type);
    }
    item = item.right;
  }
  return out;
}

/**
 * Signature of a block at `snapshot` for change detection: its own
 * attributes (semantic ones only) plus, in child order, each text run's
 * formatted delta at the snapshot and each inline atom's name and
 * attributes (including `leafMarks`). `null` if the block is not visible at
 * `snapshot`. Generalizes spike 2's `blockSignatureAt` (single XmlText) to
 * any number of runs/atoms (plan section 4's schema note).
 */
export function blockSignatureAt(block: BlockRef, snapshot: Y.Snapshot | undefined): string | null {
  if (!isVisibleAt(block.item, snapshot)) return null;
  const attrs = attrsForSignature(block.element.getAttributes(snapshot));
  const children = visibleChildrenAt(block.element, snapshot);
  const parts = children.map((child) => {
    if (child instanceof Y.XmlText) {
      return { k: 't', d: child.toDelta(snapshot) };
    }
    return { k: 'a', n: child.nodeName, a: attrsForSignature(child.getAttributes(snapshot)) };
  });
  return JSON.stringify([attrs, parts]);
}

export interface BlockState {
  signature: string | null;
  path: string[];
}

/** Every textblock ever created (live or deleted), with its signature and ancestor path at `snapshot` (current live state if omitted). Plan section 3 point 4. */
export function blockStatesAt(doc: Y.Doc, snapshot?: Uint8Array): Map<string, BlockState> {
  const snap = snapshot ? Y.decodeSnapshot(snapshot) : undefined;
  const out = new Map<string, BlockState>();
  for (const block of collectBlocks(doc)) {
    out.set(block.id, { signature: blockSignatureAt(block, snap), path: block.path });
  }
  return out;
}

/** The block's plain text at `snapshot` (current doc state if omitted), joining every visible text run; inline atoms contribute nothing (used by review listings, not the anchor projection -- see anchors.ts for that). `null` if not visible there. */
export function blockPlainTextAt(block: BlockRef, snapshot: Y.Snapshot | undefined): string | null {
  if (!isVisibleAt(block.item, snapshot)) return null;
  return visibleChildrenAt(block.element, snapshot)
    .filter((c): c is Y.XmlText => c instanceof Y.XmlText)
    .map((c) => (c.toDelta(snapshot) as any[]).map((d) => d.insert).join(''))
    .join('');
}

function nearestLiveAncestor(blockItem: any): any {
  let container = blockItem.parent;
  while (container._item !== null && container._item.deleted) {
    container = container._item.parent;
  }
  return container;
}

const LIST_NAMES = new Set(['bullet_list', 'ordered_list']);

/**
 * Re-insert a deleted textblock's content as of `atSnapshot`, under its
 * nearest live ancestor (port of spike 2's `resurrect`, generalized to
 * multiple text runs and inline atoms). Returns the new block's id, or
 * `null` if `blockId` does not exist or is already live (nothing to
 * resurrect). Simplification carried over from spike 2 (logged there too):
 * always appended at the end of the live ancestor's current children --
 * sound (the block is not lost, lands under the right container) but does
 * not try to preserve original sibling ordering among other resurrected or
 * live blocks.
 */
export function resurrectBlock(doc: Y.Doc, blockId: string, atSnapshot: Uint8Array, origin: unknown = 'phraise-resurrect'): { newBlockId: string } | null {
  const snap = Y.decodeSnapshot(atSnapshot);
  const block = collectBlocks(doc).find((b) => b.id === blockId);
  if (!block) return null;
  if (isVisibleAt(block.item, undefined)) return null;

  const ancestor = nearestLiveAncestor(block.item);
  const attrs = block.element.getAttributes(snap);
  const children = visibleChildrenAt(block.element, snap);

  let newBlockId = '';
  doc.transact(() => {
    const newEl = new Y.XmlElement(block.element.nodeName);
    for (const k in attrs) {
      if (attrs[k] !== null && attrs[k] !== undefined) newEl.setAttribute(k, attrs[k]);
    }
    const newChildren: (Y.XmlText | Y.XmlElement)[] = [];
    for (const child of children) {
      if (child instanceof Y.XmlText) {
        const yText = new Y.XmlText();
        let at = 0;
        for (const op of child.toDelta(snap) as any[]) {
          if (typeof op.insert !== 'string') continue;
          yText.insert(at, op.insert, op.attributes ?? {});
          at += op.insert.length;
        }
        newChildren.push(yText);
      } else {
        const atomAttrs = child.getAttributes(snap);
        const newAtom = new Y.XmlElement(child.nodeName);
        for (const k in atomAttrs) {
          if (atomAttrs[k] !== null && atomAttrs[k] !== undefined) newAtom.setAttribute(k, atomAttrs[k]);
        }
        newChildren.push(newAtom);
      }
    }
    if (newChildren.length > 0) newEl.insert(0, newChildren);

    let toInsert: Y.XmlElement = newEl;
    if (LIST_NAMES.has(ancestor.nodeName)) {
      const li = new Y.XmlElement('list_item');
      li.insert(0, [newEl]);
      toInsert = li;
    }
    const index = ancestor.toArray().length;
    ancestor.insert(index, [toInsert]);
    newBlockId = idKey((newEl as any)._item.id);
  }, origin);

  return { newBlockId };
}

/**
 * True if any item under `blockId` (a text-run character, or an inline
 * atom's own insertion) was created by `clientId` at or after `baseSnapshot`
 * and is still visible at `atSnapshot`. Generalizes spike 2's
 * `hasOwnVisibleEditSince` (which only scanned one block's single XmlText)
 * to every run and atom under the block -- needed by engine/integrate.ts's
 * resurrection rule ("only the author of the edits resurrects"), which
 * cannot be recovered from `blockStatesAt`'s opaque signature string alone.
 * New for this spike (not part of spike 2's file); kept in this module
 * since it walks raw Yjs item chains like everything else here.
 */
export function blockHasOwnEditsSince(doc: Y.Doc, blockId: string, clientId: number, baseSnapshot: Uint8Array, atSnapshot: Uint8Array): boolean {
  const base = Y.decodeSnapshot(baseSnapshot);
  const at = Y.decodeSnapshot(atSnapshot);
  const baseClock = base.sv.get(clientId) ?? 0;
  const block = collectBlocks(doc).find((b) => b.id === blockId);
  if (!block) return false;

  function ownVisible(item: any): boolean {
    return item.id.client === clientId && item.id.clock >= baseClock && isVisibleAt(item, at);
  }
  function scanText(yText: any): boolean {
    let item = yText._start;
    while (item) {
      if (ownVisible(item)) return true;
      item = item.right;
    }
    return false;
  }
  function scanContainer(container: any): boolean {
    let item = container._start;
    while (item) {
      if (ownVisible(item)) return true;
      const type = item.content?.type;
      if (type instanceof Y.XmlText) {
        if (scanText(type)) return true;
      }
      item = item.right;
    }
    return false;
  }
  return scanContainer(block.element);
}
