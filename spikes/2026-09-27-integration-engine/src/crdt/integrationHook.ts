// Plan section 3's "onRemoteBatch(doc, isRemoteOrigin, handler(beforeSnapshot))":
// spike 5's `attachIntegrationHook` mechanics (collab-stack-yjs13-hocuspocus,
// branch spike/2026-09-27-collab-stack, commit eeb3fe2,
// src/rebase/liveIntegration.ts), with the integration logic itself removed
// -- that is engine/integrate.ts's job (brief 03 task 4), not this module's;
// this file only owns the "snapshot before a remote transaction, callback
// after" mechanics, generalized to take any handler rather than calling
// `integrate()` directly.
import * as Y from 'yjs';

export const INTEGRATION_ORIGIN_MARKER = 'phraise-integration';

export interface OnRemoteBatchHandle {
  detach(): void;
}

/**
 * Runs `handler(beforeSnapshot)` once after every remote batch applied to
 * `doc` (a batch is one or more coalesced Yjs transactions between
 * `beforeTransaction` and the matching `afterTransaction`), where
 * `isRemoteOrigin(origin)` decides which transactions qualify.
 * `beforeSnapshot` is `Y.snapshot(doc)` taken just before the FIRST
 * transaction of the batch -- the state the handler needs to diff against
 * (spike 2's integration algorithm; see engine/integrate.ts).
 *
 * Transactions tagged with `INTEGRATION_ORIGIN_MARKER` are always skipped
 * (regardless of `isRemoteOrigin`), so a handler's own writes -- if it
 * transacts on `doc` with this origin -- never re-trigger themselves.
 * Callers that want this protection should transact with that origin (see
 * engine/integrate.ts).
 */
export function onRemoteBatch(doc: Y.Doc, isRemoteOrigin: (origin: unknown) => boolean, handler: (beforeSnapshot: Uint8Array) => void): OnRemoteBatchHandle {
  let pending: Y.Snapshot | undefined;

  const beforeHandler = (transaction: Y.Transaction) => {
    if (transaction.origin === INTEGRATION_ORIGIN_MARKER) return;
    if (!isRemoteOrigin(transaction.origin)) return;
    if (pending === undefined) pending = Y.snapshot(doc);
  };

  const afterHandler = (transaction: Y.Transaction) => {
    if (transaction.origin === INTEGRATION_ORIGIN_MARKER) return;
    if (!isRemoteOrigin(transaction.origin)) return;
    if (pending === undefined) return;
    const before = pending;
    pending = undefined;
    handler(Y.encodeSnapshot(before));
  };

  doc.on('beforeTransaction', beforeHandler);
  doc.on('afterTransaction', afterHandler);

  return {
    detach() {
      doc.off('beforeTransaction', beforeHandler);
      doc.off('afterTransaction', afterHandler);
    },
  };
}

/**
 * True if applying `update` to `doc` would leave structs waiting on missing
 * dependencies (a probe copy is used so this never mutates `doc` itself).
 * Spike 2's finding (`src/rebase/replica.ts`'s own comment, carried over):
 * Yjs applies an update's delete set immediately even when some of its
 * structs must wait for missing dependencies, so a test harness that
 * shuffles delivery order must hold back any update that would leave
 * structs pending until its dependencies have arrived -- otherwise a
 * chained rebase delivered out of order can delete blocks before the
 * integration step (or comment resolution) can see their pre-merge state.
 * `src/testkit/hub.ts` uses this for causal delivery; exported from crdt
 * because it needs `doc.store.pendingStructs`, a raw Yjs internal no other
 * module may touch.
 */
export function wouldPend(doc: Y.Doc, update: Uint8Array): boolean {
  const probe = new Y.Doc({ gc: false });
  Y.applyUpdate(probe, Y.encodeStateAsUpdate(doc));
  Y.applyUpdate(probe, update);
  return (probe as any).store.pendingStructs !== null;
}
