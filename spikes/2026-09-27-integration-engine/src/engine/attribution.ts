// Brief 03 task 6. `listAttribution(doc)`: combines crdt's per-range
// attribution (`listAttributedRanges`, keyed by the connection's user name)
// with `phraise-authors`' per-clientId kind (human/git/import/seed/
// generation). The two maps are keyed differently -- ranges by user name
// (whatever the relay's auth stub recorded at `recordAttribution` time),
// authors by clientId -- so combining them means matching a range's `user`
// against an author entry's `name`. Logged interpretation (brief 03's
// wording, "combining attributed ranges with author kinds", does not spell
// out the join key): a range whose user does not match any known author's
// name (e.g. "unknown", crdt's placeholder for an unattributed clock range)
// reports kind `'unknown'` rather than throwing.
import { listAttributedRanges, listMetaEntries, type CrdtDoc } from '../crdt/index.js';
import type { AuthorEntry, AuthorKind } from './types.js';

export interface AttributionListItem {
  user: string;
  at: number;
  text: string;
  kind: AuthorKind | 'unknown';
}

export function listAttribution(doc: CrdtDoc): AttributionListItem[] {
  const ranges = listAttributedRanges(doc);
  const kindByName = new Map<string, AuthorKind>();
  for (const [, entry] of listMetaEntries<AuthorEntry>(doc, 'phraise-authors')) {
    if (!kindByName.has(entry.name)) kindByName.set(entry.name, entry.kind);
  }
  return ranges.map((r) => ({ user: r.user, at: r.at, text: r.text, kind: kindByName.get(r.user) ?? 'unknown' }));
}
