// Brief 03 task 7: comments A/B/C scenarios (ported from spike 2's gates to
// the full schema), reply/resolve, survival across another user's edits,
// a comment inside a table cell and one spanning two paragraphs.
import { test, expect } from 'vitest';
import { createDoc, snapshot, textProjection } from '../src/crdt/index.js';
import { seedFromCommit } from '../src/engine/seed.js';
import { importText } from '../src/engine/import.js';
import { createComment, createCommentOnQuote, reply, setResolved, listComments } from '../src/engine/comments.js';

const AUTHOR = { name: 'Ada', email: 'ada@example.com' };
const USER_A: import('../src/engine/comments.js').CommentAuthor = { userId: 'alice', name: 'Alice' };
const USER_B: import('../src/engine/comments.js').CommentAuthor = { userId: 'bob', name: 'Bob' };

const MD = `# Title

One two three four five.

Six seven eight nine ten.

| A | B |
| --- | --- |
| alpha beta gamma | delta epsilon |
`;

function seeded(docId: string) {
  const doc = createDoc();
  seedFromCommit(doc, { docId, markdown: MD, commit: 'c0', author: AUTHOR });
  return doc;
}

function editTo(doc: any, markdown: string) {
  importText(doc, { base: snapshot(doc), text: markdown, author: AUTHOR });
}

test('A: a comment on an untouched paragraph resolves by CRDT after an edit elsewhere', () => {
  const doc = seeded('doc-cA');
  const id = createCommentOnQuote(doc, 'three four', { body: 'note', author: USER_A });

  editTo(
    doc,
    `# Title

One two three four five.

Six seven eight nine TEN-EDITED.

| A | B |
| --- | --- |
| alpha beta gamma | delta epsilon |
`,
  );

  const [listed] = listComments(doc).filter((c) => c.id === id);
  expect(listed.anchor.method).toBe('crdt');
  expect(listed.anchor.quote.exact).toBe('three four');
  const text = textProjection(doc);
  expect(text.slice(listed.anchor.from!, listed.anchor.to!)).toBe('three four');
});

test('B: a comment on a paragraph rewritten below word-similarity is recovered by CRDT or fuzzy matching', () => {
  const doc = createDoc();
  seedFromCommit(doc, {
    docId: 'doc-cB',
    commit: 'c0',
    author: AUTHOR,
    markdown: `# Title

One two three four five.

Six seven eight nine ten and more filler words to dilute similarity ratios further today.

| A | B |
| --- | --- |
| alpha beta gamma | delta epsilon |
`,
  });
  // A quote long enough (>=24 chars) and, after the rewrite, unique enough
  // to stand on its own under S2-9's acceptance rule even with unmatched
  // context (see fuzzyAnchor's `distinctive` path) -- the rewrite below
  // keeps this exact phrase but changes everything around it enough that
  // the block-level diff pairs the two paragraphs below its 0.5
  // word-similarity/containment threshold (6 shared words of 15 and 16),
  // so the OLD paragraph is deleted and a new one inserted: any CRDT
  // position anchored inside it cannot resolve, forcing the fuzzy path.
  const quote = 'seven eight nine ten and more';
  const id = createCommentOnQuote(doc, quote, { body: 'note', author: USER_B });

  editTo(
    doc,
    `# Title

One two three four five.

Something else entirely happened, but seven eight nine ten and more remains unchanged for the test.

| A | B |
| --- | --- |
| alpha beta gamma | delta epsilon |
`,
  );

  const [listed] = listComments(doc).filter((c) => c.id === id);
  expect(['crdt', 'fuzzy']).toContain(listed.anchor.method);
  expect(listed.anchor.from).toBeDefined();
  const text = textProjection(doc);
  expect(text.slice(listed.anchor.from!, listed.anchor.to!)).toBe(quote);
});

test('C: a comment on a deleted paragraph is orphaned with its quote kept; a control comment elsewhere is unaffected (negative control)', () => {
  const doc = seeded('doc-cC');
  const controlId = createCommentOnQuote(doc, 'seven eight nine', { body: 'control', author: USER_A });
  const orphanId = createCommentOnQuote(doc, 'two three four', { body: 'will be orphaned', author: USER_B });

  // Delete the FIRST paragraph entirely; nothing resembling its quote exists anywhere else.
  editTo(
    doc,
    `# Title

Six seven eight nine ten.

| A | B |
| --- | --- |
| alpha beta gamma | delta epsilon |
`,
  );

  const listed = listComments(doc);
  const orphan = listed.find((c) => c.id === orphanId)!;
  expect(orphan.anchor.method).toBe('orphaned');
  expect(orphan.anchor.quote.exact).toBe('two three four');

  const control = listed.find((c) => c.id === controlId)!;
  expect(control.anchor.method).not.toBe('orphaned');
});

test('reply and setResolved: replies accumulate, resolved status is recorded', () => {
  const doc = seeded('doc-cD');
  const id = createCommentOnQuote(doc, 'four five', { body: 'first', author: USER_A });
  reply(doc, id, { body: 'a reply', author: USER_B });
  reply(doc, id, { body: 'another reply', author: USER_A });
  setResolved(doc, id, USER_B.userId, true);

  const [listed] = listComments(doc).filter((c) => c.id === id);
  expect(listed.replies.map((r) => r.body)).toEqual(['a reply', 'another reply']);
  expect(listed.resolved).toBe(true);

  setResolved(doc, id, USER_B.userId, false);
  expect(listComments(doc).find((c) => c.id === id)!.resolved).toBe(false);
});

test('a comment survives edits both inside and around its quoted range', () => {
  const doc = seeded('doc-cE');
  const id = createCommentOnQuote(doc, 'three four five', { body: 'note', author: USER_A });

  editTo(
    doc,
    `# Title

One two THREE four FIVE indeed.

Six seven eight nine ten.

| A | B |
| --- | --- |
| alpha beta gamma | delta epsilon |
`,
  );

  const [listed] = listComments(doc).filter((c) => c.id === id);
  expect(listed.anchor.method).not.toBe('orphaned');
});

test('a comment inside a table cell anchors and resolves (method reported, CRDT not required)', () => {
  const doc = seeded('doc-cF');
  const id = createCommentOnQuote(doc, 'beta', { body: 'cell comment', author: USER_A });
  const [listed] = listComments(doc).filter((c) => c.id === id);
  expect(listed.anchor.method).not.toBe('orphaned');
  const text = textProjection(doc);
  expect(text.slice(listed.anchor.from!, listed.anchor.to!)).toBe('beta');
});

test('a comment spanning two paragraphs resolves (method reported, CRDT not required)', () => {
  const doc = seeded('doc-cG');
  const text = textProjection(doc);
  const from = text.indexOf('four five');
  const to = text.indexOf('Six seven') + 'Six seven'.length;
  expect(from).toBeGreaterThanOrEqual(0);
  expect(to).toBeGreaterThan(from);

  const id = createComment(doc, { from, to, body: 'spans two blocks', author: USER_B });
  const [listed] = listComments(doc).filter((c) => c.id === id);
  expect(listed.anchor.method).not.toBe('orphaned');
  expect(listed.anchor.quote.exact).toContain('\n');
});
