// Brief 03 task 6. Commit preparation (serialize + trailers' data) and
// recording, plus the `editorsSinceCommit` bookkeeping (plan section 4,
// section 5's commit mechanics -- the git write itself is git/relay's job,
// not engine's; this module only prepares what a commit needs and records
// what one did). D1 as amended: "a commit records a new base and does not
// re-seed" -- `recordCommit` sets `base` directly to the new commit with
// the snapshot `prepareCommit` already took, no re-parse/re-seed.
import { render, snapshot, getMeta, setMeta, deleteMeta, listMetaEntries, type CrdtDoc, type CrdtSnapshot } from '../crdt/index.js';
import { base64FromSnapshot } from './seed.js';
import type { Base } from './types.js';

const EDITORS_PREFIX = 'editorsSinceCommit:';

/** Marks `user` as having edited since the last commit (plan section 4's `editorsSinceCommit:<user>` = true -- one key per user, so concurrent editors never clobber each other's Y.Map LWW register the way a single shared array-valued key would). */
export function markEditor(doc: CrdtDoc, user: string): void {
  setMeta(doc, 'phraise', `${EDITORS_PREFIX}${user}`, true);
}

/** Every user marked as having edited since the last commit. */
export function editorsSinceCommit(doc: CrdtDoc): string[] {
  return listMetaEntries<boolean>(doc, 'phraise', EDITORS_PREFIX).map(([k]) => k.slice(EDITORS_PREFIX.length));
}

export interface PrepareCommitResult {
  text: string;
  degraded: number[];
  snapshot: CrdtSnapshot;
  coAuthors: string[];
}

/**
 * Render `doc` to Markdown (best effort plus degraded-block report, via
 * crdt's `render`) and take its snapshot, in the same synchronous step (no
 * `await` between them, so nothing else can mutate `doc` in between --
 * JS's single-threaded execution is the whole mechanism here, matching the
 * brief's "snapshot taken in the same synchronous step"). `coAuthors` lists
 * everyone `markEditor` has recorded since the last commit; the caller
 * (git/relay) turns that into `Co-authored-by:` trailers.
 */
export function prepareCommit(doc: CrdtDoc): PrepareCommitResult {
  const rendered = render(doc);
  const snap = snapshot(doc);
  return { text: rendered.text, degraded: rendered.degraded, snapshot: snap, coAuthors: editorsSinceCommit(doc) };
}

export interface RecordCommitOptions {
  commit: string;
  /**
   * Kept for the caller's convenience and for `engine.commit.test.ts`'s
   * existing "prepareCommit returns a Uint8Array" assertion -- NOT what
   * gets stored under `snapshot:<commit>` any more (see the brief 06 fix
   * note on `recordCommit` below for why).
   */
  snapshot: CrdtSnapshot;
}

/**
 * After a commit succeeds: set `base` to the new commit, record
 * `lastCommit`, clear `editorsSinceCommit`, THEN take and store
 * `snapshot:<commit>` (D1 as amended: "a commit records a new base and
 * does not re-seed").
 *
 * Brief 06 task 3 fix: this used to store `opts.snapshot` (the snapshot
 * `prepareCommit` took, necessarily BEFORE any of these meta writes ran,
 * since a commit might still fail after prepareCommit and before this
 * function is ever called). That snapshot's copy of the `phraise` map
 * still had the PRE-commit `base` entry (e.g. the previous commit, or the
 * original seed) -- not this function's own `base` write. A later rebase
 * forks from `getSnapshotFor(doc, base.id)` via `Y.createDocFromSnapshot`,
 * and its `onFork` callback overwrites `base` on the fork, marking (from
 * the fork's point of view) THAT STALE entry as superseded. But `doc`
 * itself had ALREADY moved past it (this function's own write, chronologically
 * later, same live clientID) -- an entry the fork's history never
 * included. Merging the fork's update back into `doc` then leaves TWO
 * causally-unrelated "current" items for the SAME `phraise.base` key (this
 * function's real post-commit write, and the fork's override of the
 * stale pre-commit one): a genuine Y.Map conflict Yjs resolves by
 * comparing the two items' ids, non-deterministically from this code's
 * point of view (whichever client id compares higher wins) -- so the
 * rebase's own base-pointer update silently reverted about half the time,
 * intermittently, exactly the "commit, then immediately rebase before the
 * poller ticks" sequence gate E's stale-head-recovery check and gate F's
 * last bullet both exercise. Fixed by taking the STORED snapshot fresh,
 * in this function, AFTER its own meta writes below -- `seed.ts`'s
 * `seedFromCommit` already does exactly this (meta writes first, snapshot
 * last); this function had it backwards. The document's actual CONTENT
 * (the prosemirror fragment) does not change between `prepareCommit` and
 * `recordCommit` (this function never touches it), so the freshly-taken
 * snapshot is still byte-identical CONTENT to what was actually committed
 * -- only the `phraise` map's own bookkeeping differs, which is exactly
 * what needed fixing.
 */
export function recordCommit(doc: CrdtDoc, opts: RecordCommitOptions): void {
  const base: Base = { id: opts.commit, commit: opts.commit };
  setMeta(doc, 'phraise', 'base', base);
  setMeta(doc, 'phraise', 'lastCommit', opts.commit);
  for (const [k] of listMetaEntries(doc, 'phraise', EDITORS_PREFIX)) {
    deleteMeta(doc, 'phraise', k);
  }
  setMeta(doc, 'phraise', `snapshot:${opts.commit}`, base64FromSnapshot(snapshot(doc)));
}

export function getLastCommit(doc: CrdtDoc): string | undefined {
  return getMeta<string>(doc, 'phraise', 'lastCommit');
}
