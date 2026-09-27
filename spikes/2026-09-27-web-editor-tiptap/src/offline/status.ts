// Brief 04, task 5: the status indicator's state machine. Pure function of
// two observable facts (is the browser itself online, and what is the
// relay WebSocket's own status) -- no DOM, no provider, no timers, so it is
// fully unit-testable. `web/src/main.ts` recomputes and renders the label on
// `window`'s `online`/`offline` events and the Hocuspocus provider's own
// `status` event (`connecting` | `connected` | `disconnected`, confirmed
// from `@hocuspocus/provider`'s `WebSocketStatus` enum and its `.d.ts`
// before relying on the exact strings).
//
// Three states, matching the brief's exact wording:
//  - `saved`: browser online AND the relay connection is `connected`.
//  - `offline`: the browser itself is offline (`navigator.onLine === false`,
//    or a test's `context.setOffline(true)`) -- changes are only local
//    (`y-indexeddb`), never lost, but not yet reaching the relay.
//  - `reconnecting`: the browser is online but the relay connection is not
//    (yet) `connected` -- a transient blip, not a deliberate offline choice.
export type SyncStatus = 'saved' | 'offline' | 'reconnecting';

export type ProviderConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export const STATUS_LABEL: Record<SyncStatus, string> = {
  saved: 'Saved',
  offline: 'Offline, changes kept on this device',
  reconnecting: 'Reconnecting',
};

export function deriveSyncStatus(browserOnline: boolean, providerStatus: ProviderConnectionStatus): SyncStatus {
  if (!browserOnline) return 'offline';
  return providerStatus === 'connected' ? 'saved' : 'reconnecting';
}
