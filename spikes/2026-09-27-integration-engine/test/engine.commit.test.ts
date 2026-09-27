// Brief 03 task 7: prepareCommit lists editors since the last commit;
// recordCommit then an external rebase from that commit works (the base
// snapshot taken at commit time is forkable); importText at an old snapshot
// keeps a concurrent edit.
import { test, expect } from 'vitest';
import { createDoc, read, snapshot } from '../src/crdt/index.js';
import { semanticEq, parseMarkdown } from '../src/markdown/index.js';
import { seedFromCommit } from '../src/engine/seed.js';
import { markEditor, prepareCommit, recordCommit, getLastCommit } from '../src/engine/commit.js';
import { rebase } from '../src/engine/rebase.js';
import { importText } from '../src/engine/import.js';
import { makeToken, tokensIn } from '../src/testkit/tokens.js';

const AUTHOR = { name: 'Ada', email: 'ada@example.com' };
const MD0 = '# Title\n\nOne two three.\n\nFour five six.\n';

test('prepareCommit lists everyone markEditor recorded since the last commit, and renders the current content', () => {
  const doc = createDoc();
  seedFromCommit(doc, { docId: 'doc-commit-1', markdown: MD0, commit: 'c0', author: AUTHOR });

  markEditor(doc, 'alice');
  markEditor(doc, 'bob');
  markEditor(doc, 'alice'); // idempotent

  const result = prepareCommit(doc);
  expect(result.coAuthors.sort()).toEqual(['alice', 'bob']);
  expect(semanticEq(parseMarkdown(result.text).doc, parseMarkdown(MD0).doc)).toBe(true);
  expect(result.snapshot).toBeInstanceOf(Uint8Array);
});

test('recordCommit sets the new base, records lastCommit, and clears editorsSinceCommit; a later external rebase from that commit works', () => {
  const doc = createDoc();
  seedFromCommit(doc, { docId: 'doc-commit-2', markdown: MD0, commit: 'c0', author: AUTHOR });
  markEditor(doc, 'alice');

  const prepared = prepareCommit(doc);
  recordCommit(doc, { commit: 'c1', snapshot: prepared.snapshot, preparedSeq: prepared.preparedSeq });

  expect(getLastCommit(doc)).toBe('c1');
  expect(prepareCommit(doc).coAuthors).toEqual([]); // cleared

  // An external rebase from the JUST-COMMITTED commit must be forkable: the
  // base snapshot recordCommit stored is exactly what prepareCommit took,
  // no re-seed/re-parse (D1 as amended).
  const target = '# Title\n\nOne two three SEVEN.\n\nFour five six.\n';
  const res = rebase(doc, { docId: 'doc-commit-2', targetMarkdown: target, targetCommit: 'c2', author: AUTHOR });
  expect(res.applied).toBe(true);
  expect(semanticEq(read(doc), parseMarkdown(target).doc)).toBe(true);
});

test('importText at an old snapshot keeps a concurrent edit made to the live doc after that snapshot was taken', () => {
  const doc = createDoc();
  seedFromCommit(doc, { docId: 'doc-commit-3', markdown: MD0, commit: 'c0', author: AUTHOR });
  const v0 = snapshot(doc);

  // A concurrent edit lands on the live doc directly (e.g. another editor's
  // save, or a live typing session) after v0 was taken.
  const concurrentToken = makeToken('concurrent');
  const concurrentText = MD0.replace('Four five six.', concurrentToken);
  importText(doc, { base: v0, text: concurrentText, clientId: 2, author: AUTHOR });

  // Now import text edited from the OLD snapshot v0's perspective, in a
  // DIFFERENT block -- forkDiffMerge must fork (base !== live anymore) and
  // merge without reverting the concurrent edit.
  const importedToken = makeToken('imported');
  const importedText = MD0.replace('One two three.', importedToken);
  const result = importText(doc, { base: v0, text: importedText, clientId: 3, author: AUTHOR });
  expect(result.forked).toBe(true);

  const rendered = read(doc);
  let text = '';
  rendered.descendants((n) => {
    if (n.isText) text += (n.text ?? '') + ' ';
  });
  const tokens = tokensIn(text);
  expect(tokens).toContain(concurrentToken);
  expect(tokens).toContain(importedToken);
});
