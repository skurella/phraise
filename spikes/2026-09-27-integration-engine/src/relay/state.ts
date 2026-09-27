// New for this spike (brief 04, src/relay/). Shared, in-process relay
// state: the registry of currently-open documents (per branch, so the
// draft flusher can enumerate "every open document of the branch" per plan
// section 6), per-branch draft bookkeeping (the lease value to flush
// against, and the previous draft's files/sidecar so a flush can "carry
// over draft files of documents not currently open from the previous
// draft"), counters the gates read back, and the branch-keyed operation
// queue.
import type { CrdtDoc } from '../crdt/index.js';
import type { GitStore } from '../git/index.js';
import { KeyedQueue } from './keyedQueue.js';

export interface OpenDoc {
  path: string;
  generation: number;
  doc: CrdtDoc;
}

export interface LastDraft {
  commit: string;
  base: string;
  files: Record<string, string>;
  sidecar: Record<string, Uint8Array>;
}

export interface BranchState {
  branch: string;
  /** path -> OpenDoc, for every document of this branch currently loaded by this relay process. */
  open: Map<string, OpenDoc>;
  /** The draft commit this relay last wrote or read (the lease's `expected` value), or `null` if none is known yet. */
  expectedDraft: string | null;
  /** The last draft this relay itself wrote (or read on a stale rejection), for carry-over of closed documents' entries. `null` until the first flush/read. */
  lastDraft: LastDraft | null;
}

export interface RelayCounters {
  forgedRejections: number;
  staleFlushes: number;
  mergedFlushRetries: number;
  flushConflicts: number;
  staleCommits: number;
}

export class RelayState {
  readonly gitStore: GitStore;
  readonly branches = new Map<string, BranchState>();
  readonly queue = new KeyedQueue();
  readonly counters: RelayCounters = {
    forgedRejections: 0,
    staleFlushes: 0,
    mergedFlushRetries: 0,
    flushConflicts: 0,
    staleCommits: 0,
  };

  constructor(gitStore: GitStore) {
    this.gitStore = gitStore;
  }

  branchState(branch: string): BranchState {
    let b = this.branches.get(branch);
    if (!b) {
      b = { branch, open: new Map(), expectedDraft: null, lastDraft: null };
      this.branches.set(branch, b);
    }
    return b;
  }

  register(branch: string, path: string, generation: number, doc: CrdtDoc): void {
    this.branchState(branch).open.set(path, { path, generation, doc });
  }

  unregister(branch: string, path: string): void {
    this.branches.get(branch)?.open.delete(path);
  }
}
