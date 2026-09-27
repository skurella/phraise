// Brief 09 defect 1 fix. `engine/commit.ts`'s `recordCommit` used to take a
// fully fresh `snapshot(doc)` AFTER writing its own meta (`base`,
// `lastCommit`, clearing `editorsSinceCommit`), so that a later rebase's
// fork-from-this-base sees those writes (fixing the brief-06 tie-break
// bug: an immediate rebase's own `base` write no longer collides with a
// STALE pre-commit `base` entry surviving in a fork taken from the OLD
// snapshot). But "fully fresh" also means "whatever else happened to land
// on `doc` between `prepareCommit`'s snapshot and this call" -- and
// `relay/commit.ts` awaits a real git push in between, during which a
// concurrent editor's real Yjs update can land on the SAME shared `doc`
// (exactly what the relay's `onChange` hook applies for any other
// connection). That edit was never part of what got pushed (the git
// commit's own content is `prepareCommit`'s OLD render), yet a fully fresh
// snapshot bakes it into what future rebases treat as "the committed
// base" -- so a later rebase touching the same block sees no local change
// (the edit already looks like part of the base) and silently drops it,
// with no review flag (milestone-2 review log's blocker finding).
//
// `transactExtendingSnapshot` fixes this by not taking a fresh whole-doc
// snapshot at all: it runs `fn` (the meta writes) in one transaction, then
// returns `baseSnapshot` (the ACTUAL pre-push content snapshot, taken by
// `prepareCommit` before the async gap) extended by exactly THAT
// transaction's own effect -- the structs it inserted (this transaction's
// own client id's clock range: a local `doc.transact` call only ever
// inserts structs under `doc.clientID`, since every write inside `fn` goes
// through `setMeta`/`deleteMeta`, both plain local writes) and the items it
// deleted (its delete set -- which CAN name another client's item, e.g.
// overwriting a `Y.Map` key a rebase fork wrote under its own peer client
// id; `mergeDeleteSets` handles that generally, not just the local
// client). Anything a DIFFERENT transaction wrote in between (the
// concurrent editor's real edit, applied via its own `Y.applyUpdate` call,
// a separate transaction with its own client id) is simply never added to
// either the state vector or delete set extension, so it stays invisible
// to a fork taken from the returned snapshot -- exactly like `baseSnapshot`
// itself, just now also carrying this transaction's bookkeeping.
import * as Y from 'yjs';

/**
 * Run `fn` inside one Yjs transaction (tagged `origin`) on `doc`, then
 * return `baseSnapshot` extended by exactly that transaction's own inserted
 * structs and deleted items -- nothing else that may have landed on `doc`
 * between when `baseSnapshot` was taken and now. `fn` may freely call
 * `crdt`'s own `setMeta`/`deleteMeta` (their own `doc.transact` calls nest
 * into this same outer transaction, per Yjs's transaction semantics: a
 * nested `transact` call reuses the current transaction and its `origin`
 * argument is ignored) -- this is what lets `engine/commit.ts`'s
 * `recordCommit` do all its meta writes through the ordinary crdt
 * accessors and still get exactly this extension.
 */
export function transactExtendingSnapshot(doc: Y.Doc, baseSnapshot: Uint8Array, fn: () => void, origin?: unknown): Uint8Array {
  const base = Y.decodeSnapshot(baseSnapshot);
  const myClientId = doc.clientID;

  let transaction: Y.Transaction | undefined;
  doc.transact((txn) => {
    fn();
    transaction = txn;
  }, origin);
  if (!transaction) throw new Error('transactExtendingSnapshot: fn did not run in a transaction (unexpected)');

  const sv = new Map(base.sv);
  const afterClock = transaction.afterState.get(myClientId);
  if (afterClock !== undefined && afterClock > (sv.get(myClientId) ?? 0)) {
    sv.set(myClientId, afterClock);
  }

  const ds = Y.mergeDeleteSets([base.ds, transaction.deleteSet]);
  return Y.encodeSnapshot(Y.createSnapshot(ds, sv));
}
