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

/** Bound on the Myers search so a pathological candidate cannot stall an import. */
const MAX_EDIT_LENGTH = 20000;

/**
 * Edit distance in characters (inserted plus deleted) between `a` and `b`,
 * after trimming the common prefix and suffix.
 *
 * Character level, not line level: Markdown paragraphs are usually one long
 * line, and a line-level cost ties whenever the user's edit and a remote edit
 * sit in the same paragraph. The tie went to the newest version and diffed the
 * remote edit away (found by the gate I fuzz, seeds 439041105 and 439041110).
 * With a character cost, the true base of a stale save costs |user edits| and
 * every later version costs that plus the remote edits.
 *
 * `limit`: the caller only needs to know whether the cost is below it; the
 * search gives up past it and returns a value >= limit.
 */
export function diffCost(a: string, b: string, limit = Number.POSITIVE_INFINITY): number {
  if (a === b) return 0;
  const n = Math.min(a.length, b.length);
  let p = 0;
  while (p < n && a.charCodeAt(p) === b.charCodeAt(p)) p++;
  let s = 0;
  while (s < n - p && a.charCodeAt(a.length - 1 - s) === b.charCodeAt(b.length - 1 - s)) s++;
  const am = a.slice(p, a.length - s);
  const bm = b.slice(p, b.length - s);
  const upper = am.length + bm.length;
  const lower = Math.abs(am.length - bm.length);
  if (lower >= limit) return lower;
  if (am.length === 0 || bm.length === 0) return upper;
  const bound = Math.min(upper, limit, MAX_EDIT_LENGTH);
  const parts = Diff.diffChars(am, bm, { maxEditLength: bound } as Diff.BaseOptions) as Diff.Change[] | undefined;
  if (!parts) return Math.max(bound, Math.min(limit, upper));
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
 * Walk the candidates oldest (the anchor) to newest. Move from the current
 * choice C to a newer candidate W only when the save is closer to W by at
 * least half the distance between C and W:
 *
 *   cost(W) <= cost(C) - d(C, W) / 2
 *
 * Why: let R be the remote changes between C and W and U the user's edits.
 * If the editor reloaded W, cost(C) - cost(W) is about +|R|; if it did not,
 * about -|R|. The midpoint rule (plain minimum cost) is fooled when U happens
 * to resemble the inverse of R (gate I fuzz, seed 439041136: a new paragraph
 * the user typed was within a few characters of one a remote peer had typed).
 * Requiring half of |R| as evidence biases the choice toward the older
 * version. Choosing too old a base re-applies remote changes the user already
 * had (a remote insertion can be duplicated); choosing too new a base reverts
 * remote changes the user never saw (silent loss). Duplication is visible;
 * loss is not, so ambiguity resolves toward the older base.
 *
 * An exact match with a newer candidate always moves (cost(W) = 0 and
 * cost(C) = d(C, W)); an exact match with C never does.
 */
export function chooseBase(text: string, candidates: readonly Version[]): BaseChoice {
  if (candidates.length === 0) {
    throw new Error('chooseBase: no candidates (the version ring is empty; call adopt() first)');
  }
  let best = candidates[0];
  let bestCost = diffCost(best.text, text);
  for (let i = 1; i < candidates.length; i++) {
    const v = candidates[i];
    if (v.text === best.text) {
      best = v; // same bytes, newer snapshot
      continue;
    }
    const c = diffCost(v.text, text, bestCost + 1);
    if (c > bestCost) continue;
    const between = diffCost(best.text, v.text);
    if (c <= bestCost - between / 2) {
      best = v;
      bestCost = c;
    }
  }
  return { base: best, cost: bestCost };
}
