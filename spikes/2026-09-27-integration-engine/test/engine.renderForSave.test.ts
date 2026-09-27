// Brief 07 task 4: `engine.renderForSave(doc) -> {text, degraded}` writes a
// review flag (reason 'serialization-best-effort') on each block
// `crdt.render` reports degraded, keyed like other review flags, and
// clears it once the block serializes cleanly again. Manufactured
// degradation reused from test/crdt-render.test.ts's own comment: a link
// mark with a reference identifier that has no matching definition
// anywhere in the document.
import { test, expect } from 'vitest';
import { schema } from '../src/markdown/index.js';
import { createDoc, seed, snapshot, setMeta } from '../src/crdt/index.js';
import { renderForSave, importText, listReview } from '../src/engine/index.js';

function danglingReferenceDoc() {
  const linkMark = schema.marks.link.create({
    href: '',
    title: null,
    refType: 'shortcut',
    identifier: 'ghost',
    label: 'ghost',
    kindHint: 'reference',
  });
  const para = schema.node('paragraph', {}, [schema.text('ghost', [linkMark])]);
  return schema.node('doc', { lead: '', eol: '\n' }, [para]);
}

test('renderForSave flags a degraded block as serialization-best-effort, and clears it once the block serializes cleanly again', () => {
  const doc = createDoc();
  seed(doc, danglingReferenceDoc());

  const before = renderForSave(doc);
  expect(before.degraded).toContain(0);
  expect(before.text).toContain('ghost');

  const flaggedBefore = listReview(doc).filter((f) => f.reason === 'serialization-best-effort');
  expect(flaggedBefore.length).toBe(1);
  expect(flaggedBefore[0].text).toContain('ghost');
  expect(flaggedBefore[0].cleared).toBe(false);

  // Fix the block: import plain text with no dangling reference, replacing the document's content.
  const base = snapshot(doc);
  importText(doc, { base, text: 'plain text now\n', author: { name: 'fixer', email: 'fixer@users.phraise.test' } });

  const after = renderForSave(doc);
  expect(after.degraded).toEqual([]);
  expect(after.text).toContain('plain text now');

  const flaggedAfter = listReview(doc).filter((f) => f.reason === 'serialization-best-effort');
  expect(flaggedAfter.length).toBe(0);
});

test('renderForSave never overwrites an existing review entry with a different reason on the same block', () => {
  // Same deterministic seed peer on both docs -> the same blockId (a Yjs
  // item id) for the dangling-reference paragraph on both, so an entry
  // keyed by that id on `doc` also applies to `doc2`.
  const doc = createDoc();
  seed(doc, danglingReferenceDoc(), { clientId: 424242 });
  renderForSave(doc);
  const blockId = listReview(doc)[0].blockId;

  const doc2 = createDoc();
  seed(doc2, danglingReferenceDoc(), { clientId: 424242 });
  // Simulate the integration scan having already flagged this exact block
  // for a concurrent edit, keyed the same way (blockId -> entry), BEFORE
  // renderForSave ever runs.
  setMeta(doc2, 'review', blockId, { rebaseId: 'r1', reason: 'concurrent-edit' });

  renderForSave(doc2);
  const entries = listReview(doc2);
  expect(entries.length).toBe(1);
  expect(entries[0].reason).toBe('concurrent-edit');
});
