// Plan section 3 point 3 (relay per-update hook), brief 01 scope: only
// `inspectUpdate` is implemented here. `recordAttribution`/`authorOf` are
// left to a later brief (they belong with engine's attribution listing, not
// the CRDT primitive): the relay needs to know which client ids an update
// touches (to reject a forged identity) before it can decide anything about
// attribution.
import * as Y from 'yjs';

export interface UpdateClientRange {
  clientId: number;
  /** Clock range this update advances that client to, inclusive start. */
  from: number;
  to: number;
}

/** Per-client clock ranges an encoded update touches, via `Y.parseUpdateMeta`. */
export function inspectUpdate(update: Uint8Array): UpdateClientRange[] {
  const meta = Y.parseUpdateMeta(update);
  const out: UpdateClientRange[] = [];
  for (const [clientId, from] of meta.from) {
    const to = meta.to.get(clientId) ?? from;
    out.push({ clientId, from, to });
  }
  return out;
}
