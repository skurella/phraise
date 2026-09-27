// Origin: adapted from spike 3 (daemon-file-sync-fork-import), branch
// spike/2026-09-27-daemon-file-sync, commit 9343b62,
// test/core.inline-leaves.test.ts's Yjs round-trip check, extended per
// brief 01 task 6 to also cover root attrs and a linked image (a badge
// image inside a link -- the case src/crdt/codec.ts's header comment calls
// out as the common case the leafMarks encoding exists for).
import { test, expect } from 'vitest';
import { parseMarkdown, semanticEq } from '../src/markdown/index.js';
import { createDoc, seed, read } from '../src/crdt/index.js';
import { handwrittenFiles } from '../src/testkit/corpus.js';

test('seed then read equals the parsed doc, for every handwritten corpus file', () => {
  const files = handwrittenFiles();
  expect(files.length).toBeGreaterThan(0);
  for (const { id, md } of files) {
    const parsed = parseMarkdown(md).doc;
    const doc = createDoc();
    seed(doc, parsed);
    const roundtripped = read(doc);
    expect(semanticEq(roundtripped, parsed), id).toBe(true);
  }
});

test('seed then read preserves root attrs (lead, eol) for a file with a non-default lead', () => {
  const md = '\n\n# Heading\n\nParagraph.\n';
  const parsed = parseMarkdown(md).doc;
  expect(parsed.attrs.lead).toBe('\n\n');

  const doc = createDoc();
  seed(doc, parsed);
  const roundtripped = read(doc);
  expect(roundtripped.attrs.lead).toBe('\n\n');
  expect(roundtripped.attrs.eol).toBe('\n');
});

test('seed then read preserves marks on a linked (badge) image, an inline leaf node', () => {
  const md = 'See [![alt text](https://example.com/badge.png)](https://example.com) for details.\n';
  const parsed = parseMarkdown(md).doc;

  // Sanity: the parse actually produced an image with a link mark (otherwise
  // this test would pass vacuously).
  let sawLinkedImage = false;
  parsed.descendants((node) => {
    if (node.type.name === 'image' && node.marks.some((m) => m.type.name === 'link')) sawLinkedImage = true;
  });
  expect(sawLinkedImage).toBe(true);

  const doc = createDoc();
  seed(doc, parsed);
  const roundtripped = read(doc);
  expect(semanticEq(roundtripped, parsed)).toBe(true);

  let sawLinkedImageAfter = false;
  roundtripped.descendants((node) => {
    if (node.type.name === 'image' && node.marks.some((m) => m.type.name === 'link')) sawLinkedImageAfter = true;
  });
  expect(sawLinkedImageAfter).toBe(true);
});
