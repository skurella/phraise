// Classify why a human token is missing from the final document
// (orchestrator, 2026-09-27). The fuzz found tokens lost when a *human*
// concurrently deleted the block another human typed into: plain CRDT
// delete-vs-edit semantics, independent of the rebase. Gate H is about
// upstream edits against local edits, so only losses caused by the rebase
// count as `local-text-lost`; human-vs-human losses are reported under
// `human-delete-vs-edit`.
//
// Method: find the item that holds the token (tombstones are kept, gc off),
// walk up to the topmost deleted ancestor element, and ask whether any
// rebase deleted it: deleted in the rebase's result snapshot but not in its
// base snapshot. If the token's own item was deleted while every ancestor is
// visible, someone deleted the text itself, which the fuzz never does to
// another user's token, so that is reported as `rebase` too (conservative).
import * as Y from "yjs";
import { PM_FRAGMENT, PHRAISE_MAP, base64ToUint8 } from "../seed.js";

export type LossCause = "rebase" | "rebase-no-resurrect" | "text-deleted" | "human-delete" | "not-found";

function findTokenItem(root: Y.XmlFragment, token: string): any | null {
  let found: any = null;
  function walk(type: any) {
    let item = type._start;
    while (item && !found) {
      const c = item.content;
      if (c?.type instanceof Y.XmlElement) walk(c.type);
      else if (c?.type instanceof Y.XmlText) walkText(c.type);
      item = item.right;
    }
  }
  function walkText(t: any) {
    // Concatenate adjacent string items: a token can be split across items.
    let item = t._start;
    let buf = "";
    while (item) {
      if (typeof item.content?.str === "string") {
        buf += item.content.str;
        if (buf.includes(token)) {
          found = item;
          return;
        }
      }
      item = item.right;
    }
  }
  walk(root);
  return found;
}

function rebaseDeleted(doc: Y.Doc, id: Y.ID): boolean {
  const phraise = doc.getMap(PHRAISE_MAP);
  let hit = false;
  phraise.forEach((v: any, k: string) => {
    if (hit || !k.startsWith("rebase:")) return;
    const a = phraise.get(`snapshot:${v.baseId}`) as string | undefined;
    const b = phraise.get(`snapshot:${v.id}`) as string | undefined;
    if (!a || !b) return;
    const sa = Y.decodeSnapshot(base64ToUint8(a));
    const sb = Y.decodeSnapshot(base64ToUint8(b));
    if (Y.isDeleted(sb.ds, id) && !Y.isDeleted(sa.ds, id)) hit = true;
  });
  return hit;
}

/** IDs ("client:clock") of every deleted element item in `doc`. Called on each human's doc right after its local edits, before any delivery, so these are exactly the elements that human deleted. */
export function deletedElementIds(doc: Y.Doc): Set<string> {
  const out = new Set<string>();
  function walk(type: any) {
    let item = type._start;
    while (item) {
      const t = item.content?.type;
      if (t instanceof Y.XmlElement) {
        if (item.deleted) out.add(`${item.id.client}:${item.id.clock}`);
        walk(t);
      }
      item = item.right;
    }
  }
  walk(doc.getXmlFragment(PM_FRAGMENT));
  return out;
}

export function classifyLoss(doc: Y.Doc, token: string, humanDeleted: Set<string> = new Set()): LossCause {
  const item = findTokenItem(doc.getXmlFragment(PM_FRAGMENT), token);
  if (!item) return "not-found";
  // Topmost deleted ancestor element.
  let topDeleted: any = null;
  let parentItem = item.parent?._item ?? null;
  while (parentItem) {
    if (parentItem.deleted) topDeleted = parentItem;
    parentItem = parentItem.parent?._item ?? null;
  }
  if (!topDeleted) return item.deleted ? "text-deleted" : "not-found";
  // A human deleting an ancestor loses the text with or without a rebase.
  for (let h = item.parent?._item ?? null; h; h = h.parent?._item ?? null) {
    if (h.deleted && humanDeleted.has(`${h.id.client}:${h.id.clock}`)) return "human-delete";
  }
  // Otherwise any deleted ancestor removed by a rebase makes it a rebase loss.
  let p = item.parent?._item ?? null;
  while (p) {
    if (p.deleted && rebaseDeleted(doc, p.id)) return "rebase-no-resurrect";
    p = p.parent?._item ?? null;
  }
  return "human-delete";
}
