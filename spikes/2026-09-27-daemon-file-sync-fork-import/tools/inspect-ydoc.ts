// Debug tool: load a Y update dumped by `FUZZ_DEBUG=1 gates/fuzz.ts`, render it
// with DocSync.renderDetailed, and show where the rendered file's top-level
// blocks differ from the document's.
//   npx tsx tools/inspect-ydoc.ts <file.ydoc> [blockIndex]
import fs from 'node:fs';
import * as Y from 'yjs';
import { DocSync } from '../src/core/docsync.js';
import { yDocToDoc, parseMarkdown, parseMdast, semanticEq } from '../src/md/index.js';

const ydoc = new Y.Doc({ gc: false });
Y.applyUpdate(ydoc, new Uint8Array(fs.readFileSync(process.argv[2])));
const sync = new DocSync(ydoc);
const doc = yDocToDoc(ydoc);
const r = sync.renderDetailed();
console.log('degraded', r.degraded, 'boundaryRepairs', r.boundaryRepairs, 'composed', r.composed);
console.log('doc blocks', doc.childCount, 'mdast blocks', parseMdast(r.text).children.length);
const re = parseMarkdown(r.text).doc;
let i = 0;
while (i < doc.childCount && i < re.childCount && semanticEq(doc.child(i), re.child(i))) i++;
console.log('first differing block', i);
const at = Number(process.argv[3] ?? i);
for (let k = Math.max(0, at - 1); k <= Math.min(doc.childCount - 1, at + 1); k++) {
  const n = doc.child(k);
  console.log(`doc[${k}] ${n.type.name} src=${JSON.stringify(n.attrs.src)} gap=${JSON.stringify(n.attrs.gap)}`);
}
const md = parseMdast(r.text);
for (let k = Math.max(0, at - 1); k <= Math.min(md.children.length - 1, at + 1); k++) {
  const n = md.children[k];
  console.log(`mdast[${k}] ${n.type} ${JSON.stringify(r.text.slice(n.position.start.offset, n.position.end.offset)).slice(0, 200)}`);
}
