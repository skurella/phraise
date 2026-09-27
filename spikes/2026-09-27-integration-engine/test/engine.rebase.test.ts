// Brief 03 task 7: rebase idempotent (two replicas, identical bytes) and a
// retry is a no-op; baseConflicts detects sibling rebases; a rebase whose
// target changes a linked image's URL and link keeps both changes (spike
// 5's B3 concern for the rebase path -- brief 03's bullet 5).
import { test, expect } from 'vitest';
import { createDoc, encodeState, read, applyUpdate } from '../src/crdt/index.js';
import { semanticEq, parseMarkdown } from '../src/markdown/index.js';
import { seedFromCommit } from '../src/engine/seed.js';
import { rebase, baseConflicts } from '../src/engine/rebase.js';

const AUTHOR = { name: 'Ada', email: 'ada@example.com' };
const BASE_MD = '# Title\n\nOne two three.\n\nFour five six.\n';

function seeded(docId: string, commit = 'c0', markdown = BASE_MD) {
  const doc = createDoc();
  seedFromCommit(doc, { docId, markdown, commit, author: AUTHOR });
  return doc;
}

test('rebase applies the target and is idempotent: two replicas seeded identically, rebased the same way, produce identical bytes', () => {
  const target = '# Title\n\nOne two three FOUR.\n\nFour five six.\n';

  const docA = seeded('doc-r1');
  const resA = rebase(docA, { docId: 'doc-r1', targetMarkdown: target, targetCommit: 'c1', author: AUTHOR });
  expect(resA.applied).toBe(true);

  const docB = seeded('doc-r1');
  const resB = rebase(docB, { docId: 'doc-r1', targetMarkdown: target, targetCommit: 'c1', author: AUTHOR });

  expect(resB.rebaseId).toBe(resA.rebaseId);
  expect(encodeState(docB)).toEqual(encodeState(docA));
  expect(semanticEq(read(docA), parseMarkdown(target).doc)).toBe(true);
});

test('rebase is a no-op when the base already equals the target commit, and a retry (same rebaseId already recorded) is also a no-op', () => {
  const doc = seeded('doc-r2');
  const noop = rebase(doc, { docId: 'doc-r2', targetMarkdown: BASE_MD, targetCommit: 'c0', author: AUTHOR });
  expect(noop.applied).toBe(false);

  const target = '# Title\n\nOne two three FOUR.\n\nFour five six.\n';
  const first = rebase(doc, { docId: 'doc-r2', targetMarkdown: target, targetCommit: 'c1', author: AUTHOR });
  expect(first.applied).toBe(true);
  const before = encodeState(doc);

  const retry = rebase(doc, { docId: 'doc-r2', targetMarkdown: target, targetCommit: 'c1', author: AUTHOR });
  expect(retry.applied).toBe(false);
  expect(retry.rebaseId).toBe(first.rebaseId);
  expect(encodeState(doc)).toEqual(before); // nothing changed
});

test('baseConflicts detects two rebases forked from the same base to different targets (must not run concurrently in production)', () => {
  const doc = seeded('doc-r3');
  rebase(doc, { docId: 'doc-r3', targetMarkdown: '# Title\n\nOne two three ALPHA.\n\nFour five six.\n', targetCommit: 'c1a', author: AUTHOR });
  // Force a second, sibling rebase from the SAME original base by hand-writing a
  // second `rebase:<id>` record with baseId c0 but a different target -- this is
  // exactly the violation baseConflicts exists to catch, since a real second
  // rebase() call would see the doc's base pointer already advanced to c1a and
  // rebase from there instead. (Two orchestrator processes racing on the same
  // base is the real-world case; this test constructs the resulting map state
  // directly, which is equivalent from baseConflicts's point of view -- it only
  // ever reads the `rebase:*` records, never re-derives them.)
  const doc2 = seeded('doc-r3');
  const res2 = rebase(doc2, { docId: 'doc-r3', targetMarkdown: '# Title\n\nOne two three BETA.\n\nFour five six.\n', targetCommit: 'c1b', author: AUTHOR });
  expect(baseConflicts(doc2)).toEqual([]); // a single doc with just its own rebase never conflicts with itself

  // Merge doc2's sibling rebase record into doc (both forked from c0 to
  // different targets): simulate by applying doc2's full update into doc.
  applyUpdate(doc, encodeState(doc2), 'test-merge-sibling');

  const conflicts = baseConflicts(doc);
  expect(conflicts.length).toBe(1);
  const ids = new Set(conflicts[0].map((r) => r.id));
  expect(ids.has(res2.rebaseId)).toBe(true);
});

test("a rebase whose target changes a linked image's URL and link keeps both changes (spike 5's B3 concern)", () => {
  const base = 'See [![alt text](https://example.com/old.png)](https://example.com/old) for details.\n';
  const target = 'See [![alt text](https://example.com/new.png)](https://example.com/new) for details.\n';

  const doc = createDoc();
  seedFromCommit(doc, { docId: 'doc-b3', markdown: base, commit: 'c0', author: AUTHOR });
  const res = rebase(doc, { docId: 'doc-b3', targetMarkdown: target, targetCommit: 'c1', author: AUTHOR });
  expect(res.applied).toBe(true);

  const result = read(doc);
  expect(semanticEq(result, parseMarkdown(target).doc)).toBe(true);

  let sawNewImage = false;
  result.descendants((node) => {
    if (node.type.name === 'image' && node.attrs.url === 'https://example.com/new.png') {
      const link = node.marks.find((m) => m.type.name === 'link');
      if (link && link.attrs.href === 'https://example.com/new') sawNewImage = true;
    }
  });
  expect(sawNewImage).toBe(true);
});
