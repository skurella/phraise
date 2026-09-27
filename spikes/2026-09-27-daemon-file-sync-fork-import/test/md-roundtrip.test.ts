// Sanity check that the copied spike 1 document model round-trips through Yjs here.
import { test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import * as Y from 'yjs';
import { parseMarkdown, serializeDoc, docToYDoc, yDocToDoc, clearParseBlockCache } from '../src/md/index.js';

const CORPUS = path.resolve(import.meta.dirname, '../corpus');

test('handwritten corpus round-trips byte for byte through a binary Yjs update', () => {
  const dir = path.join(CORPUS, 'handwritten');
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.md'))) {
    const md = fs.readFileSync(path.join(dir, f), 'utf8');
    const ydoc = docToYDoc(parseMarkdown(md).doc, new Y.Doc({ gc: false }));
    const copy = new Y.Doc({ gc: false });
    Y.applyUpdate(copy, Y.encodeStateAsUpdate(ydoc));
    expect(serializeDoc(yDocToDoc(copy)), f).toBe(md);
  }
});

// Brief 04 task 3: `parse.ts`'s `parseBlock` cache now persists across calls
// (bounded by an LRU) instead of being cleared at the start/end of every
// `serializeDoc`/`parseMarkdown` call, so a save that leaves most blocks
// unchanged reuses their isolation re-parse from the previous call (see
// parse.ts's own comment, and the spike README's "Changes to copied code"
// section). That cache must never change what gets produced: parsing and
// serializing the same text must come out byte-identical whether the cache
// started cold or was already warm from a previous pass on the same text.
test('the persistent parse/serialize cache never changes output (cold vs warm, byte for byte)', () => {
  const files: Array<{ name: string; md: string }> = [];
  const handwrittenDir = path.join(CORPUS, 'handwritten');
  for (const f of fs.readdirSync(handwrittenDir).filter((f) => f.endsWith('.md'))) {
    files.push({ name: f, md: fs.readFileSync(path.join(handwrittenDir, f), 'utf8') });
  }
  const largeFile = path.join(CORPUS, 'fetched', 'real', 'nodejs-node-docapinapimd.md');
  if (fs.existsSync(largeFile)) {
    files.push({ name: 'nodejs-node-docapinapimd.md (240 KB)', md: fs.readFileSync(largeFile, 'utf8') });
  }
  expect(files.length).toBeGreaterThan(0);

  for (const { name, md } of files) {
    clearParseBlockCache();
    const coldOut = serializeDoc(parseMarkdown(md).doc);

    // Cache is warm now (it is not cleared between calls any more): a second,
    // otherwise identical, parse+serialize pass must match exactly.
    const warmOut = serializeDoc(parseMarkdown(md).doc);
    expect(warmOut, `${name}: warm-cache output differs from cold-cache output`).toBe(coldOut);

    // And forcing the cache cold again (a fresh daemon process, or simply the
    // LRU having evicted this file's entries) must still reproduce it.
    clearParseBlockCache();
    const recoldOut = serializeDoc(parseMarkdown(md).doc);
    expect(recoldOut, `${name}: re-cold output differs from the first cold output`).toBe(coldOut);
  }
});
