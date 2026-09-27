// New for this spike (brief 06, src/relay/). The one rebase-to-head
// mechanics used by three call sites: a restore whose draft is behind the
// head (seeding.ts), the head poller's per-branch pass (poller.ts), and a
// commit that finds the remote head has moved since its document's base
// (commit.ts). Kept in one place so "the git author from `commitInfo` as
// the rebase author, then `engine.ackOwnRebase`" (the brief's own wording)
// is written exactly once.
import { rebase, ackOwnRebase, type RebaseResult } from '../engine/index.js';
import type { CrdtDoc } from '../crdt/index.js';
import type { GitStore } from '../git/index.js';

export interface RebaseToHeadOptions {
  gitStore: GitStore;
  doc: CrdtDoc;
  docId: string;
  path: string;
  head: string;
}

/**
 * Reads `path` at `head` and `head`'s commit info, then `engine.rebase`s
 * `doc` to it (author = the head commit's git author) and, if applied,
 * `engine.ackOwnRebase`s the resulting record immediately (S5-5). No-op
 * (via `rebase`'s own base-already-equals-target check) when `doc` is
 * already at `head`; still advances `doc`'s base even when `path`'s own
 * content did not change in the commit that moved the head (the diff is
 * empty, but a real rebase record is written and the base pointer moves).
 */
export async function rebaseToHead(opts: RebaseToHeadOptions): Promise<RebaseResult> {
  const targetMarkdown = (await opts.gitStore.readFile(opts.head, opts.path)) ?? '';
  const info = await opts.gitStore.commitInfo(opts.head);
  const result = rebase(opts.doc, { docId: opts.docId, targetMarkdown, targetCommit: opts.head, author: info.author });
  if (result.applied) ackOwnRebase(opts.doc, result.rebaseId);
  return result;
}
