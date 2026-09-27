// Brief 03 task 3. Fork-at-base rebase (plan sections 1 and 4). Origin:
// spike 2's `rebase.ts` (collab-stack-yjs13-hocuspocus, branch
// spike/2026-09-27-collab-stack, commit eeb3fe2, src/rebase/rebase.ts --
// itself spike 2's), rebuilt on this spike's crdt interface
// (`forkDiffMerge`'s `onFork` callback + `forceFork`, brief 03 task 1)
// instead of spike 2's own hand-rolled fork/diff/verify/merge (which
// `forkDiffMerge` now owns for every caller, not just rebase).
//
// S2-11 fix (per the brief): the rebase record's id is
// `hash(baseId, targetCommit)` (engine/ids.ts's `rebaseRecordId`), not
// `targetCommit` alone -- spike 2 keyed `rebase:<id>` by the target commit
// hash directly, which collides if a document is ever rebased back onto a
// commit that was already used as some OTHER rebase's target.
import { forkDiffMerge, getMeta, setMeta, snapshot, listMetaEntries, type CrdtDoc } from '../crdt/index.js';
import { parseMarkdown } from '../markdown/index.js';
import { rebasePeerId, rebaseRecordId } from './ids.js';
import { getBase, getSnapshotFor, base64FromSnapshot } from './seed.js';
import type { Author, Base, RebaseRecord, AuthorEntry } from './types.js';

export const ORIGIN_REBASE = 'phraise-rebase';

export interface RebaseOptions {
  docId: string;
  targetMarkdown: string;
  targetCommit: string;
  author: Author;
}

export interface RebaseResult {
  /** False when `base.commit === targetCommit` (already there) or this exact rebase record was already applied (idempotent retry) -- both no-ops. */
  applied: boolean;
  rebaseId: string;
}

/**
 * Fork `doc` at its current base snapshot, diff the fork's content onto
 * `opts.targetMarkdown`, write the rebase record + advanced base pointer +
 * new snapshot on the fork (all via `onFork`, so they ride along in the
 * same merge back into `doc`), and merge. No-op if `base.commit` already
 * equals `targetCommit`, or if this rebase's record already exists in `doc`
 * (a retry from anywhere is idempotent). Always forces a fork
 * (`forceFork: true`) so the diff's ops are attributed to the deterministic
 * rebase peer `hash32(docId, baseId, targetCommit)` on every replica,
 * regardless of whether a given replica happens to have made no local
 * edits since `base` (see forkDiffMerge.ts's own doc comment on why the
 * fast path is unsafe for this specifically).
 */
export function rebase(doc: CrdtDoc, opts: RebaseOptions): RebaseResult {
  const base = getBase(doc);
  if (!base) throw new Error('rebase: doc has no base pointer; was it seeded?');
  if (base.commit === opts.targetCommit) {
    // Already there. `base.id` is always either the original seed commit
    // (never rebased) or exactly the rebaseId of whichever rebase last
    // produced this base (onFork always sets `base = {id: rebaseId, commit:
    // targetCommit}`), so it IS the right id to report here -- recomputing
    // via rebaseRecordId(base.id, targetCommit) would be wrong (that
    // formula names a *hypothetical future* rebase from the CURRENT base to
    // this same target, not the rebase that already got us here).
    return { applied: false, rebaseId: base.id };
  }

  const rebaseId = rebaseRecordId(base.id, opts.targetCommit);
  if (getMeta(doc, 'phraise', `rebase:${rebaseId}`) !== undefined) {
    return { applied: false, rebaseId };
  }

  const baseSnapshot = getSnapshotFor(doc, base.id);
  if (!baseSnapshot) throw new Error(`rebase: missing snapshot:${base.id}`);
  const targetDoc = parseMarkdown(opts.targetMarkdown).doc;
  const peer = rebasePeerId(opts.docId, base.id, opts.targetCommit);

  forkDiffMerge(doc, baseSnapshot, targetDoc, {
    clientId: peer,
    forceFork: true,
    origin: ORIGIN_REBASE,
    onFork: (fork) => {
      const newBase: Base = { id: rebaseId, commit: opts.targetCommit };
      setMeta(fork, 'phraise', 'base', newBase, ORIGIN_REBASE);
      const record: RebaseRecord = {
        id: rebaseId,
        baseId: base.id,
        baseCommit: base.commit,
        targetCommit: opts.targetCommit,
        author: opts.author,
        peer,
      };
      setMeta(fork, 'phraise', `rebase:${rebaseId}`, record, ORIGIN_REBASE);
      const authorEntry: AuthorEntry = { kind: 'git', name: opts.author.name, email: opts.author.email, commit: opts.targetCommit };
      setMeta(fork, 'phraise-authors', String(peer), authorEntry, ORIGIN_REBASE);

      // Snapshot the fork's now-verified, target-equal content and store it
      // under the NEW base id, so the next rebase can fork from it exactly
      // as this one forked from the previous base (plan section 4, mirroring
      // seed.ts's own snapshot step).
      const snap = snapshot(fork);
      setMeta(fork, 'phraise', `snapshot:${rebaseId}`, base64FromSnapshot(snap), ORIGIN_REBASE);
    },
  });

  return { applied: true, rebaseId };
}

/**
 * Rebases that forked from the same base to different targets (must not
 * run concurrently; recovery is a re-seed from the real branch head per D1
 * as amended). Detects the violation so any replica can notice and recover.
 */
export function baseConflicts(doc: CrdtDoc): RebaseRecord[][] {
  const byBase = new Map<string, RebaseRecord[]>();
  for (const [, v] of listRebaseRecords(doc)) {
    const list = byBase.get(v.baseId) ?? [];
    list.push(v);
    byBase.set(v.baseId, list);
  }
  return [...byBase.values()].filter((l) => new Set(l.map((r) => r.id)).size > 1);
}

export function listRebaseRecords(doc: CrdtDoc): Array<[string, RebaseRecord]> {
  return listMetaEntries<RebaseRecord>(doc, 'phraise', 'rebase:');
}
