// Brief 04, task 5: renders the top bar's status indicator from the pure
// state machine in `src/offline/status.ts`. Brief 05, task 4: takes whether
// any local edit's IndexedDB write is still in flight, so the indicator can
// show "Saving on this device" while offline until it settles.
import { deriveSyncStatus, STATUS_LABEL, type ProviderConnectionStatus } from '../../src/offline/status.js';

export function renderStatus(el: HTMLElement, browserOnline: boolean, providerStatus: ProviderConnectionStatus, hasPendingWrites: boolean): void {
  const status = deriveSyncStatus(browserOnline, providerStatus, hasPendingWrites);
  el.textContent = STATUS_LABEL[status];
  el.dataset.status = status;
}
