// Debug tool: serialize one top-level block given as ProseMirror JSON (one line
// in a file) inside a minimal doc, print the serializer trace and output.
//   npx tsx tools/serialize-block.ts <file-with-node-json>
import fs from 'node:fs';
import { schema, serializeDoc, parseMarkdown, semanticEq } from '../src/md/index.js';

const json = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const node = schema.nodeFromJSON(json);
const doc = schema.node('doc', { lead: '', eol: '\n' }, [node]);
const out = serializeDoc(doc, {
  trace: (info) => console.log('trace:', JSON.stringify(info).slice(0, 300)),
  onUnverified: 'emit',
} as any);
console.log('OUT:', JSON.stringify(out));
const re = parseMarkdown(out).doc;
console.log('reparse equal:', semanticEq(re, doc));
console.log('REPARSED:', JSON.stringify(re.toJSON()).slice(0, 1500));
