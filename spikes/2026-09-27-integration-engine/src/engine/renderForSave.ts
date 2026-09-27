// Brief 07 task 4. `crdt.render` already returns the best-effort text plus
// the top-level block indices whose serialization did not verify
// (`degraded`; markdown/render.ts's own header comment explains why that
// is not a refusal -- D9, "best effort plus a flag on the block"). This
// module is the piece that turns a degraded INDEX into an actual review
// flag on the block(s) it corresponds to, so the relay's draft flush and
// commit paths (and anything else that calls `renderForSave` instead of
// `crdt.render` directly) get the flag written as a side effect of
// rendering, with no separate step to forget.
import {
  render,
  textblockIdsAtTopLevel,
  getMeta,
  setMeta,
  deleteMeta,
  listMetaEntries,
  type CrdtDoc,
} from '../crdt/index.js';
import type { ReviewEntry } from './types.js';

export interface RenderForSaveResult {
  text: string;
  /** Top-level block indices whose serialization was best effort (same as `crdt.render`'s own `degraded`). */
  degraded: number[];
}

const REASON = 'serialization-best-effort' as const;

/**
 * Render `doc` to Markdown (best effort plus degraded-block report, via
 * `crdt.render`) and reconcile the `review` map against the current
 * degraded set:
 *
 * - every currently-degraded block that has NO existing review entry gets
 *   one with `reason: 'serialization-best-effort'` (never clobbers an
 *   existing entry from the integration scan -- 'concurrent-edit' or
 *   'deleted-upstream-edited-locally' -- since that is a DIFFERENT reason
 *   for review and losing it would be a regression, not an improvement);
 * - every block that WAS flagged `serialization-best-effort` by an earlier
 *   call but serializes cleanly now has that entry removed (D9's "clears
 *   it when the block serializes cleanly again" -- a block's own edit
 *   history is not required to already have run through the ladder again;
 *   simply not being in this call's `degraded` set is enough).
 *
 * A degraded top-level index that names a CONTAINER (blockquote, list,
 * table -- `crdt.render`/`serializeDoc` only ever report top-level block
 * indices, and `review` flags are always keyed by a textblock) flags every
 * textblock nested inside it, since the serializer does not narrow the
 * failure down further than "this top-level block's own serialization did
 * not verify".
 */
export function renderForSave(doc: CrdtDoc): RenderForSaveResult {
  const rendered = render(doc);

  const degradedBlockIds = new Set<string>();
  for (const index of rendered.degraded) {
    for (const id of textblockIdsAtTopLevel(doc, index)) degradedBlockIds.add(id);
  }

  for (const blockId of degradedBlockIds) {
    if (getMeta(doc, 'review', blockId) === undefined) {
      const entry: ReviewEntry = { reason: REASON };
      setMeta(doc, 'review', blockId, entry);
    }
  }

  for (const [blockId, entry] of listMetaEntries<ReviewEntry>(doc, 'review')) {
    if (blockId.startsWith('cleared:')) continue;
    if (entry?.reason === REASON && !degradedBlockIds.has(blockId)) {
      deleteMeta(doc, 'review', blockId);
    }
  }

  return { text: rendered.text, degraded: rendered.degraded };
}
