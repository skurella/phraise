// New for this spike (brief 06 task 2, src/relay/). The head poller (plan
// section 6, charter gate F): "Per branch with open documents, `remoteHead`
// every `pollMs` ... and `POST /poll` on demand. On a new head: fetch; for
// each open document of the branch, through its queue, run `engine.rebase`
// to the new head's content (the git author from `commitInfo` as the
// rebase author), then `engine.ackOwnRebase`. A file the commit did not
// change still advances its base through the same call. Expose counters
// and the last rebase duration."
//
// One timer per branch, only while that branch has at least one open
// document (a branch nobody has open is never polled -- no live document
// needs its base advanced, and polling would just be wasted `ls-remote`
// traffic). Each pass is queued per branch (`state.queue`, same key the
// draft flusher and commit use), so a poll never races a concurrent
// flush/commit/another poll on the same branch. `rebaseToHead` (shared
// with `seeding.ts`'s restore-behind-head path and `commit.ts`'s
// post-head-move path) is itself a no-op per document when that document's
// base already equals the target commit, so calling it redundantly (e.g.
// the very first poll of a branch, before `lastPolledHead` has a value) is
// harmless, just a wasted diff.
import { getDocId } from '../engine/index.js';
import type { GitStore } from '../git/index.js';
import type { RelayState, BranchState } from './state.js';
import { rebaseToHead } from './rebaseHead.js';

export interface PollBranchResult {
  branch: string;
  moved: boolean;
  head: string | null;
  rebasedPaths: string[];
}

export class HeadPoller {
  private readonly timers = new Map<string, ReturnType<typeof setInterval>>();
  private stopped = false;

  constructor(
    private readonly gitStore: GitStore,
    private readonly state: RelayState,
    private readonly pollMs: number,
  ) {}

  /** Starts (or leaves running) a per-branch timer. Called whenever a document of `branch` opens; idempotent. */
  ensureBranch(branch: string): void {
    if (this.stopped || this.timers.has(branch)) return;
    const timer = setInterval(() => {
      this.pollBranch(branch).catch((err) => {
        console.error(`[relay] head poll of branch "${branch}" failed`, err);
      });
    }, this.pollMs);
    if (timer.unref) timer.unref();
    this.timers.set(branch, timer);
  }

  /** `POST /poll`: poll every branch that currently has at least one open document, right now. */
  async pollAll(): Promise<PollBranchResult[]> {
    const branches = [...this.state.branches.values()].filter((b) => b.open.size > 0).map((b) => b.branch);
    const out: PollBranchResult[] = [];
    for (const branch of branches) out.push(await this.pollBranch(branch));
    return out;
  }

  /** Polls one branch: if the remote head moved (or has never been observed), fetch and rebase every open document of the branch to it, serialized through the branch's queue. */
  async pollBranch(branch: string): Promise<PollBranchResult> {
    const branchState = this.state.branchState(branch);
    if (branchState.open.size === 0) return { branch, moved: false, head: branchState.lastPolledHead, rebasedPaths: [] };

    return this.state.queue.run(branch, () => this.pollBranchLocked(branchState));
  }

  private async pollBranchLocked(branchState: BranchState): Promise<PollBranchResult> {
    const head = await this.gitStore.remoteHead(branchState.branch);
    if (!head) return { branch: branchState.branch, moved: false, head: null, rebasedPaths: [] };
    if (head === branchState.lastPolledHead) {
      return { branch: branchState.branch, moved: false, head, rebasedPaths: [] };
    }

    await this.gitStore.fetch(branchState.branch);
    const start = Date.now();
    const rebasedPaths: string[] = [];
    for (const [path, entry] of branchState.open) {
      const docId = getDocId(entry.doc);
      if (!docId) continue; // not seeded yet (a load in flight); the next poll tick will pick it up
      const result = await rebaseToHead({ gitStore: this.gitStore, doc: entry.doc, docId, path, head });
      if (result.applied) {
        rebasedPaths.push(path);
        this.state.counters.rebasesApplied++;
      }
    }
    this.state.counters.lastRebaseDurationMs = Date.now() - start;
    branchState.lastPolledHead = head;
    return { branch: branchState.branch, moved: true, head, rebasedPaths };
  }

  stop(): void {
    this.stopped = true;
    for (const t of this.timers.values()) clearInterval(t);
    this.timers.clear();
  }
}
