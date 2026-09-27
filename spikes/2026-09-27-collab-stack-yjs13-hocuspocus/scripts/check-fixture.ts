#!/usr/bin/env npx tsx
import fs from 'node:fs';
import { parseMarkdown, serializeDoc } from '../src/index.js';

const md = fs.readFileSync('fixtures/live.md', 'utf8');
const { doc } = parseMarkdown(md);
console.log('doc.attrs =', doc.attrs);

let imageCount = 0;
let linkedImageCount = 0;
doc.descendants((node) => {
  if (node.type.name === 'image') {
    imageCount++;
    const hasLink = node.marks.some((m) => m.type.name === 'link');
    if (hasLink) linkedImageCount++;
    console.log('image', node.attrs.url, 'marks=', node.marks.map((m) => m.type.name));
  }
});
console.log('images:', imageCount, 'linked images:', linkedImageCount);

const out = serializeDoc(doc);
console.log('round-trip byte-identical:', out === md);
if (out !== md) {
  console.log('--- expected ---');
  console.log(JSON.stringify(md));
  console.log('--- actual ---');
  console.log(JSON.stringify(out));
}
