// Deterministic 32-bit hashing for peer IDs (plan section 1, step 2 and
// section 2's seed peer). Same string in -> same clientID out, on any
// replica, any process. Never returns 0 (Yjs treats clientID 0 as reserved /
// falsy in some code paths, and the plan explicitly says "never 0").
export function hash32(input: string): number {
  // FNV-1a, 32-bit. Deterministic, fast, no dependencies.
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // Force unsigned 32-bit, then avoid 0.
  const unsigned = h >>> 0;
  return unsigned === 0 ? 1 : unsigned;
}

export function seedPeerId(docId: string, commit: string): number {
  return hash32(`${docId}:seed:${commit}`);
}

export function rebasePeerId(
  docId: string,
  baseId: string,
  targetCommit: string
): number {
  return hash32(`${docId}:${baseId}:${targetCommit}`);
}
