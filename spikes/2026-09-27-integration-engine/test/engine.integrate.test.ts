// Brief 03 task 7, bullet D/D2: an offline edit and an upstream edit to the
// same paragraph both survive and the block is flagged on every replica;
// converge in every batch order of three replicas; D2, deleted upstream
// plus edited offline is resurrected once and flagged.
import { test, expect } from 'vitest';
import { createDoc, read, setClientId, snapshot } from '../src/crdt/index.js';
import { semanticEq, parseMarkdown } from '../src/markdown/index.js';
import { seedFromCommit } from '../src/engine/seed.js';
import { rebase } from '../src/engine/rebase.js';
import { attachIntegration, ackOwnRebase, listReview } from '../src/engine/integrate.js';
import { importText } from '../src/engine/import.js';
import { hash32 } from '../src/engine/ids.js';
import { Hub, HUB_REMOTE_ORIGIN } from '../src/testkit/hub.js';

const AUTHOR = { name: 'Ada', email: 'ada@example.com' };
const isHubRemote = (origin: unknown) => origin === HUB_REMOTE_ORIGIN;

const MD0 = '# Title\n\nOne two three.\n\nFour five six.\n';

function replica(docId: string, name: string) {
  const doc = createDoc();
  seedFromCommit(doc, { docId, markdown: MD0, commit: 'c0', author: AUTHOR });
  setClientId(doc, hash32(docId, 'replica', name));
  attachIntegration(doc, { isRemoteOrigin: isHubRemote });
  return doc;
}

function localEdit(doc: any, markdown: string, name: string, docId: string) {
  importText(doc, { base: snapshot(doc), text: markdown, clientId: hash32(docId, 'replica', name), author: AUTHOR });
}

test('D: an offline local edit and a concurrent upstream (rebase) edit to the same paragraph both survive, and the block is flagged for review', () => {
  const docId = 'doc-d';
  const alice = replica(docId, 'alice');
  const bob = replica(docId, 'bob');
  const hub = new Hub();
  hub.join('alice', alice);
  hub.join('bob', bob);

  // Alice edits the first paragraph while offline (never delivered to bob yet).
  localEdit(alice, '# Title\n\nOne two three ALICE.\n\nFour five six.\n', 'alice', docId);

  // Bob computes a rebase that ALSO changes the same paragraph, upstream.
  const target = '# Title\n\nOne two three BOB.\n\nFour five six.\n';
  const { rebaseId } = rebase(bob, { docId, targetMarkdown: target, targetCommit: 'c1', author: AUTHOR });
  ackOwnRebase(bob, rebaseId);

  // Alice comes back online: bob's rebase reaches her (her own offline edit
  // is part of her doc's pre-batch snapshot P, so integration sees both).
  hub.deliver('bob', 'alice');

  const aliceText = read(alice);
  let sawAlice = false;
  let sawBob = false;
  aliceText.descendants((n) => {
    if (n.isText) {
      if ((n.text ?? '').includes('ALICE')) sawAlice = true;
      if ((n.text ?? '').includes('BOB')) sawBob = true;
    }
  });
  expect(sawAlice).toBe(true);
  expect(sawBob).toBe(true);

  const aliceReview = listReview(alice);
  expect(aliceReview.length).toBeGreaterThan(0);
  expect(aliceReview.some((r) => r.reason === 'concurrent-edit')).toBe(true);

  // The flag is a shared CRDT write: once it reaches bob too, his listing shows it.
  hub.deliver('alice', 'bob');
  const bobReview = listReview(bob);
  expect(bobReview.map((r) => r.blockId).sort()).toEqual(aliceReview.map((r) => r.blockId).sort());
});

test('D2: a paragraph deleted upstream but edited offline is resurrected once and flagged deleted-upstream-edited-locally', () => {
  const docId = 'doc-d2';
  const alice = replica(docId, 'alice');
  const bob = replica(docId, 'bob');
  const hub = new Hub();
  hub.join('alice', alice);
  hub.join('bob', bob);

  localEdit(alice, '# Title\n\nOne two three ALICE.\n\nFour five six.\n', 'alice', docId);

  // Bob's rebase target DELETES the first paragraph entirely.
  const target = '# Title\n\nFour five six.\n';
  const { rebaseId } = rebase(bob, { docId, targetMarkdown: target, targetCommit: 'c1', author: AUTHOR });
  ackOwnRebase(bob, rebaseId);

  hub.deliver('bob', 'alice');

  const aliceText = read(alice);
  let sawAlice = false;
  aliceText.descendants((n) => {
    if (n.isText && (n.text ?? '').includes('ALICE')) sawAlice = true;
  });
  expect(sawAlice).toBe(true); // resurrected, not lost

  const review = listReview(alice);
  const resurrected = review.filter((r) => r.reason === 'deleted-upstream-edited-locally');
  expect(resurrected.length).toBe(1);
  expect(resurrected[0].text).toContain('ALICE');

  // Delivering the same rebase record again (e.g. a duplicate/replayed
  // batch) must not resurrect a second time: the ack already written means
  // this record is no longer "pending" for alice.
  hub.deliver('bob', 'alice'); // nothing new queued, but exercise the no-op path
  expect(listReview(alice).filter((r) => r.reason === 'deleted-upstream-edited-locally').length).toBe(1);
});

test('three replicas converge to the same content under different delivery orders of the same set of updates', () => {
  const orders: Array<Array<'a-to-hub' | 'b-to-hub' | 'c-to-hub'>> = [
    ['a-to-hub', 'b-to-hub', 'c-to-hub'],
    ['c-to-hub', 'a-to-hub', 'b-to-hub'],
    ['b-to-hub', 'c-to-hub', 'a-to-hub'],
  ];

  for (const order of orders) {
    const docId = `doc-conv-${order.join('')}`;
    const a = replica(docId, 'a');
    const b = replica(docId, 'b');
    const c = replica(docId, 'c');
    const hub = new Hub();
    hub.join('a', a);
    hub.join('b', b);
    hub.join('c', c);

    // Each replica edits a DIFFERENT block, offline from the others.
    localEdit(a, '# Title A\n\nOne two three.\n\nFour five six.\n', 'a', docId);
    localEdit(b, '# Title\n\nOne two three B.\n\nFour five six.\n', 'b', docId);
    localEdit(c, '# Title\n\nOne two three.\n\nFour five six C.\n', 'c', docId);

    const steps: Record<string, () => void> = {
      'a-to-hub': () => {
        hub.deliver('a', 'b');
        hub.deliver('a', 'c');
      },
      'b-to-hub': () => {
        hub.deliver('b', 'a');
        hub.deliver('b', 'c');
      },
      'c-to-hub': () => {
        hub.deliver('c', 'a');
        hub.deliver('c', 'b');
      },
    };
    for (const step of order) steps[step]();
    // Second pass: deliver whatever each replica produced while integrating
    // the others' updates (e.g. review-map writes), so all three fully converge.
    hub.deliverAll();

    const docA = read(a);
    const docB = read(b);
    const docC = read(c);
    expect(semanticEq(docA, docB)).toBe(true);
    expect(semanticEq(docB, docC)).toBe(true);
  }
});
