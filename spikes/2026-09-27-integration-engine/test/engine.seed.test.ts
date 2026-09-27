// Brief 03 task 2/7: seedFromCommit determinism (plan section 2: "two
// replicas seeding the same inputs produce byte-identical state").
import { test, expect } from 'vitest';
import { createDoc, encodeState, read, clientId } from '../src/crdt/index.js';
import { semanticEq, parseMarkdown } from '../src/markdown/index.js';
import { seedFromCommit, getBase, getDocId, getGeneration, getSnapshotFor } from '../src/engine/seed.js';

const FIXTURE_MD = `# Title

Hello [![alt text](https://example.com/badge.png)](https://example.com) world.
Second line after a hard break.

- Item one
- Item two

| A | B |
| --- | --- |
| a1 | b1 |
| a2 | b2 |
`;

test('seedFromCommit is deterministic: two replicas seeding the same {docId, markdown, commit} produce byte-identical Y.Doc state', () => {
  const opts = { docId: 'doc-1', markdown: FIXTURE_MD, commit: 'c0', author: { name: 'Ada', email: 'ada@example.com' } };

  const docA = createDoc();
  seedFromCommit(docA, opts);
  const docB = createDoc();
  seedFromCommit(docB, opts);

  expect(encodeState(docB)).toEqual(encodeState(docA));
});

test('seedFromCommit reads back the fixture semantically and sets docId/base/generation', () => {
  const doc = createDoc();
  seedFromCommit(doc, { docId: 'doc-2', markdown: FIXTURE_MD, commit: 'c0', author: { name: 'Ada', email: 'ada@example.com' } });

  expect(semanticEq(read(doc), parseMarkdown(FIXTURE_MD).doc)).toBe(true);
  expect(getDocId(doc)).toBe('doc-2');
  expect(getGeneration(doc)).toBe(0);
  expect(getBase(doc)).toEqual({ id: 'c0', commit: 'c0' });
  expect(getSnapshotFor(doc, 'c0')).toBeDefined();
});

test('a different generation seeds a different (still deterministic) peer id, so two generations never collide on client id', () => {
  const opts = { docId: 'doc-3', markdown: FIXTURE_MD, commit: 'c0', author: { name: 'Ada', email: 'ada@example.com' } };
  const doc0 = createDoc();
  seedFromCommit(doc0, { ...opts, generation: 0 });
  const doc1 = createDoc();
  seedFromCommit(doc1, { ...opts, generation: 1 });
  expect(clientId(doc1)).not.toBe(clientId(doc0));
});
