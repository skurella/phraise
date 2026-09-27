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

  /** Queue `update` for delivery to every linked peer except `excludeName`
   * (the peer we just received this content from, if any — see `receive`). */
  private emit(update: Uint8Array, excludeName?: string): void {
    for (const peer of this.peers) {
      if (peer.name === excludeName) continue;
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

  /** Remove and return the first `n` updates queued to `peerName`, leaving
   * the rest queued (fuzz harness: partial pre-rebase delivery, brief 03). */
  _takePrefixTo(peerName: string, n: number): Uint8Array[] {
    const q = this.outbox.get(peerName);
    if (!q) return [];
    const k = Math.max(0, Math.min(n, q.length));
    return q.splice(0, k);
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
   *
   * `fromName`, when given, names the peer these `updates` came from. It is
   * excluded from the re-broadcast, but *only* when this call produced no
   * genuinely new content of this replica's own (see below) — found by the
   * fuzz harness, brief 03: `Y.encodeStateAsUpdate(doc, before)` always
   * restates the doc's *entire* delete set regardless of `before` — it is
   * not filtered by the state vector the way new structs are — so once a
   * doc has any deletions at all, this method's `delta` is essentially
   * always non-trivially sized, even when every struct in it is already
   * known to every peer. In a hub topology where every replica relays to
   * *all* its peers, unconditionally echoing that "delta" straight back to
   * the very peer that just sent it bounces server<->spoke forever and the
   * hub's fan-out multiplies each bounce across every other spoke, so the
   * queued-update count grows without bound (confirmed empirically:
   * identical ~277-byte payloads recurring with growing multiplicity, see
   * the builder log).
   *
   * The unconditional version of this fix regressed gates D/D2/F (also
   * confirmed empirically): `integrate()` can write genuinely new content
   * under *this* replica's own clientID as a side effect of processing the
   * incoming batch — a resurrection, a review flag, an ack — and if the
   * peer we're excluding is our *only* peer (e.g. an offline replica whose
   * one link is the hub), that new content would never reach anyone.
   * Restated-but-already-known content is safe to withhold from the
   * sender specifically; this replica's own new writes are not. So the
   * exclusion only applies when this replica's own clientID clock did not
   * advance during this call (i.e. nothing new was produced locally) —
   * content-neutral either way: it only ever drops a message that would
   * have been a no-op for its specific recipient, never a change to any
   * CRDT/rebase/integrate semantics.
   */
  receive(updates: Uint8Array[], fromName?: string): void {
    if (updates.length === 0) return;
    const P = Y.snapshot(this.doc);
    const before = Y.encodeStateVector(this.doc);
    const myClockBefore = Y.decodeStateVector(before).get(this.clientID) ?? 0;
    for (const u of updates) Y.applyUpdate(this.doc, u, "remote");
    integrate(this.doc, P, this.clientID);
    const delta = Y.encodeStateAsUpdate(this.doc, before);
    if (delta.length > 2) {
      const myClockAfter = Y.decodeStateVector(Y.encodeStateVector(this.doc)).get(this.clientID) ?? 0;
      const producedOwnContent = myClockAfter > myClockBefore;
      this.emit(delta, producedOwnContent ? undefined : fromName);
    }
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

  // Fuzz harness addition (brief 03): split a top-level paragraph the way
  // y-prosemirror does — delete the tail from the XmlText, insert a new
  // paragraph element holding the tail (plain text; marks on the tail are
  // not preserved, a documented simplification consistent with
  // `insertBlock`'s plain-text-only inserts). Top-level-only, same
  // simplification as `insertBlock`/`deleteBlock`.
  splitParagraphAt(offset: number): void {
    this.runLocal(() => {
      const { segments } = docPlainText(this.doc);
      const pos = offsetToPosition(segments, offset);
      if (!pos) throw new Error(`splitParagraphAt: offset ${offset} out of range`);
      const xmlText = pos.xmlText;
      const fragment = this.doc.getXmlFragment(PM_FRAGMENT);
      const top = fragment.toArray();
      const blockIndex = top.findIndex(
        (child) => child instanceof Y.XmlElement && child.toArray()[0] === xmlText
      );
      if (blockIndex < 0) {
        throw new Error("splitParagraphAt: target is not a top-level block's text");
      }
      const full = (xmlText.toDelta() as any[]).map((d) => d.insert).join("");
      const tail = full.slice(pos.index);
      if (tail.length > 0) xmlText.delete(pos.index, tail.length);
      const newPara = new Y.XmlElement("paragraph");
      if (tail.length > 0) {
        const newText = new Y.XmlText();
        newText.insert(0, tail);
        newPara.insert(0, [newText]);
      }
      fragment.insert(blockIndex + 1, [newPara]);
    }, "edit");
  }

  // Fuzz harness addition (brief 03): change a top-level heading's level.
  // Top-level-only, same simplification as `insertBlock`/`deleteBlock`.
  setHeadingLevel(index: number, level: number): void {
    this.runLocal(() => {
      const fragment = this.doc.getXmlFragment(PM_FRAGMENT);
      const el = fragment.toArray()[index];
      if (!(el instanceof Y.XmlElement) || el.nodeName !== "heading") {
        throw new Error(`setHeadingLevel: block ${index} is not a heading`);
      }
      el.setAttribute("level", level as any);
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
  to.receive(ordered, from.name);
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
