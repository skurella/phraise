import { test, expect } from 'vitest';
import * as Y from 'yjs';
import { DocSync } from '../src/core/docsync.js';

test('inline leaves: editing text around an image and a hard break takes the word-level path, not the coarse fallback', () => {
  const ydoc = new Y.Doc({ gc: false });
  const sync = new DocSync(ydoc);
  // A paragraph with text, an image, more text, a hard break, and trailing text.
  const text = 'See the ![alt](pic.png) diagram below,\nand read on.\n';
  sync.adopt(text);

  const edited = text
    .replace('See the', 'Look at the')
    .replace('diagram below,', 'chart below,')
    .replace('and read on.', 'then keep reading.');

  const result = sync.importText(edited, { author: { name: 'local-editor', kind: 'local' } });
  expect(result.kind).toBe('ok');
  if (result.kind !== 'ok') throw new Error('unreachable');
  expect(result.counters.coarseTextblocks).toBe(0);
  expect(sync.render()).toBe(edited);
});

test('inline leaves: adding a new image uses the coarse fallback and still verifies', () => {
  const ydoc = new Y.Doc({ gc: false });
  const sync = new DocSync(ydoc);
  const text = 'A plain paragraph with no images at all.\n';
  sync.adopt(text);

  const edited = 'A plain paragraph with ![new](new.png) an image now.\n';

  const result = sync.importText(edited, { author: { name: 'local-editor', kind: 'local' } });
  expect(result.kind).toBe('ok');
  if (result.kind !== 'ok') throw new Error('unreachable');
  expect(result.counters.coarseTextblocks).toBeGreaterThan(0);
  expect(sync.render()).toBe(edited);
});
