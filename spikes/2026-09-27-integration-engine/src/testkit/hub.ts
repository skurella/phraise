// Brief 03 task 7: "replicas as separate CrdtDocs exchanging updates in
// causal order through a tiny in-test hub (see spike 2's replica.ts for the
// idea; keep it in src/testkit/hub.ts)". Idea taken from spike 2's
// `Replica`/`deliver` (collab-stack-yjs13-hocuspocus, branch
// spike/2026-09-27-collab-stack, commit eeb3fe2, src/rebase/replica.ts --
// itself spike 2's), rebuilt from scratch on this spike's public crdt
// interface only (`onUpdate`/`applyUpdate`/`encodeState`/`wouldPend`) --
// unlike spike 2's replica.ts, this module lives in src/testkit/ (NOT
// src/crdt/), so it may not import `yjs` itself (test/import-boundary.test.ts
// enforces this for every file outside src/crdt/); everything it needs is
// already exposed through crdt's opaque `CrdtDoc`/`CrdtUpdate` API.
//
// Model: a fully-connected mesh (every joined member is linked to every
// other), one FIFO queue per ordered pair, `deliver(from, to, order?)` for
// explicit, optionally-reordered delivery (gate-D-style permutation tests),
// `deliverAll()` for tests that only want eventual convergence. Causal
// delivery (spike 2's finding, carried over verbatim in `wouldPend`'s own
// doc comment): Yjs applies an update's delete set immediately even when
// some of its structs must wait for missing dependencies, so `deliver` holds
// back any update that would leave structs pending -- across calls, and
// across senders -- until its dependencies have arrived.
import { onUpdate, applyUpdate, encodeState, wouldPend, type CrdtDoc, type CrdtUpdate } from '../crdt/index.js';

/** Transaction origin every `Hub.deliver` call applies incoming updates with, so a joined doc's `isRemoteOrigin` predicate (crdt's `onRemoteBatch`, engine's `attachIntegration`) can recognize them as remote. */
export const HUB_REMOTE_ORIGIN = 'phraise-hub-remote';

export class Hub {
  private members = new Map<string, CrdtDoc>();
  private queues = new Map<string, Map<string, CrdtUpdate[]>>();
  private heldFor = new Map<string, CrdtUpdate[]>();
  private unsubs = new Map<string, () => void>();

  /** Add `doc` to the hub under `name`, linked to every already-joined member. Sends each direction's current full state once (harmless: Yjs no-ops already-known ops) so a doc seeded independently before joining still converges with what everyone else already has, exactly like a local edit made after joining would. */
  join(name: string, doc: CrdtDoc): void {
    if (this.members.has(name)) throw new Error(`hub: "${name}" already joined`);
    this.members.set(name, doc);
    this.queues.set(name, new Map());
    this.heldFor.set(name, []);

    for (const other of this.members.keys()) {
      if (other === name) continue;
      this.queues.get(name)!.set(other, []);
      this.queues.get(other)!.set(name, []);

      const fromThis = encodeState(doc);
      if (fromThis.length > 2) this.queues.get(name)!.get(other)!.push(fromThis);
      const otherDoc = this.members.get(other)!;
      const fromOther = encodeState(otherDoc);
      if (fromOther.length > 2) this.queues.get(other)!.get(name)!.push(fromOther);
    }

    const unsub = onUpdate(doc, (update, origin) => {
      // Don't re-queue what the hub itself just delivered TO this member --
      // Yjs would no-op the duplicate anyway, but this keeps queues from
      // growing without bound in a long-running fuzz/gate run.
      if (origin === HUB_REMOTE_ORIGIN) return;
      for (const q of this.queues.get(name)!.values()) q.push(update);
    });
    this.unsubs.set(name, unsub);
  }

  /** Remove `name` from the hub (stops forwarding its future updates; any already-queued updates to/from it are dropped). */
  leave(name: string): void {
    this.unsubs.get(name)?.();
    this.unsubs.delete(name);
    this.members.delete(name);
    this.queues.delete(name);
    this.heldFor.delete(name);
    for (const q of this.queues.values()) q.delete(name);
  }

  private queueFor(from: string, to: string): CrdtUpdate[] {
    const q = this.queues.get(from)?.get(to);
    if (!q) throw new Error(`hub: no link ${from} -> ${to} (both must be joined)`);
    return q;
  }

  /** Number of updates currently queued from `from` to `to` (not yet delivered; does not count anything held back at `to` for unmet dependencies). */
  pending(from: string, to: string): number {
    return this.queueFor(from, to).length;
  }

  /**
   * Deliver everything currently queued from `from` to `to`. `order`, if
   * given, must be a permutation of `[0, queue.length)` (FIFO otherwise) --
   * for gate-D-style "does convergence hold under every delivery order"
   * tests. Clears the queue (only what was queued at call time is
   * delivered); an update that would leave structs pending is held back at
   * `to` (persists across calls/senders) until its dependencies arrive.
   */
  deliver(from: string, to: string, order?: number[]): void {
    const q = this.queueFor(from, to);
    const held = this.heldFor.get(to)!;
    if (q.length === 0 && held.length === 0) return;
    const toDoc = this.members.get(to)!;
    const taken = order ? order.map((i) => q[i]) : q.slice();
    q.length = 0;

    let queue = [...held, ...taken];
    this.heldFor.set(to, []);
    let progress = true;
    while (progress && queue.length > 0) {
      progress = false;
      const rest: CrdtUpdate[] = [];
      for (const u of queue) {
        if (wouldPend(toDoc, u)) {
          rest.push(u);
        } else {
          applyUpdate(toDoc, u, HUB_REMOTE_ORIGIN);
          progress = true;
        }
      }
      queue = rest;
    }
    this.heldFor.set(to, queue);
  }

  /** `deliver` every ordered pair, repeatedly, until every queue and every held-back update is drained. For tests that only care about eventual convergence, not a specific delivery order. */
  deliverAll(): void {
    let changed = true;
    while (changed) {
      changed = false;
      for (const from of this.members.keys()) {
        for (const to of this.members.keys()) {
          if (from === to) continue;
          if (this.pending(from, to) > 0 || this.heldFor.get(to)!.length > 0) {
            this.deliver(from, to);
            changed = true;
          }
        }
      }
    }
  }

  names(): string[] {
    return [...this.members.keys()];
  }
}
