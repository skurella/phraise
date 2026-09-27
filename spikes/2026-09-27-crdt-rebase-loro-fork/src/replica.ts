// Replica harness (brief 4 item 6: gates), Loro version. Adapted from
// spikes/2026-09-27-crdt-rebase-yjs-fork/src/replica.ts, structurally, but
// materially simpler for two reasons found while building this:
//
// 1. `LoroDoc.subscribeLocalUpdates(cb)` fires ONLY for genuinely local
//    commits, never for content that arrived via `.import()` (verified: the
//    package's own doc comment shows two docs syncing purely through
//    subscribeLocalUpdates + import with no dedup logic). The Yjs fork's
//    entire "relay-storm" bug (README, "Real bugs found") -- caused by
//    `Y.encodeStateAsUpdate(doc, before)` always restating the delete set,
//    making receive() think a no-op relay was "new" and bounce it back --
//    has no equivalent here: there is nothing to accidentally re-emit,
//    because import() never triggers the local-update callback at all. We
//    still explicitly relay a received batch to other peers (a star
//    topology needs that), but there is no risk of an unbounded bounce.
// 2. `doc.import(update)` returns `{ pending: Map<PeerID, CounterSpan> |
//    null }`, telling us directly whether some of what we just imported is
//    still waiting on a missing dependency -- Loro tracks this internally
//    across calls, so unlike the Yjs fork we do not need to hand-roll a
//    `wouldPend`/held-queue mechanism to get eventual convergence under
//    out-of-order delivery; we only track a `held` list here to retry
//    delivering things this replica has learned are still pending elsewhere.
//
// Open question, NOT verified to the Yjs fork's level of rigor (logged, not
// claimed): whether Loro's container-delete visibility can jump ahead of
// pending structs the way Yjs's delete-set application did (the actual root
// cause of the Yjs fork's "chained rebase C could hide P2's pre-merge state"
// finding). Given the time budget this was not specifically fuzzed for
// chained (B-then-C) rebases; gate D here only exercises a single rebase.
import { LoroDoc, type Frontiers } from "loro-crdt";
import { seedDoc, docToPM, type Author } from "./seed.js";
import { computeRebaseUpdate, type RebaseOptions } from "./rebase.js";
import { integrate } from "./integrate.js";
import { hash32Peer } from "./ids.js";
import { ROOT_DOC_KEY, AUTHORS_MAP, getChildren, buildLoroNode, type TextRun } from "./loro-doc.js";
import type { LoroNode } from "loro-prosemirror";
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
  readonly doc: LoroDoc;
  readonly peer: string;
  online = true;

  private peers = new Set<Replica>();
  private outbox = new Map<string, Uint8Array[]>();
  private held: Uint8Array[] = [];

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
    this.peer = hash32Peer(`${docId}:replica:${name}`);
    this.doc.setPeerId(this.peer as `${number}`);

    if (user) {
      this.doc.getMap(AUTHORS_MAP).set(this.peer, { kind: "human", userId: user.userId, name: user.name });
      this.doc.commit({ origin: "author-register" });
    }

    this.doc.subscribeLocalUpdates((bytes) => this.emit(bytes));
  }

  setOnline(v: boolean): void {
    this.online = v;
  }

  /** Connect this replica to another; each direction gets its own queue, seeded with each side's full current state so nothing before the link is missed. */
  link(other: Replica): void {
    this.peers.add(other);
    other.peers.add(this);
    if (!this.outbox.has(other.name)) this.outbox.set(other.name, []);
    if (!other.outbox.has(this.name)) other.outbox.set(this.name, []);
    const fromThis = this.doc.export({ mode: "snapshot" });
    this.outbox.get(other.name)!.push(fromThis);
    const fromOther = other.doc.export({ mode: "snapshot" });
    other.outbox.get(this.name)!.push(fromOther);
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

  /**
   * Import `updates` (any order tolerated -- Loro tracks pending
   * dependencies internally, see file header), take `priorFrontiers` right
   * before, then run integrate(). Relays `updates` to every peer except
   * `fromName`.
   */
  receive(updates: Uint8Array[], fromName?: string): void {
    if (updates.length === 0) return;
    const priorFrontiers: Frontiers = this.doc.frontiers();
    const queue = [...this.held, ...updates];
    this.held = [];
    for (const u of queue) {
      try {
        this.doc.import(u);
      } catch (e) {
        // Out-of-order snapshot/update Loro can't place yet; retry on the
        // next receive() once more of the history has arrived.
        this.held.push(u);
      }
    }
    integrate(this.doc, priorFrontiers, this.peer);
    this.doc.commit({ origin: "integrate" });
    for (const peer of this.peers) {
      if (peer.name === fromName) continue;
      const q = this.outbox.get(peer.name);
      if (q) q.push(...updates);
    }
  }

  // --- edit helpers ---

  insertText(offset: number, text: string): void {
    const { segments } = docPlainText(this.doc);
    const pos = offsetToPosition(segments, offset);
    if (!pos) throw new Error(`insertText: offset ${offset} out of range`);
    pos.loroText.insert(pos.index, text);
    this.doc.commit({ origin: "edit" });
  }

  deleteText(offset: number, length: number): void {
    const { segments } = docPlainText(this.doc);
    const pos = offsetToPosition(segments, offset);
    if (!pos) throw new Error(`deleteText: offset ${offset} out of range`);
    pos.loroText.delete(pos.index, length);
    this.doc.commit({ origin: "edit" });
  }

  // Top-level-only (simplification, matching the Yjs fork's own note):
  // addresses a block by its index among the root doc's direct children.
  insertBlock(index: number, text: string, nodeName: "paragraph" | "heading" = "paragraph", attrs?: Record<string, any>): void {
    const root = this.doc.getMap(ROOT_DOC_KEY) as unknown as LoroNode;
    const children = getChildren(root);
    const runs: TextRun[] = text.length > 0 ? [{ insert: text, attributes: {} }] : [];
    const fakeNode = {
      type: { name: nodeName },
      attrs: attrs ?? {},
      isText: false,
      forEach: (cb: (n: any) => void) => {
        for (const r of runs) cb({ text: r.insert, marks: [] });
      },
    } as unknown as PMNode;
    buildLoroNode(children, index, fakeNode);
    this.doc.commit({ origin: "edit" });
  }

  deleteBlock(index: number): void {
    const root = this.doc.getMap(ROOT_DOC_KEY) as unknown as LoroNode;
    getChildren(root).delete(index, 1);
    this.doc.commit({ origin: "edit" });
  }

  docToPM(): PMNode {
    return docToPM(this.doc);
  }

  runRebase(targetMarkdown: string, commit: string, author: Author, granularity: Granularity = "word"): string {
    const opts: RebaseOptions = { docId: this.docId, targetMarkdown, targetCommit: commit, author, granularity };
    const { update, rebaseId } = computeRebaseUpdate(this.doc, opts);
    this.receive([update]);
    return rebaseId;
  }
}

export function deliver(from: Replica, to: Replica, order?: number[]): void {
  const queue = from._queueTo(to.name);
  if (!queue || queue.length === 0) return;
  const indices = order ?? queue.map((_, i) => i);
  const ordered = indices.map((i) => queue[i]);
  queue.length = 0;
  to.receive(ordered, from.name);
}
