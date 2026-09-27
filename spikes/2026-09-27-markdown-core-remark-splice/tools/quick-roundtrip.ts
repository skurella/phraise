import { readFileSync, readdirSync } from 'node:fs';
import { parseMarkdown, serializeDoc } from '../src/index.ts';
const dirs = ['corpus/handwritten', 'corpus/fetched/real', 'corpus/fetched/commonmark', 'corpus/fetched/gfm'];
for (const d of dirs) {
  let n = 0, ok = 0, unstable = 0, unstableFiles: string[] = [];
  for (const f of readdirSync(d)) {
    const md = readFileSync(`${d}/${f}`, 'utf8');
    n++;
    const { doc } = parseMarkdown(md);
    if (serializeDoc(doc) === md) ok++; else console.log('FAIL', d, f);
    let u = 0;
    doc.forEach((b) => { if (b.type.name === 'raw_block' && String(b.attrs.kind).startsWith('unstable')) u++; });
    if (u) { unstable += u; unstableFiles.push(f); }
  }
  console.log(d, n, ok, 'unstable blocks', unstable, unstableFiles.slice(0, 20).join(' '));
}
