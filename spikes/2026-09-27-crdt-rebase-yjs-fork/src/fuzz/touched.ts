// "touched by a human" bookkeeping (brief 03 checks: F-violation needs the
// set of textblocks *not* touched by any human). Snapshot each block's
// current plain text right after seeding (before any local edit) and again
// after a human's edits; blocks whose content differs (including deleted
// blocks, whose id drops out of the "after" map since `blockContentAt`
// returns null once invisible) are "touched". Uses the codebase's own
// stable item-id-as-identity scheme (see integrate.ts), so this needs no
// separate identity mapping and works unchanged across replicas (seeding is
// deterministic, so the same block has the same id everywhere).
import type * as Y from "yjs";
import { collectBlocks, blockSignatureAt } from "../integrate.js";
import { PM_FRAGMENT } from "../seed.js";

export function snapshotBlockTexts(doc: Y.Doc): Map<string, string> {
  const root = doc.getXmlFragment(PM_FRAGMENT);
  const blocks = collectBlocks(root);
  const out = new Map<string, string>();
  for (const b of blocks) {
    // Attrs and marks count (orchestrator revision after review).
    const content = blockSignatureAt(b, undefined);
    if (content !== null) out.set(b.id, content);
  }
  return out;
}

export function diffTouched(before: Map<string, string>, after: Map<string, string>): Set<string> {
  const out = new Set<string>();
  const ids = new Set([...before.keys(), ...after.keys()]);
  for (const id of ids) {
    if (before.get(id) !== after.get(id)) out.add(id);
  }
  return out;
}
