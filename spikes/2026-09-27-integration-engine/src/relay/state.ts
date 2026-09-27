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
  /** Brief 06 task 2: the branch head this relay last observed (via poll or an operation that itself fetched), or `null` before the first poll. Purely an optimization -- `engine.rebase` is itself idempotent/no-op when a document's base already equals the target commit -- so this only decides whether a poll bothers to fetch and walk every open document; it is never load-bearing for correctness. */
  lastPolledHead: string | null;
}

export interface RelayCounters {
  forgedRejections: number;
  /** Brief 06 task 1: ranges accepted only because the document was inside its recovery window (a forged-identity check that would otherwise have thrown was skipped instead -- see forgery.ts's header comment for the residual this represents). */
  relayedDuringRecovery: number;
  staleFlushes: number;
  mergedFlushRetries: number;
  flushConflicts: number;
  staleCommits: number;
  /** Brief 06 task 2: total rebases actually applied (across every branch/document) by the head poller. */
  rebasesApplied: number;
  /** Brief 06 task 2: wall-clock duration (ms) of the most recently completed poll-triggered rebase pass across every open document of one branch (0 if none has run yet). */
  lastRebaseDurationMs: number;
  /** Brief 06 task 3: commits that had to rebase (once or more) before the push that finally succeeded, or that exhausted their retry budget. */
  commitRebaseRetries: number;
}

export class RelayState {
  readonly gitStore: GitStore;
  readonly branches = new Map<string, BranchState>();
  readonly queue = new KeyedQueue();
  readonly counters: RelayCounters = {
    forgedRejections: 0,
    relayedDuringRecovery: 0,
    staleFlushes: 0,
    mergedFlushRetries: 0,
    flushConflicts: 0,
    staleCommits: 0,
    rebasesApplied: 0,
    lastRebaseDurationMs: 0,
    commitRebaseRetries: 0,
  };

  /**
   * Brief 06 task 1: document name -> the timestamp (`Date.now()`-scale)
   * its recovery window ends, or absent/expired for "not in a recovery
   * window". Relay-local bookkeeping, deliberately NOT stored in the CRDT
   * doc itself (it is a statement about this relay process's own knowledge
   * of a document, not document content, and must not be replicated to or
   * trusted from clients).
   */
  private readonly recoveryWindows = new Map<string, number>();

  constructor(gitStore: GitStore) {
    this.gitStore = gitStore;
  }

  branchState(branch: string): BranchState {
    let b = this.branches.get(branch);
    if (!b) {
      b = { branch, open: new Map(), expectedDraft: null, lastDraft: null, lastPolledHead: null };
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

  /** Opens (or extends) `documentName`'s recovery window to end `windowMs` from now. */
  markRecoveryWindow(documentName: string, windowMs: number): void {
    this.recoveryWindows.set(documentName, Date.now() + windowMs);
  }

  /** True if `documentName` currently has an open recovery window (and prunes it once expired, so this map never grows unbounded). */
  inRecoveryWindow(documentName: string, now = Date.now()): boolean {
    const until = this.recoveryWindows.get(documentName);
    if (until === undefined) return false;
    if (now >= until) {
      this.recoveryWindows.delete(documentName);
      return false;
    }
    return true;
  }
}
