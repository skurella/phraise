// New for this spike (brief 04, src/relay/). `POST /commit` (plan section
// 6): `engine.prepareCommit`, `git.commit` with `expectedHead` = the
// document's base commit, author = the user, co-authors = everyone else in
// `editorsSinceCommit`, then `engine.recordCommit`, then flush the draft
// (or delete it if nothing uncommitted remains -- `flushBranch` already
// deletes when its composed file set is empty). A stale head returns
// `{reason: 'stale'}`; brief 06 adds rebase-then-retry.
import { getBase, prepareCommit, recordCommit, editorsSinceCommit } from '../engine/index.js';
import type { CrdtDoc } from '../crdt/index.js';
import type { GitStore } from '../git/index.js';
import type { BranchState, RelayCounters } from './state.js';
import { flushBranch, type FlushOutcome } from './flush.js';
import { identityFor } from './identity.js';

export type CommitOutcome =
  | { ok: true; commit: string; coAuthors: string[]; flush: FlushOutcome }
  | { ok: false; reason: 'stale'; actual: string | null };

export interface CommitRequest {
  path: string;
  user: string;
  message?: string;
}

export async function commitDocument(
  gitStore: GitStore,
  branchState: BranchState,
  doc: CrdtDoc,
  req: CommitRequest,
  counters: RelayCounters,
): Promise<CommitOutcome> {
  const base = getBase(doc);
  if (!base) throw new Error(`commitDocument: document for "${req.path}" has no base pointer (not seeded)`);

  const prepared = prepareCommit(doc);
  const coAuthorNames = editorsSinceCommit(doc).filter((u) => u !== req.user);

  const result = await gitStore.commit({
    branch: branchState.branch,
    expectedHead: base.commit,
    files: { [req.path]: prepared.text },
    author: identityFor(req.user),
    message: req.message ?? `Edit ${req.path}`,
    coAuthors: coAuthorNames.map(identityFor),
  });

  if (!result.ok) {
    counters.staleCommits++;
    return { ok: false, reason: 'stale', actual: result.actual };
  }

  recordCommit(doc, { commit: result.commit, snapshot: prepared.snapshot });
  const flush = await flushBranch(gitStore, branchState, counters);
  return { ok: true, commit: result.commit, coAuthors: coAuthorNames, flush };
}
