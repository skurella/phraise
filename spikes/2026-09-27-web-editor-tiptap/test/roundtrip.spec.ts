// Brief 01, task 7: "serializing a Tiptap-built document of
// corpus/handwritten/*.md through the page's serialize function round-trips
// byte for byte." Simulates web/src/main.ts's markdown(): convert the parsed
// document through the Tiptap-generated schema instance and back into spike
// 1's own schema instance (Node.fromJSON(schema, ...)) before calling
// serializeDoc, exactly as the page does, so this test would catch any
// attribute or node-shape loss crossing schema instances.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Node as PMNode } from 'prosemirror-model';
import { schema } from '../src/model/schema.js';
import { parseMarkdown } from '../src/model/parse.js';
import { serializeDoc } from '../src/model/serialize.js';
import { buildTiptapSchema } from '../src/collab/tiptapExtensions.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CORPUS_DIR = path.resolve(HERE, '..', 'corpus', 'handwritten');
const files = fs
  .readdirSync(CORPUS_DIR)
  .filter((f) => f.endsWith('.md'))
  .sort();

describe('serialize through a Tiptap-built document round-trips byte for byte', () => {
  const tiptapSchema = buildTiptapSchema();

  it.each(files)('%s', (file) => {
    const original = fs.readFileSync(path.join(CORPUS_DIR, file), 'utf8');
    const { doc } = parseMarkdown(original);
    const tiptapDoc = PMNode.fromJSON(tiptapSchema, doc.toJSON());
    const roundTripped = PMNode.fromJSON(schema, tiptapDoc.toJSON());
    const serialized = serializeDoc(roundTripped);
    expect(serialized).toBe(original);
  });
});
