// New for this spike (brief 04, src/relay/). `POST /commit` (plan section
// 6): `engine.prepareCommit`, `git.commit` with `expectedHead` = the
// document's base commit, author = the user, co-authors = everyone else in
// `editorsSinceCommit`, then `engine.recordCommit`, then flush the draft
// (or delete it if nothing uncommitted remains -- `flushBranch` already
// deletes when its composed file set is empty). A stale head returns
// `{reason: 'stale'}`.
//
// Brief 06 task 3: "`POST /commit` compares the remote head with the
// document's base; if it moved, poll-and-rebase first, then commit. On a
// lease rejection, rebase and retry, up to 3 attempts, then `409`." Both
// halves of that sentence are the same loop: attempt 1 already rebases
// first whenever the document's own base is stale (the common case: an
// external commit landed since this document was last rebased/committed
// and the poller simply hasn't ticked yet); a lease rejection on the push
// itself means someone else's commit landed in the narrow window between
// that rebase and this push, so the loop goes around again -- observes the
// now-even-newer head, rebases again, retries -- up to `MAX_ATTEMPTS`
// pushes total.
import { getBase, getDocId, prepareCommit, recordCommit, editorsSinceCommit } from '../engine/index.js';
import type { CrdtDoc } from '../crdt/index.js';
import type { GitStore } from '../git/index.js';
import type { BranchState, RelayCounters } from './state.js';
import { flushBranch, type FlushOutcome } from './flush.js';
import { identityFor } from './identity.js';
import { rebaseToHead } from './rebaseHead.js';

export type CommitOutcome =
  | { ok: true; commit: string; coAuthors: string[]; flush: FlushOutcome; rebased: boolean }
  | { ok: false; reason: 'stale'; actual: string | null };

export interface CommitRequest {
  path: string;
  user: string;
  message?: string;
}

/**
 * Test-only hooks for injecting timing-sensitive behavior around a commit.
 * Never set outside tests. Brief 09 defect 1's relay-level test uses
 * `afterPrepareCommit` (awaited between `prepareCommit` and the git push)
 * to make a second live editor's edit land on the same shared `doc` during
 * exactly the window `recordCommit`'s fix (see `engine/commit.ts`'s header
 * comment) needs to handle correctly.
 */
export interface CommitTestHooks {
  afterPrepareCommit?: () => Promise<void> | void;
}

const MAX_ATTEMPTS = 3;

export async function commitDocument(
  gitStore: GitStore,
  branchState: BranchState,
  doc: CrdtDoc,
  req: CommitRequest,
  counters: RelayCounters,
  testHooks?: CommitTestHooks,
): Promise<CommitOutcome> {
  const docId = getDocId(doc);
  if (!docId) throw new Error(`commitDocument: document for "${req.path}" has no docId (not seeded)`);

  let rebased = false;
  let lastActual: string | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const base = getBase(doc);
    if (!base) throw new Error(`commitDocument: document for "${req.path}" has no base pointer (not seeded)`);

    const remoteHead = await gitStore.remoteHead(branchState.branch);
    if (remoteHead && remoteHead !== base.commit) {
      await gitStore.fetch(branchState.branch);
      await rebaseToHead({ gitStore, doc, docId, path: req.path, head: remoteHead });
      rebased = true;
    }

    const rebasedBase = getBase(doc)!;
    const prepared = prepareCommit(doc);
    const coAuthorNames = editorsSinceCommit(doc).filter((u) => u !== req.user);

    if (testHooks?.afterPrepareCommit) await testHooks.afterPrepareCommit();

    const result = await gitStore.commit({
      branch: branchState.branch,
      expectedHead: rebasedBase.commit,
      files: { [req.path]: prepared.text },
      author: identityFor(req.user),
      message: req.message ?? `Edit ${req.path}`,
      coAuthors: coAuthorNames.map(identityFor),
    });

    if (result.ok) {
      recordCommit(doc, { commit: result.commit, snapshot: prepared.snapshot, preparedSeq: prepared.preparedSeq });
      const flush = await flushBranch(gitStore, branchState, counters);
      if (rebased) counters.commitRebaseRetries++;
      return { ok: true, commit: result.commit, coAuthors: coAuthorNames, flush, rebased };
    }

    // Lease rejection: someone else's push landed between our head check
    // (or our last attempt) and this push. Loop around -- the next
    // iteration's remoteHead()/rebase picks up exactly that new commit.
    lastActual = result.actual;
    rebased = true;
  }

  counters.staleCommits++;
  counters.commitRebaseRetries++;
  return { ok: false, reason: 'stale', actual: lastActual };
}
