// Brief 05, gate I: "track pending IndexedDB writes; the status shows
// 'Saving on this device' until they finish, then 'Offline, changes kept on
// this device'."
//
// `y-indexeddb`'s `IndexeddbPersistence` already writes every local Y.Doc
// update to IndexedDB itself (`_storeUpdate`, one `idb.addAutoKey` call per
// update -- see its own source), but never exposes whether that write has
// actually completed: there is no "pending count" or "idle" signal on the
// instance itself, only a one-shot `synced` event fired once at startup.
// Rather than reach into its internals, this tracker piggybacks on the SAME
// exported `storeState(persistence, true)` the app already uses for
// `flushIndexeddb()` (a full, forced flush of the current Y.Doc state):
// every local doc update starts one such flush and is "pending" until that
// flush's own promise settles. Calling `storeState` again while a previous
// call is still in flight is safe (each call independently re-encodes the
// CURRENT doc state and is not required to observe the others -- Yjs
// updates are idempotent), so no de-duplication is needed for correctness,
// only for the reported COUNT to mean "at least one write from the current
// content is still in flight."
import type * as Y from 'yjs';

export interface PendingWriteTracker {
  /** Number of flushes started but not yet settled. */
  pendingCount(): number;
  /** True once every flush started so far has settled. */
  isIdle(): boolean;
  /** Starts one more flush right now (in addition to any already in
   * flight) and returns its promise -- used to force a flush attempt from
   * `pagehide`/`visibilitychange` without waiting on the debounce a normal
   * doc-update-triggered flush might otherwise want. */
  flushNow(): Promise<void>;
  /** Stops listening to the doc. Does not cancel in-flight flushes. */
  destroy(): void;
}

/**
 * @param doc The Y.Doc whose local updates should be tracked.
 * @param flush A function that durably persists the doc's CURRENT state
 *   (e.g. `() => storeState(persistence, true).then(() => undefined)`).
 * @param onChange Called synchronously whenever `pendingCount()` changes
 *   (i.e. right after a flush starts, and right after one settles).
 * @param originToIgnore An update `origin` to ignore -- the persistence
 *   layer's own re-application of previously-stored updates during its
 *   initial load fires `doc.on('update', ...)` too, tagged with that
 *   origin; those are not new local writes and must not start a fresh
 *   flush (they were already durable by definition).
 */
export function createPendingWriteTracker(
  doc: Y.Doc,
  flush: () => Promise<void>,
  onChange: () => void,
  originToIgnore: unknown,
): PendingWriteTracker {
  let pending = 0;
  let destroyed = false;

  function startFlush(): Promise<void> {
    pending++;
    onChange();
    return flush()
      .catch(() => undefined) // a failed flush is not this tracker's concern; the next doc update starts another
      .finally(() => {
        pending--;
        if (!destroyed) onChange();
      });
  }

  const onUpdate = (_update: Uint8Array, origin: unknown): void => {
    if (origin === originToIgnore) return;
    void startFlush();
  };
  doc.on('update', onUpdate);

  return {
    pendingCount: () => pending,
    isIdle: () => pending === 0,
    flushNow: () => startFlush(),
    destroy(): void {
      destroyed = true;
      doc.off('update', onUpdate);
    },
  };
}
