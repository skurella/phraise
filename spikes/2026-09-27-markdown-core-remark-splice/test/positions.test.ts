import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdown, type BlockPos } from '../src/index.js';

/**
 * The positions side table (`parseMarkdown(md, { positions: true })`) must
 * record each PM block node's *own* mdast source span, not the enclosing
 * top-level block's span -- otherwise gate B (single-word edit) cannot tell
 * whether a diff stayed inside the edited paragraph itself versus merely
 * inside the whole blockquote/list it lives in. See brief 03.
 */

const MD = `# Title

> A blockquote with a paragraph inside it that is long enough.
>
> Second quoted paragraph here.

- item one has some words in it
- item two also has some words
`;

function findByPmStart(positions: BlockPos[], pmStart: number): BlockPos {
  const found = positions.find((p) => p.pmStart === pmStart);
  assert.ok(found, `expected a position entry at pmStart ${pmStart}`);
  return found!;
}

test('positions: nested paragraphs inside a blockquote get their own span, not the blockquote span', () => {
  const { doc, positions } = parseMarkdown(MD, { positions: true });
  assert.ok(positions, 'expected positions to be returned');

  // doc children: heading (0), blockquote (1), bullet_list (2).
  const blockquote = doc.child(1);
  assert.equal(blockquote.type.name, 'blockquote');
  const blockquotePos = doc.child(0).nodeSize; // offset of the blockquote itself (a direct doc child)

  const bqEntry = findByPmStart(positions, blockquotePos);
  assert.equal(bqEntry.startLine, 3);
  assert.equal(bqEntry.endLine, 5);

  // The first paragraph inside the blockquote starts one position further in.
  const firstParaPos = blockquotePos + 1;
  const firstPara = findByPmStart(positions, firstParaPos);
  assert.equal(firstPara.startLine, 3);
  assert.equal(firstPara.endLine, 3, 'the paragraph itself spans only line 3, unlike its enclosing blockquote (3-5)');
  assert.ok(
    firstPara.source[1] < bqEntry.source[1],
    'the paragraph source span must end before the blockquote source span ends'
  );

  // The second paragraph inside the blockquote starts on line 5, also
  // distinct from both the blockquote's own span and the first paragraph's.
  let secondParaPos = -1;
  blockquote.forEach((child, offset) => {
    if (child.type.name === 'paragraph' && offset > 0) secondParaPos = blockquotePos + 1 + offset;
  });
  assert.ok(secondParaPos >= 0, 'expected a second paragraph inside the blockquote');
  const secondPara = findByPmStart(positions, secondParaPos);
  assert.equal(secondPara.startLine, 5);
  assert.equal(secondPara.endLine, 5);
  assert.notEqual(secondPara.source[0], firstPara.source[0]);
});

test('positions: a paragraph inside a list item gets its own line range distinct from the list', () => {
  const { doc, positions } = parseMarkdown(MD, { positions: true });
  assert.ok(positions);

  const list = doc.child(2);
  assert.equal(list.type.name, 'bullet_list');
  const listStartLine = 7;
  const listEndLine = 8;

  // Every paragraph nested under the list must have a *single*-line span
  // (each item is one line here), never the list's full 7-8 range.
  let sawParagraphInList = false;
  const paragraphEntries = positions.filter((p) => p.startLine >= listStartLine && p.endLine <= listEndLine);
  for (const entry of paragraphEntries) {
    if (entry.startLine === entry.endLine) sawParagraphInList = true;
  }
  assert.ok(sawParagraphInList, 'expected at least one single-line entry nested inside the list');

  // And the list node itself (top-level) should still report the full range.
  const listEntry = findByPmStart(positions, doc.child(0).nodeSize + doc.child(1).nodeSize);
  assert.equal(listEntry.startLine, listStartLine);
  assert.equal(listEntry.endLine, listEndLine);
});
