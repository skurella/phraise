// The version ring and base choice (plan section 3.2).
import * as Y from 'yjs';
import * as crypto from 'node:crypto';
import * as Diff from 'diff';

export type VersionOrigin = 'write' | 'import' | 'adopt' | 'restore';

export interface Version {
  seq: number;
  text: string;
  hash: string;
  snapshot: Y.Snapshot;
  origin: VersionOrigin;
  at: number;
}

const RING_SIZE = 32;

export function hashText(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Characters in removed plus added lines of a line diff between `a` and
 * `b`. `Diff.diffLines` already returns large unchanged hunks for a common
 * prefix/suffix, so no separate trimming step is needed to get the same
 * result as "trim the common prefix and suffix, then diff the rest".
 */
export function diffCost(a: string, b: string): number {
  if (a === b) return 0;
  const parts = Diff.diffLines(a, b);
  let cost = 0;
  for (const part of parts) {
    if (part.added || part.removed) cost += part.value.length;
  }
  return cost;
}

/** Keeps the last 32 versions and computes the anchor / candidate set (plan 3.2). */
export class VersionRing {
  private ring: Version[] = [];
  private nextSeq = 0;

  push(v: Omit<Version, 'seq'>): Version {
    const version: Version = { ...v, seq: this.nextSeq++ };
    this.ring.push(version);
    if (this.ring.length > RING_SIZE) this.ring.shift();
    return version;
  }

  all(): readonly Version[] {
    return this.ring;
  }

  get size(): number {
    return this.ring.length;
  }

  /** The newest version whose origin is `import`, `adopt` or `restore`: the file side certainly had it. */
  anchor(): Version | undefined {
    for (let i = this.ring.length - 1; i >= 0; i--) {
      const v = this.ring[i];
      if (v.origin === 'import' || v.origin === 'adopt' || v.origin === 'restore') return v;
    }
    return undefined;
  }

  /** The anchor and every version after it; all retained versions if there is no anchor. */
  candidates(): Version[] {
    const a = this.anchor();
    if (!a) return [...this.ring];
    const idx = this.ring.findIndex((v) => v.seq === a.seq);
    return this.ring.slice(idx);
  }
}

export interface BaseChoice {
  base: Version;
  cost: number;
}

/**
 * cost(v) = diffCost(v.text, text). Minimum cost wins; ties go to the
 * newest candidate (iterating oldest-to-newest with `<=` so a later
 * candidate overwrites an earlier one on a tie).
 */
export function chooseBase(text: string, candidates: readonly Version[]): BaseChoice {
  if (candidates.length === 0) {
    throw new Error('chooseBase: no candidates (the version ring is empty; call adopt() first)');
  }
  let best = candidates[0];
  let bestCost = diffCost(best.text, text);
  for (let i = 1; i < candidates.length; i++) {
    const v = candidates[i];
    const c = diffCost(v.text, text);
    if (c <= bestCost) {
      best = v;
      bestCost = c;
    }
  }
  return { base: best, cost: bestCost };
}
