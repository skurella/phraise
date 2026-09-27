// Deterministic 32-bit hashing for peer IDs (plan section 1 step 2, section
// 4's seed/rebase peers). Same strings in -> same clientID out, on any
// replica, any process. Never returns 0 (Yjs treats clientID 0 as
// reserved/falsy in some code paths). Origin: spike 2's `ids.ts`
// (collab-stack-yjs13-hocuspocus, branch spike/2026-09-27-collab-stack,
// commit eeb3fe2, src/rebase/ids.ts), generalized from a single-string input
// to variadic parts (spike 1's `hash32(docId, commit)` grows an extra
// `generation` component per plan section 2's seed peer,
// `hash32(docId, commit, generation)`).
export function hash32(...parts: Array<string | number>): number {
  const input = parts.join(':');
  // FNV-1a, 32-bit. Deterministic, fast, no dependencies.
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  const unsigned = h >>> 0;
  return unsigned === 0 ? 1 : unsigned;
}

export function seedPeerId(docId: string, commit: string, generation: number): number {
  return hash32(docId, 'seed', commit, generation);
}

export function rebasePeerId(docId: string, baseId: string, targetCommit: string): number {
  return hash32(docId, baseId, targetCommit);
}

/** S2-11 fix: rebase records are keyed by hash(baseId, targetCommit), not by targetCommit alone -- rebasing back to a commit already used as SOME base's target would otherwise reuse that key. */
export function rebaseRecordId(baseId: string, targetCommit: string): string {
  return String(hash32(baseId, targetCommit));
}
