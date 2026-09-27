// Copied verbatim from spikes/2026-09-27-crdt-rebase-yjs-fork/src/ids.ts,
// with peer ids adapted to Loro's PeerID (`${number}`, a u64 as decimal
// string) instead of Yjs's 32-bit clientID. hash32's output already fits in
// an unsigned 32-bit int, which is a valid (if small) Loro PeerID.
export function hash32(input: string): number {
  // FNV-1a, 32-bit. Deterministic, fast, no dependencies.
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  const unsigned = h >>> 0;
  return unsigned === 0 ? 1 : unsigned;
}

/** Loro peer ids are `${number}` (decimal string of a u64). */
export function hash32Peer(input: string): `${number}` {
  return `${hash32(input)}`;
}

export function seedPeerId(docId: string, commit: string): `${number}` {
  return hash32Peer(`${docId}:seed:${commit}`);
}

export function rebasePeerId(
  docId: string,
  baseId: string,
  targetCommit: string
): `${number}` {
  return hash32Peer(`${docId}:${baseId}:${targetCommit}`);
}
