// Brief 03 task 6. Commit preparation (serialize + trailers' data) and
// recording, plus the `editorsSinceCommit` bookkeeping (plan section 4,
// section 5's commit mechanics -- the git write itself is git/relay's job,
// not engine's; this module only prepares what a commit needs and records
// what one did). D1 as amended: "a commit records a new base and does not
// re-seed" -- `recordCommit` sets `base` directly to the new commit with
// the snapshot `prepareCommit` already took, no re-parse/re-seed.
//
// Brief 09 defect 1 (milestone-2 review log's blocker): `recordCommit` used
// to take a fully fresh `snapshot(doc)` AFTER its own meta writes (the
// brief-06 fix for a real tie-break bug -- see the git history/review log
// for that one). But `relay/commit.ts` calls `prepareCommit`, then `await`s
// a real git push, then `recordCommit` -- and a concurrent editor's real
// edit can land on the SAME shared `doc` during that await (exactly what
// the relay's `onChange` hook applies for any other connection). A fully
// fresh snapshot baked that not-yet-committed edit into what future rebases
// treat as "the committed base", so a later rebase touching the same block
// saw no local change and silently dropped the edit -- no review flag, and
// the editor lost co-author credit since her `editorsSinceCommit` entry
// was cleared even though her edit was never actually part of what got
// pushed. Fixed with two changes, both required together:
//
// 1. `recordCommit` now uses `crdt.transactExtendingSnapshot` (see that
//    module's own header comment) to extend `opts.snapshot` -- the ACTUAL
//    pre-push content snapshot `prepareCommit` took -- by exactly its own
//    meta-write transaction's effect, instead of taking an unrelated fresh
//    snapshot of whatever `doc` looks like right now. This keeps BOTH
//    properties the two historical bugs each needed: the stored snapshot's
//    `phraise` map carries this function's OWN `base`/`lastCommit` writes
//    (fixing the brief-06 tie-break bug), and its CONTENT is exactly
//    `opts.snapshot`'s content -- byte-identical to what was actually
//    pushed, never anything that landed afterward (fixing this one).
// 2. `editorsSinceCommit` gains a sequence number (`phraise.commitSeq`,
//    bumped by `prepareCommit`) instead of a plain boolean, so
//    `recordCommit` can tell "marked before this commit was prepared" (safe
//    to clear -- that edit IS part of what got pushed) apart from "marked
//    during the commit's own push window" (must survive: that user's edit
//    was never actually committed, so she must still get co-author credit
//    on the NEXT commit, and a later rebase touching the same block must
//    still see it as a local change worth flagging). `markEditor` only
//    bumps a user's OWN key up to the current `commitSeq`, so it still
//    costs at most one map write per commit cycle (plus one more only if
//    she edits again during a commit's push window).
import { snapshot, getMeta, setMeta, deleteMeta, listMetaEntries, transactExtendingSnapshot, type CrdtDoc, type CrdtSnapshot } from '../crdt/index.js';
import { base64FromSnapshot } from './seed.js';
import { renderForSave } from './renderForSave.js';
import type { Base } from './types.js';

const EDITORS_PREFIX = 'editorsSinceCommit:';
const COMMIT_SEQ_KEY = 'commitSeq';

function currentCommitSeq(doc: CrdtDoc): number {
  return getMeta<number>(doc, 'phraise', COMMIT_SEQ_KEY) ?? 0;
}

/**
 * Marks `user` as having edited since the last commit: `editorsSinceCommit:<user>`
 * = the CURRENT `commitSeq` (plan section 4; one key per user, so concurrent
 * editors never clobber each other's Y.Map LWW register the way a single
 * shared array-valued key would), written only if the key is absent or
 * holds a SMALLER value -- so a user costs at most one map write per commit
 * cycle, plus one more only if she edits again during a commit's own push
 * window (whose higher `commitSeq`, bumped by that commit's `prepareCommit`,
 * makes the write happen again exactly once).
 */
export function markEditor(doc: CrdtDoc, user: string): void {
  const seq = currentCommitSeq(doc);
  const key = `${EDITORS_PREFIX}${user}`;
  const existing = getMeta<number>(doc, 'phraise', key);
  if (existing === undefined || existing < seq) {
    setMeta(doc, 'phraise', key, seq);
  }
}

/** Every user marked as having edited since the last commit (regardless of which `commitSeq` value they carry). */
export function editorsSinceCommit(doc: CrdtDoc): string[] {
  return listMetaEntries<number>(doc, 'phraise', EDITORS_PREFIX).map(([k]) => k.slice(EDITORS_PREFIX.length));
}

export interface PrepareCommitResult {
  text: string;
  degraded: number[];
  snapshot: CrdtSnapshot;
  coAuthors: string[];
  /**
   * `commitSeq`'s value BEFORE this call's increment. `recordCommit` only
   * clears an `editorsSinceCommit` entry whose value is `<= preparedSeq` --
   * i.e. an edit marked before (or up to) this exact commit was prepared,
   * never one marked by a `markEditor` call that happens during this
   * commit's own push window (which observes the INCREMENTED `commitSeq`,
   * always `> preparedSeq`).
   */
  preparedSeq: number;
}

/**
 * Render `doc` to Markdown (best effort plus degraded-block report, via
 * `engine.renderForSave` -- brief 07 task 4: this also reconciles the
 * `review` map's `serialization-best-effort` flags against the current
 * degraded set, so a commit's own render carries the same guarantee the
 * relay's draft flush does), take its snapshot, and bump `commitSeq`, all
 * in the same synchronous step (no `await` between them, so nothing else
 * can mutate `doc` in between -- JS's single-threaded execution is the
 * whole mechanism here, matching the brief's "snapshot taken in the same
 * synchronous step"). `coAuthors` lists everyone `markEditor` has recorded
 * since the last commit; the caller (git/relay) turns that into
 * `Co-authored-by:` trailers.
 */
export function prepareCommit(doc: CrdtDoc): PrepareCommitResult {
  const rendered = renderForSave(doc);
  const snap = snapshot(doc);
  const preparedSeq = currentCommitSeq(doc);
  setMeta(doc, 'phraise', COMMIT_SEQ_KEY, preparedSeq + 1);
  return { text: rendered.text, degraded: rendered.degraded, snapshot: snap, coAuthors: editorsSinceCommit(doc), preparedSeq };
}

export interface RecordCommitOptions {
  commit: string;
  /**
   * The snapshot `prepareCommit` took -- the ACTUAL content that was
   * rendered and pushed. `recordCommit` extends exactly this (via
   * `crdt.transactExtendingSnapshot`), never a fresh `snapshot(doc)`: see
   * this module's header comment.
   */
  snapshot: CrdtSnapshot;
  /** `prepareCommit`'s `preparedSeq`, from the SAME `prepareCommit` call whose `snapshot` this is. */
  preparedSeq: number;
}

/**
 * After a commit succeeds: set `base` to the new commit, record
 * `lastCommit`, and clear only the `editorsSinceCommit` entries marked at
 * or before `opts.preparedSeq` (an entry marked during the commit's own
 * push window carries a HIGHER `commitSeq` and survives -- that edit was
 * never actually part of what got pushed). The snapshot stored under
 * `snapshot:<commit>` is `opts.snapshot` extended by exactly this
 * function's own meta-write transaction (D1 as amended: "a commit records
 * a new base and does not re-seed" -- still true; "extend", not "replace
 * outright", is what makes it also true that the stored content is
 * byte-identical to what was actually committed, per this module's header
 * comment).
 */
export function recordCommit(doc: CrdtDoc, opts: RecordCommitOptions): void {
  const extended = transactExtendingSnapshot(doc, opts.snapshot, () => {
    const base: Base = { id: opts.commit, commit: opts.commit };
    setMeta(doc, 'phraise', 'base', base);
    setMeta(doc, 'phraise', 'lastCommit', opts.commit);
    for (const [k, seq] of listMetaEntries<number>(doc, 'phraise', EDITORS_PREFIX)) {
      if (seq <= opts.preparedSeq) deleteMeta(doc, 'phraise', k);
    }
  });
  setMeta(doc, 'phraise', `snapshot:${opts.commit}`, base64FromSnapshot(extended));
}

export function getLastCommit(doc: CrdtDoc): string | undefined {
  return getMeta<string>(doc, 'phraise', 'lastCommit');
}
