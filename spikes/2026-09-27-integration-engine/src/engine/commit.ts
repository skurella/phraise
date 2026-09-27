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
  /** The snapshot `prepareCommit` returned for the text that was actually committed (forkable as of exactly that content -- D1 as amended). */
  snapshot: CrdtSnapshot;
}

/** After a commit succeeds: set `base` to the new commit (with `snapshot:<commit>` = the snapshot that was actually committed, no re-seed), record `lastCommit`, and clear `editorsSinceCommit`. */
export function recordCommit(doc: CrdtDoc, opts: RecordCommitOptions): void {
  setMeta(doc, 'phraise', `snapshot:${opts.commit}`, base64FromSnapshot(opts.snapshot));
  const base: Base = { id: opts.commit, commit: opts.commit };
  setMeta(doc, 'phraise', 'base', base);
  setMeta(doc, 'phraise', 'lastCommit', opts.commit);
  for (const [k] of listMetaEntries(doc, 'phraise', EDITORS_PREFIX)) {
    deleteMeta(doc, 'phraise', k);
  }
}

export function getLastCommit(doc: CrdtDoc): string | undefined {
  return getMeta<string>(doc, 'phraise', 'lastCommit');
}
