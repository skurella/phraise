// Brief 04, task 5: "build the editor after whichever comes first: IndexedDB
// loaded with content, or the provider's first sync." This is the pure
// event-driven state machine behind that rule, with no DOM/IndexedDB/
// WebSocket of its own -- `web/src/main.ts` calls `onIndexedDBSynced()` from
// `y-indexeddb`'s `IndexeddbPersistence` `'synced'` event and
// `onProviderSynced()` from the same `waitForProviderSynced` helper brief 01
// already wrote, and awaits `ready`.
//
// Whichever fires first settles `ready`; the second call (whichever source
// it is) is a no-op -- the editor is built exactly once, and spike 5's
// constraint ("the workaround plugins see the document's content when the
// editor is built") holds either way, since both sources only ever fire
// once their own content has actually loaded.

export type GateSource = 'indexeddb' | 'provider';

export interface BuildGate {
  onIndexedDBSynced(): void;
  onProviderSynced(): void;
  /** Resolves with whichever source settled the gate first. */
  readonly ready: Promise<GateSource>;
  /** True once `ready` has settled (for tests/inspection; not needed to await `ready` itself). */
  readonly settled: boolean;
}

export function createBuildGate(): BuildGate {
  let settled = false;
  let resolveReady!: (source: GateSource) => void;
  const ready = new Promise<GateSource>((resolve) => {
    resolveReady = resolve;
  });

  function settle(source: GateSource): void {
    if (settled) return;
    settled = true;
    resolveReady(source);
  }

  return {
    onIndexedDBSynced: () => settle('indexeddb'),
    onProviderSynced: () => settle('provider'),
    ready,
    get settled() {
      return settled;
    },
  };
}
