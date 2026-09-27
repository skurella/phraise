// Brief 06 task 3/4: the per-replica integration hook (plan section 5, run
// by every replica before applying a remote batch), ported from stack13's
// version. The design is entirely Yjs-generic (Y.Doc's own
// `beforeTransaction`/`afterTransaction` events, `Y.snapshot`,
// `doc.clientID`) -- all confirmed present unchanged on `@y/y`'s `Doc`
// (checked node_modules/@y/y/src/utils/Doc.js before relying on it) -- so
// this file needed NO Yjs-14-specific changes beyond importing our own
// (ported) integrate.ts.
//
// `isRemoteOrigin` decides which transactions qualify (must NOT run after a
// replica's own local edits, must not recurse into its own `integrate`
// transaction):
//   - Live client (src/rebase/liveClient.ts): incoming sync/update messages
//     are applied by @hocuspocus/provider with `transactionOrigin = provider`
//     (the HocuspocusProvider instance itself) -- same as stack13, since
//     this stack's relay/client also route Yjs functionality through the
//     bare `yjs` specifier that @hocuspocus/provider itself imports.
//   - Relay (src/relay-hocuspocus.ts): @hocuspocus/server tags
//     connection-sourced transactions `{ source: 'connection', connection }`
//     -- same mechanism this package's own src/relay-hocuspocus.ts already
//     relies on for gate E's attribution (`onChange`'s `transactionOrigin`
//     check), confirmed by reading the same source stack13 did.
//
// Every transaction whose origin is `'integrate'` (integrate.ts's own
// `doc.transact(fn, "integrate")`) is always skipped first, so integrate's
// own writes never re-trigger this hook (no recursion).
import * as Y from "yjs";
import { integrate } from "./integrate.js";

export const INTEGRATE_TX_ORIGIN = "integrate";

export interface IntegrationHookOptions {
  isRemoteOrigin: (origin: unknown) => boolean;
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

  doc.on("beforeTransaction", beforeHandler);
  doc.on("afterTransaction", afterHandler);

  return {
    detach() {
      doc.off("beforeTransaction", beforeHandler);
      doc.off("afterTransaction", afterHandler);
    },
  };
}

/** `isRemoteOrigin` for a live client: origin is the client's own HocuspocusProvider instance. */
export function isProviderOrigin(provider: unknown): (origin: unknown) => boolean {
  return (origin) => origin === provider;
}

/** `isRemoteOrigin` for the relay: @hocuspocus/server tags connection-sourced transactions `{ source: 'connection', connection }`. */
export function isConnectionOrigin(origin: unknown): boolean {
  return !!origin && typeof origin === "object" && (origin as Record<string, unknown>).source === "connection";
}
