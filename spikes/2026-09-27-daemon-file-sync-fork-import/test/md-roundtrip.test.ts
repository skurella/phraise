// Sanity check that the copied spike 1 document model round-trips through Yjs here.
import { test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import * as Y from 'yjs';
import { parseMarkdown, serializeDoc, docToYDoc, yDocToDoc } from '../src/md/index.js';

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
