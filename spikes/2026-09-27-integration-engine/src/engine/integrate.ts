// Brief 03 task 4. Integration on every replica: needs-review and
// resurrection (plan section 5). Origin: spike 2's `integrate.ts`
// (collab-stack-yjs13-hocuspocus, branch spike/2026-09-27-collab-stack,
// commit eeb3fe2, src/rebase/integrate.ts -- itself spike 2's), rebuilt on
// this spike's generalized primitives (`blockStatesAt`/`resurrectBlock`/
// `blockHasOwnEditsSince`, brief 03 task 1) and the generic
// `onRemoteBatch` hook (crdt/integrationHook.ts) instead of spike 2's own
// `attachIntegrationHook`, which called `integrate()` directly.
//
// S5-5 (spike 5's own decision, carried over): the replica that computes a
// rebase acks its own record immediately (`ackOwnRebase`), rather than
// waiting to discover it through this module's normal per-remote-batch
// scan -- which may never even run for that replica's own local rebase()
// call in the first place (`isRemoteOrigin` typically returns false for a
// replica's own local transactions), and which would in any case use a
// meaningless "before" snapshot for a rebase this replica computed itself
// (see the spike 5 relay route this ports: "acking immediately, atomically
// with applying the rebase, is simply correct, not a workaround").
import {
  onRemoteBatch,
  blockStatesAt,
  blockHasOwnEditsSince,
  resurrectBlock,
  currentBlockText,
  clientId,
  getMeta,
  setMeta,
  listMetaEntries,
  INTEGRATION_ORIGIN_MARKER,
  type CrdtDoc,
  type CrdtSnapshot,
  type OnRemoteBatchHandle,
} from '../crdt/index.js';
import { getSnapshotFor } from './seed.js';
import type { RebaseRecord, ReviewEntry } from './types.js';

export interface AttachIntegrationOptions {
  isRemoteOrigin: (origin: unknown) => boolean;
  /**
   * Optional: true for a rebase id this replica computed itself (via
   * `rebase()`) in a batch that DOES flow through this hook for some reason
   * (e.g. an echoed update in a hub/relay topology). Such a record is acked
   * immediately without the review/resurrection scan, exactly like
   * `ackOwnRebase` -- this is defense-in-depth, not the primary mechanism:
   * a caller that runs `rebase()` locally should still call `ackOwnRebase`
   * right after, since a purely local transaction will typically never
   * even reach `isRemoteOrigin` in the first place.
   */
  selfIsRebaser?: (rebaseId: string) => boolean;
}

function ackRecord(doc: CrdtDoc, rebaseId: string, myClientId: number): void {
  setMeta(doc, 'phraise', `ack:${rebaseId}:${myClientId}`, true, INTEGRATION_ORIGIN_MARKER);
}

/** For the replica that ran `rebase()` itself: ack its own record at once (S5-5), instead of going through the review/resurrection scan. */
export function ackOwnRebase(doc: CrdtDoc, rebaseId: string): void {
  ackRecord(doc, rebaseId, clientId(doc));
}

/** Order pending rebase records oldest-base-first, following the baseId chain. Deterministic regardless of Y.Map iteration order (port of spike 2's `orderRecords`). */
function orderRecords(records: RebaseRecord[]): RebaseRecord[] {
  const byId = new Map(records.map((r) => [r.id, r] as const));
  const result: RebaseRecord[] = [];
  const visited = new Set<string>();
  function visit(r: RebaseRecord): void {
    if (visited.has(r.id)) return;
    visited.add(r.id);
    const parent = byId.get(r.baseId);
    if (parent) visit(parent);
    result.push(r);
  }
  for (const r of records) visit(r);
  return result;
}

function processRecord(doc: CrdtDoc, record: RebaseRecord, P: CrdtSnapshot, myClientId: number): void {
  const snapA = getSnapshotFor(doc, record.baseId);
  const snapB = getSnapshotFor(doc, record.id);
  if (!snapA || !snapB) return; // snapshot not delivered yet; retry on a later batch (no ack written)

  const statesA = blockStatesAt(doc, snapA);
  const statesB = blockStatesAt(doc, snapB);
  const statesP = blockStatesAt(doc, P);

  for (const blockId of statesA.keys()) {
    const a = statesA.get(blockId)?.signature ?? null;
    const b = statesB.get(blockId)?.signature ?? null;
    const p = statesP.get(blockId)?.signature ?? null;
    const upstreamChanged = a !== b;
    const localChanged = a !== p;

    if (upstreamChanged && localChanged) {
      const entry: ReviewEntry = { rebaseId: record.id, reason: 'concurrent-edit' };
      setMeta(doc, 'review', blockId, entry, INTEGRATION_ORIGIN_MARKER);
    }

    if (a !== null && b === null) {
      // Deleted upstream. Resurrect if this replica's OWN edits since the
      // base are still visible at P (only the author resurrects).
      if (blockHasOwnEditsSince(doc, blockId, myClientId, snapA, P)) {
        const result = resurrectBlock(doc, blockId, P, INTEGRATION_ORIGIN_MARKER);
        if (result) {
          const entry: ReviewEntry = { rebaseId: record.id, reason: 'deleted-upstream-edited-locally' };
          setMeta(doc, 'review', result.newBlockId, entry, INTEGRATION_ORIGIN_MARKER);
        }
      }
    }
  }

  ackRecord(doc, record.id, myClientId);
}

function runPending(doc: CrdtDoc, P: CrdtSnapshot, selfIsRebaser?: (rebaseId: string) => boolean): void {
  const myClientId = clientId(doc);
  const all = listMetaEntries<RebaseRecord>(doc, 'phraise', 'rebase:').map(([, v]) => v);
  const pending = all.filter((r) => getMeta(doc, 'phraise', `ack:${r.id}:${myClientId}`) === undefined);
  if (pending.length === 0) return;
  for (const record of orderRecords(pending)) {
    if (selfIsRebaser?.(record.id)) {
      ackRecord(doc, record.id, myClientId);
      continue;
    }
    processRecord(doc, record, P, myClientId);
  }
}

/**
 * Run integration for every rebase record this replica has not yet
 * acked, on each remote batch (plan section 5). Attaches
 * `crdt.onRemoteBatch`; detach the returned handle to stop.
 */
export function attachIntegration(doc: CrdtDoc, opts: AttachIntegrationOptions): OnRemoteBatchHandle {
  return onRemoteBatch(doc, opts.isRemoteOrigin, (beforeSnapshot) => {
    runPending(doc, beforeSnapshot, opts.selfIsRebaser);
  });
}

export interface ReviewListEntry {
  blockId: string;
  rebaseId: string;
  reason: ReviewEntry['reason'];
  text: string;
  cleared: boolean;
}

/** Currently-visible flagged blocks, with their current text and whether a user has cleared the flag. */
export function listReview(doc: CrdtDoc): ReviewListEntry[] {
  const out: ReviewListEntry[] = [];
  for (const [blockId, entry] of listMetaEntries<ReviewEntry>(doc, 'review')) {
    if (blockId.startsWith('cleared:')) continue;
    const text = currentBlockText(doc, blockId);
    if (text === null) continue; // block no longer visible (deleted since being flagged)
    const cleared = getMeta(doc, 'review', `cleared:${blockId}`) !== undefined;
    out.push({ blockId, rebaseId: entry.rebaseId, reason: entry.reason, text, cleared });
  }
  return out;
}

/** Records that `user` has reviewed (cleared) `blockId`'s flag. Clearing is itself a CRDT write (a shared `cleared:<blockId>` key), so it converges like anything else. */
export function clearReview(doc: CrdtDoc, blockId: string, user: string): void {
  setMeta(doc, 'review', `cleared:${blockId}`, { user, at: Date.now() });
}
