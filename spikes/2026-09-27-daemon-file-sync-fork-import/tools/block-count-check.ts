// Check that the number of top-level mdast nodes equals the number of
// top-level document blocks for every corpus file, so a cheap mdast-only
// parse can detect block boundaries that moved after serialization.
//   npx tsx tools/block-count-check.ts
import fs from 'node:fs';
import path from 'node:path';
import { parseMarkdown, parseMdast } from '../src/md/index.js';

const root = path.resolve(import.meta.dirname, '../corpus');
const files: string[] = [];
for (const dir of ['handwritten', 'fetched/real']) {
  for (const f of fs.readdirSync(path.join(root, dir))) if (f.endsWith('.md')) files.push(path.join(root, dir, f));
}
let ok = 0;
const bad: string[] = [];
let tMdast = 0;
let tFull = 0;
for (const f of files) {
  const md = fs.readFileSync(f, 'utf8');
  let t = performance.now();
  const n = parseMdast(md).children.length;
  tMdast += performance.now() - t;
  t = performance.now();
  const m = parseMarkdown(md).doc.childCount;
  tFull += performance.now() - t;
  if (n === m) ok++;
  else bad.push(`${path.basename(f)}: mdast ${n}, doc ${m}`);
}
console.log(`${ok}/${files.length} equal; mdast parse ${tMdast.toFixed(0)} ms total, full parse ${tFull.toFixed(0)} ms total`);
for (const b of bad.slice(0, 20)) console.log('  ' + b);
