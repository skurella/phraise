// Seeded PRNG for the fuzz harness. Every trial is reproducible from
// `(seed, trialIndex)`: `trialRng(seed, trialIndex)` derives a fresh,
// deterministic mulberry32 stream per trial, independent of what any other
// trial or granularity draws (granularity is applied *after* generation, see
// trial.ts, so the same seed+trialIndex produces the same document/edits
// across granularities).
export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = seed | 0;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) | 0;
    let t = Math.imul(this.s ^ (this.s >>> 15), 1 | this.s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [0, maxExclusive). */
  int(maxExclusive: number): number {
    if (maxExclusive <= 0) return 0;
    return Math.floor(this.next() * maxExclusive);
  }

  /** Integer in [min, maxInclusive]. */
  range(min: number, maxInclusive: number): number {
    if (maxInclusive <= min) return min;
    return min + this.int(maxInclusive - min + 1);
  }

  bool(pTrue = 0.5): boolean {
    return this.next() < pTrue;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)];
  }

  shuffle<T>(arr: readonly T[]): T[] {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }
}

/** FNV-1a 32-bit hash, deterministic, reused here (not from src/ids.ts,
 * which is peer-id specific) so seed derivation stays self-contained. */
function hashString(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Derive a trial's own deterministic seed from the run seed and its index.
 * Every trial's entire generation (document window, participants, edits,
 * upstream mutations, comments) is reproducible from `(seed, trialIndex)`
 * alone, and does not depend on granularity — granularity only selects how
 * the rebase's tree diff behaves, applied last. */
export function trialSeed(seed: number, trialIndex: number): number {
  return hashString(`${seed}:${trialIndex}`);
}

export function trialRng(seed: number, trialIndex: number): Rng {
  return new Rng(trialSeed(seed, trialIndex));
}
