// Brief 04, task 5: renders the top bar's status indicator from the pure
// state machine in `src/offline/status.ts`.
import { deriveSyncStatus, STATUS_LABEL, type ProviderConnectionStatus } from '../../src/offline/status.js';

export function renderStatus(el: HTMLElement, browserOnline: boolean, providerStatus: ProviderConnectionStatus): void {
  const status = deriveSyncStatus(browserOnline, providerStatus);
  el.textContent = STATUS_LABEL[status];
  el.dataset.status = status;
}
