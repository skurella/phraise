// Brief 05 task 2/3: the per-replica integration hook (plan section 5, run
// by every replica before applying a remote batch) reimplemented for a real
// Y.Doc driven by Hocuspocus/y-protocols, instead of spike 2's replica.ts
// (which called `integrate(doc, P, myClientId)` itself, inline, from its own
// `receive()` method -- there is no such single choke point here, since
// Hocuspocus's server and HocuspocusProvider apply incoming sync messages
// directly via `Y.applyUpdate`).
//
// Design (per the brief): use the Y.Doc's own `beforeTransaction`/
// `afterTransaction` events. `beforeTransaction` snapshots P = Y.snapshot(doc)
// -- the replica's own state just before the incoming batch is merged, which
// is exactly what `integrate` needs and exactly what spike 2's `receive()`
// captured before applying anything. `afterTransaction` then runs
// `integrate(doc, P, doc.clientID)`; `integrate` itself is a no-op ("pending
// pending.length === 0 return") whenever the transaction carried no new,
// not-yet-acked rebase record, so calling it unconditionally after every
// qualifying transaction is cheap and correct -- it does not need a separate
// "did this transaction bring a rebase record" check.
//
// `isRemoteOrigin` decides which transactions qualify, since this hook must
// NOT run after a replica's own local edits (spike 2's `integrate` is for
// incoming batches only) and must not recurse into its own `integrate`
// transaction:
//   - Live client (src/client.ts): incoming sync/update messages are applied
//     by `y-protocols`' `readSyncMessage`/`readUpdate` with `transactionOrigin
//     = provider` (the `HocuspocusProvider` instance itself -- confirmed by
//     reading node_modules/@hocuspocus/provider's `applySyncMessage`, which
//     calls `readSyncMessage(..., provider.document, provider)`). So
//     `isRemoteOrigin = (origin) => origin === provider`.
//   - Relay (src/relay.ts): @hocuspocus/server's own `readSyncMessage` passes
//     `transactionOrigin = { source: 'connection', connection }` when a
//     client connection is behind the message, or `{ source: 'local' }`
//     otherwise (confirmed by reading `Hocuspocus.readSyncMessage`'s
//     `readSyncStep2`/`readUpdate` calls). So
//     `isRemoteOrigin = (origin) => (origin as any)?.source === 'connection'`
//     -- this also correctly excludes the relay's own `Y.applyUpdate(document,
//     rebaseUpdate, 'rebase')` call (src/relay.ts's rebase route), which is
//     the relay's own authoritative write, not an incoming replica batch, and
//     needs no integration step of its own (see that file's comment).
//
// Every transaction whose origin is `'integrate'` (the literal string
// integrate.ts's own `doc.transact(fn, "integrate")` uses as its origin) is
// always skipped first, regardless of `isRemoteOrigin`, so integrate's own
// writes never re-trigger this hook (no recursion).
import * as Y from 'yjs';
import { integrate } from './integrate.js';

export const INTEGRATE_TX_ORIGIN = 'integrate';

export interface IntegrationHookOptions {
  isRemoteOrigin: (origin: unknown) => boolean;
  /** Optional: called every time integrate() actually ran (test/debug hook). */
  onIntegrated?: (doc: Y.Doc) => void;
}

export interface IntegrationHookHandle {
  detach(): void;
}

export function attachIntegrationHook(doc: Y.Doc, opts: IntegrationHookOptions): IntegrationHookHandle {
  let pendingSnapshot: Y.Snapshot | undefined;

  const beforeHandler = (transaction: Y.Transaction) => {
    if (transaction.origin === INTEGRATE_TX_ORIGIN) return;
    if (!opts.isRemoteOrigin(transaction.origin)) return;
    // A batch already in flight (nested/coalesced transactions) keeps its
    // own earlier snapshot -- P must be the state strictly before the whole
    // batch, not before its last sub-transaction.
    if (pendingSnapshot === undefined) pendingSnapshot = Y.snapshot(doc);
  };

  const afterHandler = (transaction: Y.Transaction) => {
    if (transaction.origin === INTEGRATE_TX_ORIGIN) return;
    if (!opts.isRemoteOrigin(transaction.origin)) return;
    if (pendingSnapshot === undefined) return;
    const P = pendingSnapshot;
    pendingSnapshot = undefined;
    integrate(doc, P, doc.clientID);
    opts.onIntegrated?.(doc);
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

/** `isRemoteOrigin` for a live client: origin is the client's own HocuspocusProvider instance. */
export function isProviderOrigin(provider: unknown): (origin: unknown) => boolean {
  return (origin) => origin === provider;
}

/** `isRemoteOrigin` for the relay: @hocuspocus/server tags connection-sourced transactions `{ source: 'connection', connection }`. */
export function isConnectionOrigin(origin: unknown): boolean {
  return !!origin && typeof origin === 'object' && (origin as Record<string, unknown>).source === 'connection';
}
