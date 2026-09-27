// Brief 03 task 2. Deterministic seeding (plan sections 2 and 4): two
// replicas seeding the same `{docId, markdown, commit, generation}` produce
// byte-identical `Y.Doc`s. Origin: spike 2's `seed.ts` (collab-stack-yjs13-
// hocuspocus, branch spike/2026-09-27-collab-stack, commit eeb3fe2,
// src/rebase/seed.ts -- itself spike 2's), adapted from that file's own
// `Y.Doc` construction + `prosemirrorToYXmlFragment` call to this spike's
// crdt interface (`seed`/`snapshot`/`getMeta`/`setMeta`), and its `phraise`
// map gains `docId`/`generation` per plan section 4 (spike 2 had no
// generations).
import { seed as crdtSeed, snapshot, getMeta, setMeta, type CrdtDoc, type CrdtSnapshot } from '../crdt/index.js';
import { parseMarkdown } from '../markdown/index.js';
import { seedPeerId } from './ids.js';
import type { Author, Base, AuthorEntry } from './types.js';

export function base64FromSnapshot(s: CrdtSnapshot): string {
  return Buffer.from(s).toString('base64');
}

export function snapshotFromBase64(b64: string): CrdtSnapshot {
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

export interface SeedOptions {
  docId: string;
  markdown: string;
  commit: string;
  author: Author;
  /** Default 0 (plan section 7's generations start counting from here). */
  generation?: number;
}

/**
 * Seed `doc` (freshly created, e.g. via `crdt.createDoc()`) in place from a
 * commit's Markdown. The deterministic seed peer id is
 * `hash32(docId, commit, generation)`; the doc's `base` pointer treats this
 * commit as both base id and commit (git commits are unique, so using the
 * commit hash as the base "id" gives every `phraise` map entry a natural,
 * collision-free key without inventing a separate id scheme -- spike 2's
 * choice, carried over). `docId`/`generation`/`base` and the author are
 * written after the content transaction commits; the `snapshot:<commit>`
 * entry is written in a further step, after `snapshot(doc)` is taken, so
 * that snapshot reflects exactly the seeded content (plan section 4: "written
 * in a second transaction after the snapshot is taken, as spike 2 does").
 * Logged deviation from spike 2's literal two-Yjs-transaction shape: each
 * `setMeta` call here transacts on its own (the crdt accessor's granularity),
 * so this is several small transactions rather than exactly two -- this does
 * not change the resulting bytes (Yjs assigns item clocks in call order,
 * not per transaction boundary), so the byte-identical-across-replicas
 * requirement still holds.
 */
export function seedFromCommit(doc: CrdtDoc, opts: SeedOptions): void {
  const generation = opts.generation ?? 0;
  const peer = seedPeerId(opts.docId, opts.commit, generation);
  const pmDoc = parseMarkdown(opts.markdown).doc;
  crdtSeed(doc, pmDoc, { clientId: peer });

  setMeta(doc, 'phraise', 'docId', opts.docId, 'seed');
  setMeta(doc, 'phraise', 'generation', generation, 'seed');
  const base: Base = { id: opts.commit, commit: opts.commit };
  setMeta(doc, 'phraise', 'base', base, 'seed');
  const authorEntry: AuthorEntry = { kind: 'seed', name: opts.author.name, email: opts.author.email, commit: opts.commit };
  setMeta(doc, 'phraise-authors', String(peer), authorEntry, 'seed');

  const snap = snapshot(doc);
  setMeta(doc, 'phraise', `snapshot:${opts.commit}`, base64FromSnapshot(snap), 'seed');
}

export function getBase(doc: CrdtDoc): Base | undefined {
  return getMeta<Base>(doc, 'phraise', 'base');
}

export function getDocId(doc: CrdtDoc): string | undefined {
  return getMeta<string>(doc, 'phraise', 'docId');
}

export function getGeneration(doc: CrdtDoc): number {
  return getMeta<number>(doc, 'phraise', 'generation') ?? 0;
}

export function getSnapshotFor(doc: CrdtDoc, id: string): CrdtSnapshot | undefined {
  const b64 = getMeta<string>(doc, 'phraise', `snapshot:${id}`);
  return b64 === undefined ? undefined : snapshotFromBase64(b64);
}
