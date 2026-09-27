// The five-point CRDT interface (plan section 3; D5). THIS MODULE, its
// submodules under src/crdt/, is the ONLY code in this spike that imports
// `yjs`, `y-protocols`, `lib0` or `@tiptap/y-tiptap` (enforced by
// test/import-boundary.test.ts). Every other module receives a `CrdtDoc`
// (opaque alias for `Y.Doc`), `CrdtSnapshot` and `CrdtUpdate` (opaque
// `Uint8Array` aliases) and never calls a Yjs API directly.
//
// Brief 01 scope: points 1-4 of plan section 3, EXCEPT `blockStatesAt` and
// `resurrectBlock` (review-flag support, brief 03) and point 5, anchors
// (also brief 03). `recordAttribution`/`authorOf` (part of point 3 in the
// plan) are likewise left to a later brief: see inspectUpdate.ts's comment.
import * as Y from 'yjs';

export type CrdtDoc = Y.Doc;
export type CrdtSnapshot = Uint8Array;
export type CrdtUpdate = Uint8Array;

// --- 1. Seed and read -------------------------------------------------------
export { createDoc, seed, read } from './codec.js';

export function encodeState(doc: CrdtDoc): CrdtUpdate {
  return Y.encodeStateAsUpdate(doc);
}

export function applyUpdate(doc: CrdtDoc, update: CrdtUpdate, origin?: unknown): void {
  Y.applyUpdate(doc, update, origin);
}

export function stateVector(doc: CrdtDoc): Uint8Array {
  return Y.encodeStateVector(doc);
}

export function onUpdate(doc: CrdtDoc, fn: (update: CrdtUpdate, origin: unknown) => void): () => void {
  const handler = (update: Uint8Array, origin: unknown) => fn(update, origin);
  doc.on('update', handler);
  return () => doc.off('update', handler);
}

export function clientId(doc: CrdtDoc): number {
  return doc.clientID;
}

export function setClientId(doc: CrdtDoc, id: number): void {
  doc.clientID = id;
}

// --- 2. Editor plugins -------------------------------------------------------
export { editorPlugins, initEditorDoc, type EditorPluginsOpts, type ProsemirrorMapping } from './editorPlugins.js';
export { FRAGMENT_NAME } from './codec.js';

// --- 3. Relay per-update hook (inspectUpdate only; see inspectUpdate.ts) -----
export { inspectUpdate, type UpdateClientRange } from './inspectUpdate.js';

// --- 4. Fork, diff, apply ----------------------------------------------------

/** A snapshot of `doc`'s current state, as opaque bytes (`Y.encodeSnapshot(Y.snapshot(doc))`). */
export function snapshot(doc: CrdtDoc): CrdtSnapshot {
  return Y.encodeSnapshot(Y.snapshot(doc));
}

/** Alias of `snapshot`, named to match `encodeState`/`applyUpdate`'s encode/apply naming. */
export const encodeSnapshot = snapshot;

export { forkDiffMerge, ORIGIN_FORK_DIFF_MERGE, type ForkDiffMergeOpts, type ForkDiffMergeResult } from './forkDiffMerge.js';
export { render, type RenderResult } from './render.js';
export type { DiffCounters } from './diff.js';

// Brief 03: review-flag support (blockStatesAt/resurrectBlock, plan section
// 3 point 4) and the block-authorship primitive engine/integrate.ts's
// resurrection rule needs (see blocks.ts's own header comment).
export {
  isTextblockName,
  collectBlocks,
  currentBlockText,
  blockStatesAt,
  blockSignatureAt,
  blockPlainTextAt,
  resurrectBlock,
  blockHasOwnEditsSince,
  idKey,
  isVisibleAt,
  type BlockRef,
  type BlockState,
  type ReviewReason,
} from './blocks.js';

// --- 5. Anchors --------------------------------------------------------------
export { textProjection, anchorAt, resolveAnchor, ATOM_PLACEHOLDER } from './anchors.js';

// --- 3 (continued). Attribution -----------------------------------------------
export {
  recordAttribution,
  listAttributedRanges,
  authorOf,
  ATTRIBUTION_ORIGIN,
  ATTRIBUTION_MAP_NAME,
  ATTRIBUTION_CONFLICTS_MAP_NAME,
  type AttributionEntry,
  type AttributedRange,
  type ConflictEntry,
} from './attribution.js';

// Brief 03: the generic remote-batch hook (spike 5's attachIntegrationHook
// mechanics, minus the integration logic itself -- see integrate.ts's own
// header comment for why that split).
export { onRemoteBatch, wouldPend, INTEGRATION_ORIGIN_MARKER, type OnRemoteBatchHandle } from './integrationHook.js';

// --- meta accessors -----------------------------------------------------------
export { getMeta, setMeta, transact, listMetaEntries, deleteMeta } from './meta.js';
