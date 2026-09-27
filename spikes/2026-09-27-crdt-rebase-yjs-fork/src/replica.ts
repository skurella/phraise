// Replica harness (brief 02): wraps a Y.Doc (gc off) with a name and a human
// user, links between replicas carrying an explicit queue of updates, and
// deliver() so tests can apply queued updates in any order, including
// shuffled.
//
// Delivery model (a design decision the brief leaves open, logged here):
// every send — a local edit, or a receive() that both applied incoming
// updates and ran integrate() — queues its resulting delta on every link to
// a peer. Nothing auto-flushes, online or offline; a link's queue only
// drains when a test calls `deliver()`. This gives tests full control over
// delivery order (required by gate D's permutations) without `online` vs
// `offline` changing the mechanism — `online`/`offline` are informational
// flags matching the gate scenarios' narrative (e.g. "bob offline"), and a
// test simply chooses not to `deliver()` to/from an offline replica until it
// reconnects. Because receive() re-emits the *combined* delta (incoming
// updates + this replica's own integrate() side effects) to all its peers,
// a hub replica (e.g. "server") naturally relays what it learns to its other
// peers once the test delivers through it.
import * as Y from "yjs";
import { seedDoc, docToPM, AUTHORS_MAP, type Author } from "./seed.js";
import { computeRebaseUpdate, type RebaseOptions } from "./rebase.js";
import { integrate } from "./integrate.js";
import { hash32 } from "./ids.js";
import { PM_FRAGMENT } from "./seed.js";
import type { Granularity } from "./diff.js";
import type { Node as PMNode } from "prosemirror-model";
import { docPlainText, offsetToPosition } from "./text.js";

export interface ReplicaUser {
  userId: string;
  name: string;
}

export class Replica {
  readonly name: string;
  readonly docId: string;
  readonly doc: Y.Doc;
  readonly clientID: number;
  online = true;

  private peers = new Set<Replica>();
  private outbox = new Map<string, Uint8Array[]>();

  constructor(
    name: string,
    docId: string,
    seedMarkdown: string,
    commit: string,
    gitAuthor: Author,
    user?: ReplicaUser
  ) {
    this.name = name;
    this.docId = docId;
    this.doc = seedDoc(docId, seedMarkdown, commit, gitAuthor);

    // Deterministic client id for this replica's own future edits, distinct
    // from the (also deterministic) seed peer id used only for the seeding
    // transaction itself.
    this.clientID = hash32(`${docId}:replica:${name}`);
    this.doc.clientID = this.clientID;

    if (user) {
      this.doc.transact(() => {
        this.doc.getMap(AUTHORS_MAP).set(String(this.clientID), {
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

  /** Connect this replica to another; each direction gets its own queue. */
  link(other: Replica): void {
    this.peers.add(other);
    other.peers.add(this);
    if (!this.outbox.has(other.name)) this.outbox.set(other.name, []);
    if (!other.outbox.has(this.name)) other.outbox.set(this.name, []);

    // Queue each side's *full* current state (not just a delta) to the
    // other, covering anything that happened before this link — e.g. the
    // constructor's human-author registration, which (unlike edits) isn't
    // captured by `runLocal`/`receive` since it runs before any peer exists
    // to emit to. Without this, a replica's very first future delta (whose
    // "from" state vector already excludes that registration item) would
    // hit a permanent dependency gap on any peer that never separately
    // learned about clock 0 for that client, and yjs silently defers
    // (never applies) anything depending on it. Re-sending full state on
    // every link is redundant but harmless (yjs no-ops already-known ops).
    const fromThis = Y.encodeStateAsUpdate(this.doc);
    if (fromThis.length > 2) this.outbox.get(other.name)!.push(fromThis);
    const fromOther = Y.encodeStateAsUpdate(other.doc);
    if (fromOther.length > 2) other.outbox.get(this.name)!.push(fromOther);
  }

  /** Queue `update` for delivery to every linked peer. */
  private emit(update: Uint8Array): void {
    for (const peer of this.peers) {
      const q = this.outbox.get(peer.name);
      if (q) q.push(update);
    }
  }

  /** Read-only access for the module-level `deliver` helper. */
  _queueTo(peerName: string): Uint8Array[] | undefined {
    return this.outbox.get(peerName);
  }

  /** Remove and return everything currently queued to `peerName` (for tests that want individual-update-level control, e.g. gate D's shuffled delivery orders). */
  _takeQueueTo(peerName: string): Uint8Array[] {
    const q = this.outbox.get(peerName);
    if (!q) return [];
    const taken = q.slice();
    q.length = 0;
    return taken;
  }

  private runLocal(fn: () => void, origin: string): void {
    const before = Y.encodeStateVector(this.doc);
    this.doc.transact(fn, origin);
    const update = Y.encodeStateAsUpdate(this.doc, before);
    if (update.length > 2) this.emit(update);
  }

  /**
   * Take P = Y.snapshot(doc), apply `updates`, then run integrate(doc, P,
   * myClientId) (plan section 5). Any resulting local changes (integrate's
   * flags/resurrections) — plus the incoming content itself — are re-queued
   * to this replica's peers, so a hub relays what it learns onward.
   */
  receive(updates: Uint8Array[]): void {
    if (updates.length === 0) return;
    const P = Y.snapshot(this.doc);
    const before = Y.encodeStateVector(this.doc);
    for (const u of updates) Y.applyUpdate(this.doc, u, "remote");
    integrate(this.doc, P, this.clientID);
    const delta = Y.encodeStateAsUpdate(this.doc, before);
    if (delta.length > 2) this.emit(delta);
  }

  // --- edit helpers (go straight to the block's Y.XmlText, as
  // y-prosemirror would for typing) ---

  insertText(offset: number, text: string): void {
    this.runLocal(() => {
      const { segments } = docPlainText(this.doc);
      const pos = offsetToPosition(segments, offset);
      if (!pos) throw new Error(`insertText: offset ${offset} out of range`);
      pos.xmlText.insert(pos.index, text);
    }, "edit");
  }

  deleteText(offset: number, length: number): void {
    this.runLocal(() => {
      const { segments } = docPlainText(this.doc);
      const pos = offsetToPosition(segments, offset);
      if (!pos) throw new Error(`deleteText: offset ${offset} out of range`);
      pos.xmlText.delete(pos.index, length);
    }, "edit");
  }

  // Top-level-only (simplification, logged): addresses a block by its index
  // among the root `pm` fragment's direct children.
  insertBlock(
    index: number,
    text: string,
    nodeName: "paragraph" | "heading" = "paragraph",
    attrs?: Record<string, any>
  ): void {
    this.runLocal(() => {
      const fragment = this.doc.getXmlFragment(PM_FRAGMENT);
      const el = new Y.XmlElement(nodeName);
      if (attrs) {
        for (const k in attrs) el.setAttribute(k, attrs[k]);
      }
      if (text.length > 0) {
        const yText = new Y.XmlText();
        yText.insert(0, text);
        el.insert(0, [yText]);
      }
      fragment.insert(index, [el]);
    }, "edit");
  }

  deleteBlock(index: number): void {
    this.runLocal(() => {
      const fragment = this.doc.getXmlFragment(PM_FRAGMENT);
      fragment.delete(index, 1);
    }, "edit");
  }

  docToPM(): PMNode {
    return docToPM(this.doc);
  }

  /**
   * Compute the rebase update with computeRebaseUpdate, feed it through this
   * replica's own receive() so integration runs, and queue it to peers.
   */
  runRebase(
    targetMarkdown: string,
    commit: string,
    author: Author,
    granularity: Granularity = "word"
  ): string {
    const opts: RebaseOptions = {
      docId: this.docId,
      targetMarkdown,
      targetCommit: commit,
      author,
      granularity,
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
  to.receive(ordered);
}

export function runRebase(
  replica: Replica,
  targetMarkdown: string,
  commit: string,
  author: Author,
  granularity: Granularity = "word"
): string {
  return replica.runRebase(targetMarkdown, commit, author, granularity);
}
