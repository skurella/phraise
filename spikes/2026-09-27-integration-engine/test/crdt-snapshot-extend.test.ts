// Brief 09 defect 1 (milestone-2 review log's blocker): `transactExtendingSnapshot`
// must return `baseSnapshot` extended by exactly one transaction's own
// effect -- a concurrent edit by another client, applied to the SAME doc
// between taking `baseSnapshot` and running the transaction (exactly what
// `relay/commit.ts`'s await on the git push lets happen), must stay
// invisible in a fork taken from the result; the transaction's own meta
// writes must be visible. This test uses `yjs` directly (test/ is not
// scanned by test/import-boundary.test.ts) purely to fork-and-inspect the
// result from outside src/crdt/ -- production code never does this itself.
import { test, expect } from 'vitest';
import * as Y from 'yjs';
import { createDoc, snapshot, setMeta, transactExtendingSnapshot } from '../src/crdt/index.js';

test('transactExtendingSnapshot hides a concurrent edit that landed after baseSnapshot, but keeps the transaction`s own meta writes', () => {
  const doc = createDoc();
  setMeta(doc, 'phraise', 'base', { id: 'seed', commit: 'c0' });
  const baseSnapshot = snapshot(doc);

  // A concurrent editor's real edit lands on the SAME doc, under a
  // DIFFERENT client id, exactly as an incoming Yjs update from another
  // live connection would (relay/server.ts's onChange hook applies these
  // directly to the shared doc via Y.applyUpdate).
  const concurrentReplica = new Y.Doc({ gc: false });
  concurrentReplica.clientID = 999;
  Y.applyUpdate(concurrentReplica, Y.encodeStateAsUpdate(doc));
  concurrentReplica.getMap('phraise-marker').set('bob-was-here', true);
  const concurrentUpdate = Y.encodeStateAsUpdate(concurrentReplica, Y.encodeStateVector(doc));
  Y.applyUpdate(doc, concurrentUpdate, 'concurrent-editor');
  expect(doc.getMap('phraise-marker').get('bob-was-here')).toBe(true); // landed on the live doc

  // recordCommit's own meta writes, run through transactExtendingSnapshot.
  const extended = transactExtendingSnapshot(doc, baseSnapshot, () => {
    setMeta(doc, 'phraise', 'base', { id: 'c1', commit: 'c1' });
    setMeta(doc, 'phraise', 'lastCommit', 'c1');
  });

  const forkAtExtended = Y.createDocFromSnapshot(doc, Y.decodeSnapshot(extended), new Y.Doc({ gc: false }));
  // The concurrent edit must NOT be visible in a fork at the extended snapshot...
  expect(forkAtExtended.getMap('phraise-marker').get('bob-was-here')).toBeUndefined();
  // ...but the transaction's own meta writes must be.
  expect(forkAtExtended.getMap('phraise').get('lastCommit')).toBe('c1');
  expect(forkAtExtended.getMap('phraise').get('base')).toEqual({ id: 'c1', commit: 'c1' });

  // Sanity: a fork at the ORIGINAL baseSnapshot sees neither (it predates both).
  const forkAtBase = Y.createDocFromSnapshot(doc, Y.decodeSnapshot(baseSnapshot), new Y.Doc({ gc: false }));
  expect(forkAtBase.getMap('phraise-marker').get('bob-was-here')).toBeUndefined();
  expect(forkAtBase.getMap('phraise').get('lastCommit')).toBeUndefined();
});

test('transactExtendingSnapshot carries over a deletion the transaction made of an item created by a DIFFERENT client (e.g. overwriting a rebase fork`s own base write)', () => {
  const doc = createDoc();
  // Simulate an earlier rebase fork's write: a 'base' entry created under a
  // different client id (as forkDiffMerge's merge would produce), the exact
  // shape recordCommit's own base-pointer write later overwrites.
  const peerReplica = new Y.Doc({ gc: false });
  peerReplica.clientID = 777;
  Y.applyUpdate(peerReplica, Y.encodeStateAsUpdate(doc));
  peerReplica.getMap('phraise').set('base', { id: 'rebase-1', commit: 'c-rebased' });
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(peerReplica, Y.encodeStateVector(doc)), 'rebase-merge');
  expect(doc.getMap('phraise').get('base')).toEqual({ id: 'rebase-1', commit: 'c-rebased' });

  const baseSnapshot = snapshot(doc);

  const extended = transactExtendingSnapshot(doc, baseSnapshot, () => {
    // Overwrites the peer-authored 'base' entry -- Y.Map.set deletes the
    // previous item (created under client 777), not under doc.clientID.
    setMeta(doc, 'phraise', 'base', { id: 'c1', commit: 'c1' });
  });

  const forkAtExtended = Y.createDocFromSnapshot(doc, Y.decodeSnapshot(extended), new Y.Doc({ gc: false }));
  expect(forkAtExtended.getMap('phraise').get('base')).toEqual({ id: 'c1', commit: 'c1' });
});
