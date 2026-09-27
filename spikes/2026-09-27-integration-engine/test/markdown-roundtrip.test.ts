// Origin: adapted from spike 3 (daemon-file-sync-fork-import), branch
// spike/2026-09-27-daemon-file-sync, commit 9343b62, test/md-roundtrip.test.ts
// and test/core.inline-leaves.test.ts's persistent-cache test.
import { test, expect } from 'vitest';
import { parseMarkdown, serializeDoc, clearParseBlockCache } from '../src/markdown/index.js';
import { handwrittenFiles } from '../src/testkit/corpus.js';

test('every handwritten corpus file round-trips byte for byte', () => {
  const files = handwrittenFiles();
  expect(files.length).toBeGreaterThan(0);
  for (const f of files) {
    const doc = parseMarkdown(f.md).doc;
    expect(serializeDoc(doc), f.id).toBe(f.md);
  }
});

test('a one-word edit changes only its own block, other blocks stay byte-identical (verbatim src/gap)', () => {
  const base = 'Paragraph one is here.\n\nParagraph two is here.\n\nParagraph three is here.\n';
  const edited = base.replace('Paragraph two is here.', 'Paragraph TWO is here.');

  const doc0 = parseMarkdown(base).doc;
  const doc1 = parseMarkdown(edited).doc;

  expect(doc0.childCount).toBe(3);
  expect(doc1.childCount).toBe(3);

  // Block 0 and block 2 are untouched: same source span and gap.
  expect(doc1.child(0).attrs.src).toBe(doc0.child(0).attrs.src);
  expect(doc1.child(0).attrs.gap).toBe(doc0.child(0).attrs.gap);
  expect(doc1.child(2).attrs.src).toBe(doc0.child(2).attrs.src);
  expect(doc1.child(2).attrs.gap).toBe(doc0.child(2).attrs.gap);

  // Block 1 is the edited one: its own source text differs.
  expect(doc1.child(1).attrs.src).not.toBe(doc0.child(1).attrs.src);

  // And the whole edited document still round-trips byte for byte.
  expect(serializeDoc(doc1)).toBe(edited);
});

test('the persistent parse/serialize cache never changes output (cold vs warm, byte for byte)', () => {
  const files = handwrittenFiles();
  expect(files.length).toBeGreaterThan(0);

  for (const { id, md } of files) {
    clearParseBlockCache();
    const coldOut = serializeDoc(parseMarkdown(md).doc);

    // Cache is warm now: a second, otherwise identical, parse+serialize pass
    // must match exactly.
    const warmOut = serializeDoc(parseMarkdown(md).doc);
    expect(warmOut, `${id}: warm-cache output differs from cold-cache output`).toBe(coldOut);

    // Forcing the cache cold again must still reproduce the same output.
    clearParseBlockCache();
    const recoldOut = serializeDoc(parseMarkdown(md).doc);
    expect(recoldOut, `${id}: re-cold output differs from the first cold output`).toBe(coldOut);
  }
});
