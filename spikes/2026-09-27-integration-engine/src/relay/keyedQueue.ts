// New for this spike (brief 04, src/relay/). Plan section 6 / brief 04's
// design points: "per-document operation queue on the relay: flush,
// commit, and (next brief) rebase are serialized per document." A draft
// flush touches every open document of a branch at once (one draft ref per
// branch), so this spike keys the queue by BRANCH, not by individual
// document path -- a strict superset of "serialized per document" (every
// document's flush/commit is still serialized against every other
// operation on the same branch, just also against sibling documents'
// operations, which is safe, only more conservative). Logged as a
// deviation from the brief's literal per-document wording.
export class KeyedQueue {
  private tails = new Map<string, Promise<unknown>>();

  /** Runs `fn` after every previously queued `run(key, ...)` for the same `key` has settled (success or failure), returning its result. */
  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prior = this.tails.get(key) ?? Promise.resolve();
    const settledPrior = prior.then(
      () => undefined,
      () => undefined,
    );
    const next = settledPrior.then(fn);
    this.tails.set(
      key,
      next.then(
        () => undefined,
        () => undefined,
      ),
    );
    return next;
  }
}
