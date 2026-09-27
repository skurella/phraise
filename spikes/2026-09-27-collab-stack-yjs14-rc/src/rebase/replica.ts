// Replica harness (headless, for gates A-D2 and the idempotent gate),
// ported to Yjs 14. Same delivery model and design notes as stack13's
// version (see there for the full rationale); only the Y API surface
// changed (Y.Node instead of Y.XmlElement/Y.XmlText, doc.get(name) instead
// of getXmlFragment/getMap).
import * as Y from "yjs";
import { ContentString } from "yjs";
import { seedDoc, docToPM, AUTHORS_MAP, PM_FRAGMENT, type Author } from "./seed.js";
import { computeRebaseUpdate, type RebaseOptions } from "./rebase.js";
import { integrate } from "./integrate.js";
import { hash32 } from "./ids.js";
import type { Node as PMNode } from "prosemirror-model";
import { docPlainText, offsetToPosition } from "./text.js";

export interface ReplicaUser {
  userId: string;
  name: string;
}

/** True if applying `update` to `doc` would leave structs waiting on missing dependencies. */
function wouldPend(doc: Y.Doc, update: Uint8Array): boolean {
  const probe = new Y.Doc({ gc: false });
  Y.applyUpdate(probe, Y.encodeStateAsUpdate(doc));
  Y.applyUpdate(probe, update);
  return (probe as any).store.pendingStructs !== null;
}

export class Replica {
  readonly name: string;
  readonly docId: string;
  readonly doc: Y.Doc;
  readonly clientID: number;
  online = true;

  private peers = new Set<Replica>();
  private outbox = new Map<string, Uint8Array[]>();

  constructor(name: string, docId: string, seedMarkdown: string, commit: string, gitAuthor: Author, user?: ReplicaUser) {
    this.name = name;
    this.docId = docId;
    this.doc = seedDoc(docId, seedMarkdown, commit, gitAuthor);

    this.clientID = hash32(`${docId}:replica:${name}`);
    this.doc.clientID = this.clientID;

    this.doc.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin === "remote") this.emit(update, this.currentSender);
      else this.emit(update);
    });

    if (user) {
      this.doc.transact(() => {
        this.doc.get(AUTHORS_MAP).setAttr(String(this.clientID), {
          kind: "human",
          userId: user.userId,
          name: user.name,
        });
      }, "author-register");
    }
  }

  setOnline(v: boolean): void {
    this.online = v;
  }

  link(other: Replica): void {
    this.peers.add(other);
    other.peers.add(this);
    if (!this.outbox.has(other.name)) this.outbox.set(other.name, []);
    if (!other.outbox.has(this.name)) other.outbox.set(this.name, []);

    const fromThis = Y.encodeStateAsUpdate(this.doc);
    if (fromThis.length > 2) this.outbox.get(other.name)!.push(fromThis);
    const fromOther = Y.encodeStateAsUpdate(other.doc);
    if (fromOther.length > 2) other.outbox.get(this.name)!.push(fromOther);
  }

  private emit(update: Uint8Array, excludeName?: string): void {
    for (const peer of this.peers) {
      if (peer.name === excludeName) continue;
      const q = this.outbox.get(peer.name);
      if (q) q.push(update);
    }
  }

  _queueTo(peerName: string): Uint8Array[] | undefined {
    return this.outbox.get(peerName);
  }

  _takeQueueTo(peerName: string): Uint8Array[] {
    const q = this.outbox.get(peerName);
    if (!q) return [];
    const taken = q.slice();
    q.length = 0;
    return taken;
  }

  _takePrefixTo(peerName: string, n: number): Uint8Array[] {
    const q = this.outbox.get(peerName);
    if (!q) return [];
    const k = Math.max(0, Math.min(n, q.length));
    return q.splice(0, k);
  }

  private currentSender: string | undefined;

  private runLocal(fn: () => void, origin: string): void {
    this.doc.transact(fn, origin);
  }

  private held: Uint8Array[] = [];

  receive(updates: Uint8Array[], fromName?: string): void {
    if (updates.length === 0) return;
    const P = Y.snapshot(this.doc);
    let queue = [...this.held, ...updates];
    this.held = [];
    this.currentSender = fromName;
    try {
      let progress = true;
      while (progress && queue.length > 0) {
        progress = false;
        const rest: Uint8Array[] = [];
        for (const u of queue) {
          if (wouldPend(this.doc, u)) rest.push(u);
          else {
            Y.applyUpdate(this.doc, u, "remote");
            progress = true;
          }
        }
        queue = rest;
      }
    } finally {
      this.currentSender = undefined;
    }
    this.held = queue;
    integrate(this.doc, P, this.clientID);
  }

  // --- edit helpers (go straight to the block's own Y.Node, as
  // @y/prosemirror's syncPlugin would for typing) ---

  insertText(offset: number, text: string): void {
    this.runLocal(() => {
      const { segments } = docPlainText(this.doc);
      const pos = offsetToPosition(segments, offset);
      if (!pos) throw new Error(`insertText: offset ${offset} out of range`);
      pos.node.insert(pos.index, text);
    }, "edit");
  }

  deleteText(offset: number, length: number): void {
    this.runLocal(() => {
      const { segments } = docPlainText(this.doc);
      const pos = offsetToPosition(segments, offset);
      if (!pos) throw new Error(`deleteText: offset ${offset} out of range`);
      pos.node.delete(pos.index, length);
    }, "edit");
  }

  // Top-level-only (simplification, same as stack13): addresses a block by
  // its index among the root `pm` fragment's direct children.
  insertBlock(index: number, text: string, nodeName: "paragraph" | "heading" = "paragraph", attrs?: Record<string, any>): void {
    this.runLocal(() => {
      const fragment = this.doc.get(PM_FRAGMENT);
      const el = new Y.Node(nodeName);
      if (attrs) {
        for (const k in attrs) el.setAttr(k, attrs[k]);
      }
      if (text.length > 0) {
        el.insert(0, text);
      }
      fragment.insert(index, [el]);
    }, "edit");
  }

  deleteBlock(index: number): void {
    this.runLocal(() => {
      const fragment = this.doc.get(PM_FRAGMENT);
      fragment.delete(index, 1);
    }, "edit");
  }

  // Fuzz harness parity with stack13: split a top-level paragraph -- delete
  // the tail, insert a new paragraph node holding the tail (plain text;
  // marks on the tail are not preserved, same documented simplification as
  // stack13's `insertBlock`/`splitParagraphAt`). Top-level-only.
  splitParagraphAt(offset: number): void {
    this.runLocal(() => {
      const { segments } = docPlainText(this.doc);
      const pos = offsetToPosition(segments, offset);
      if (!pos) throw new Error(`splitParagraphAt: offset ${offset} out of range`);
      const node = pos.node;
      const fragment = this.doc.get(PM_FRAGMENT);
      const top: any[] = [];
      let item = (fragment as any)._start;
      while (item) {
        if (!item.deleted && item.content && item.content.type) top.push(item.content.type);
        item = item.right;
      }
      const blockIndex = top.findIndex((child) => child === node);
      if (blockIndex < 0) {
        throw new Error("splitParagraphAt: target is not a top-level block");
      }
      let full = "";
      let it = node._start;
      while (it) {
        if (!it.deleted && it.content instanceof ContentString) full += (it.content as any).str;
        it = it.right;
      }
      const tail = full.slice(pos.index);
      if (tail.length > 0) node.delete(pos.index, tail.length);
      const newPara = new Y.Node("paragraph");
      if (tail.length > 0) newPara.insert(0, tail);
      fragment.insert(blockIndex + 1, [newPara]);
    }, "edit");
  }

  // Fuzz harness parity with stack13: change a top-level heading's level.
  setHeadingLevel(index: number, level: number): void {
    this.runLocal(() => {
      const fragment = this.doc.get(PM_FRAGMENT);
      const top: any[] = [];
      let item = (fragment as any)._start;
      while (item) {
        if (!item.deleted && item.content && item.content.type) top.push(item.content.type);
        item = item.right;
      }
      const el = top[index];
      if (el == null || el.name !== "heading") {
        throw new Error(`setHeadingLevel: block ${index} is not a heading`);
      }
      el.setAttr("level", level);
    }, "edit");
  }

  docToPM(): PMNode {
    return docToPM(this.doc);
  }

  /**
   * Compute the rebase update with computeRebaseUpdate, feed it through this
   * replica's own receive() so integration runs, and queue it to peers.
   */
  runRebase(targetMarkdown: string, commit: string, author: Author): string {
    const opts: RebaseOptions = {
      docId: this.docId,
      targetMarkdown,
      targetCommit: commit,
      author,
    };
    const { update, rebaseId } = computeRebaseUpdate(this.doc, opts);
    this.receive([update]);
    return rebaseId;
  }
}

/**
 * Deliver `from`'s currently-queued updates to `to`, optionally reordered.
 * `order` must be a permutation of `[0, queue.length)`; omit it for FIFO.
 * Clears the queue (only what was queued at call time is delivered).
 */
export function deliver(from: Replica, to: Replica, order?: number[]): void {
  const queue = from._queueTo(to.name);
  if (!queue || queue.length === 0) return;
  const indices = order ?? queue.map((_, i) => i);
  const ordered = indices.map((i) => queue[i]);
  queue.length = 0;
  to.receive(ordered, from.name);
}

export function runRebase(replica: Replica, targetMarkdown: string, commit: string, author: Author): string {
  return replica.runRebase(targetMarkdown, commit, author);
}
