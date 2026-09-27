// Brief 07 task 5: confirm the parse cache (parse.ts's `parseBlock` LRU,
// see its own header comment) persists across `parseMarkdown`/`serializeDoc`
// calls -- a second serialization of an UNCHANGED large corpus file must be
// substantially faster than the first, because every block's isolation
// re-parse is reused instead of being paid again. Skips with a message
// (never fails) if the corpus has not been fetched (`npm run fetch`).
import { test, expect } from 'vitest';
import { parseMarkdown, serializeDoc, clearParseBlockCache } from '../src/markdown/index.js';
import { corpusFileById } from '../src/testkit/corpus.js';

test('a second parse+serialize of an unchanged 240 KB corpus file is at least 5x faster than a cold one (persistent parse-block cache)', () => {
  const file = corpusFileById('real/nodejs-node-docapinapimd');
  if (!file) {
    console.log('skipped: corpus not fetched (npm run fetch) -- corpus/fetched/real/nodejs-node-docapinapimd.md missing');
    return;
  }
  expect(file.md.length).toBeGreaterThan(200_000);

  clearParseBlockCache();
  const cold0 = performance.now();
  const doc1 = parseMarkdown(file.md).doc;
  const out1 = serializeDoc(doc1);
  const coldMs = performance.now() - cold0;
  expect(out1).toBe(file.md);

  const warm0 = performance.now();
  const doc2 = parseMarkdown(file.md).doc;
  const out2 = serializeDoc(doc2);
  const warmMs = performance.now() - warm0;
  expect(out2).toBe(file.md);

  console.log(`cache perf: cold ${coldMs.toFixed(1)}ms, warm ${warmMs.toFixed(1)}ms, speedup ${(coldMs / warmMs).toFixed(2)}x`);
  expect(warmMs, `cold ${coldMs.toFixed(1)}ms vs warm ${warmMs.toFixed(1)}ms`).toBeLessThan(coldMs / 5);
});
