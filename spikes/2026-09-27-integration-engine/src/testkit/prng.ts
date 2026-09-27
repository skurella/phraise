// Origin: spike 3 (daemon-file-sync-fork-import), branch
// spike/2026-09-27-daemon-file-sync, commit 9343b62, gates/lib/prng.ts.
// Brief 03 task 1: a seeded PRNG shared by every gate that needs
// reproducible randomness (gate I's fuzz above all: every failing trial must
// replay from its seed alone). Same mulberry32 construction `gates/f-roundtrip.ts`
// already uses; factored out here so new gates don't re-implement it.

/** A small, fast, deterministic PRNG. Same output sequence for the same seed, forever. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function (): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A 32-bit seed derived from a string (e.g. a corpus file id), for a deterministic-per-id RNG. */
export function stringHashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Random integer in `[0, n)`. */
export function randInt(rng: () => number, n: number): number {
  return Math.floor(rng() * n);
}

/** Pick a random element of a non-empty array. */
export function pick<T>(rng: () => number, arr: readonly T[]): T {
  if (arr.length === 0) throw new Error('pick: empty array');
  return arr[randInt(rng, arr.length)];
}

/** A random lowercase alphanumeric word, `minLen` to `maxLen` characters, for fuzz tokens. */
export function randomWord(rng: () => number, minLen: number, maxLen: number): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const len = minLen + randInt(rng, maxLen - minLen + 1);
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[randInt(rng, alphabet.length)];
  return out;
}
