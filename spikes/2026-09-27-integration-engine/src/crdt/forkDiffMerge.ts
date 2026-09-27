// Origin: adapted from spike 3 (daemon-file-sync-fork-import), branch
// spike/2026-09-27-daemon-file-sync, commit 9343b62, src/core/docsync.ts
// (DocSync.importText). Kept: the fork-at-base, diff, verify, repair and
// merge steps. Dropped (per brief 01 task 4 -- these belong to the daemon,
// added later): the version ring, `chooseBase`, and the `phraise-authors`
// bookkeeping docsync.ts's importText also did inline.
//
// Plan section 3 point 4: forkDiffMerge(doc, base, target, {clientId, origin})
// -- fork `doc` at `base` (or diff directly onto `doc` when `base` equals the
// live state, the fast path), diff-apply `target` onto the fork's content,
// verify the fork now equals `target` exactly (repair with `updateYFragment`
// on mismatch, counted as `repaired`), and merge the fork's update back into
// `doc`. Never reverts a concurrent remote edit made after `base`: the diff
// walks from the FORK's content (== `base`) to `target`, so anything the live
// doc gained since `base` survives untouched in `doc` and is merged with the
// fork's own new ops on top.
import * as Y from 'yjs';
import { updateYFragment } from '@tiptap/y-tiptap';
import type { Node as PMNode } from 'prosemirror-model';
import { FRAGMENT_NAME, META_MAP_NAME, encodeLeafMarks, read, readEncoded } from './codec.js';
import { applyDiff, type DiffCounters } from './diff.js';

/** Default Yjs transaction origin for forkDiffMerge's own mutations. */
export const ORIGIN_FORK_DIFF_MERGE = 'phraise-fork-diff-merge';

export interface ForkDiffMergeOpts {
  /**
   * Client id for the synthetic fork peer (only meaningful when the fork
   * path is taken -- see `forked` below). A random 32-bit id is used if
   * omitted. Ignored on the fast (non-forked) path, where ops are applied
   * directly under the live doc's own client id.
   */
  clientId?: number;
  /** Yjs transaction origin tag for every mutation this call makes. */
  origin?: unknown;
  /**
   * Brief 03 addition. Always fork (create an isolated `Y.createDocFromSnapshot`
   * copy and merge its update back), even when `base` already equals `doc`'s
   * live snapshot. Without this, the fast path applies the diff directly
   * under `doc`'s OWN current `clientID` -- fine for an ordinary local save,
   * but wrong for a caller (engine's rebase) that needs the SAME `clientId`
   * attributed to this operation on every replica regardless of whether
   * that replica happens to have made no edits since `base` (in which case
   * its live snapshot coincidentally equals `base` and the fast path would
   * otherwise silently take over).
   */
  forceFork?: boolean;
  /**
   * Brief 03 addition (plan section 3 point 4: "forkDiffMerge gains an
   * optional onFork(fork) callback run inside the fork's transaction after
   * the diff"). Called with the fork (an opaque `CrdtDoc`, i.e. plain
   * `Y.Doc` from this module's own point of view) after the diff has been
   * applied AND verified/repaired to equal `target` exactly -- so any
   * `snapshot(fork)` the callback takes is guaranteed to reflect
   * target-equal content, even on the rare repair path. Runs before the
   * fork's update is computed and merged into `doc`, so anything the
   * callback writes (e.g. via `setMeta`) is included in that merge. On the
   * fast (non-forked) path, `fork` is `doc` itself.
   */
  onFork?: (fork: Y.Doc) => void;
}

export interface ForkDiffMergeResult {
  /** The Yjs update this call produced (diff ops plus any repair), already applied to `doc`. */
  update: Uint8Array;
  counters: DiffCounters;
  /** False when `base` already equals `doc`'s live state (fast path: diff applied directly, no fork). */
  forked: boolean;
  /** True when the diff's result did not verify byte-for-byte against `target` and a whole-fragment repair ran. */
  repaired: boolean;
}

function nodeChildren(node: PMNode): PMNode[] {
  const out: PMNode[] = [];
  node.forEach((c) => out.push(c));
  return out;
}

/**
 * Fork `doc` at `base` (a snapshot from `snapshot(doc)`, encoded bytes),
 * diff from the fork's content to `target`, verify, repair if needed, and
 * merge the result back into `doc`. When `base` already equals `doc`'s live
 * snapshot (no concurrent change happened since `base` was taken), the diff
 * is applied directly to `doc` -- no fork, no merge.
 */
export function forkDiffMerge(doc: Y.Doc, base: Uint8Array, target: PMNode, opts: ForkDiffMergeOpts = {}): ForkDiffMergeResult {
  const origin = opts.origin ?? ORIGIN_FORK_DIFF_MERGE;
  const baseSnapshot = Y.decodeSnapshot(base);
  const targetEncoded = encodeLeafMarks(target);

  const liveSnapshot = Y.snapshot(doc);
  const forked = opts.forceFork === true || !Y.equalSnapshots(liveSnapshot, baseSnapshot);

  let work: Y.Doc;
  let svBefore: Uint8Array;
  if (forked) {
    work = Y.createDocFromSnapshot(doc, baseSnapshot, new Y.Doc({ gc: false }));
    work.clientID = opts.clientId ?? Math.floor(Math.random() * 0xffffffff);
    svBefore = Y.encodeStateVector(work);
  } else {
    work = doc;
    svBefore = Y.encodeStateVector(doc);
  }

  let counters!: DiffCounters;
  work.transact(() => {
    const meta = work.getMap(META_MAP_NAME);
    const lead = (targetEncoded.attrs.lead as string) ?? '';
    const eol = (targetEncoded.attrs.eol as string) ?? '\n';
    if (meta.get('lead') !== lead) meta.set('lead', lead);
    if (meta.get('eol') !== eol) meta.set('eol', eol);

    const fragment = work.getXmlFragment(FRAGMENT_NAME);
    const aChildren = nodeChildren(readEncoded(work));
    const bChildren = nodeChildren(targetEncoded);
    counters = applyDiff(fragment, aChildren, bChildren);
  }, origin);

  // Verify: the fork's decoded content must equal `target` exactly (JSON
  // comparison, stricter than semanticEq -- this is specifically meant to
  // catch attr-sync bugs the diff might have introduced, not just semantic
  // drift). On mismatch, repair with a whole-fragment `updateYFragment`.
  const resultDoc = read(work);
  let repaired = false;
  if (JSON.stringify(resultDoc.toJSON()) !== JSON.stringify(target.toJSON())) {
    repaired = true;
    work.transact(() => {
      const fragment = work.getXmlFragment(FRAGMENT_NAME);
      updateYFragment(work, fragment, targetEncoded, { mapping: new Map(), isOMark: new Map() } as any);
    }, origin);
  }

  // onFork runs after verify/repair (see the option's own doc comment for
  // why): the fork's content is now guaranteed to equal `target` exactly.
  if (opts.onFork) {
    work.transact(() => opts.onFork!(work), origin);
  }

  const update = Y.encodeStateAsUpdate(work, svBefore);
  if (forked) {
    Y.applyUpdate(doc, update, origin);
  }

  return { update, counters, forked, repaired };
}
