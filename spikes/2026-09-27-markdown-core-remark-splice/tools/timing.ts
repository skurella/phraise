// Parse and serialize timing per real corpus file: tsx tools/timing.ts
import { readFileSync, readdirSync } from 'node:fs';
import { parseMarkdown, serializeDoc } from '../src/index.ts';

const dir = 'corpus/fetched/real';
const rows: { f: string; kb: number; parse: number; ser: number }[] = [];
for (const f of readdirSync(dir)) {
  const md = readFileSync(`${dir}/${f}`, 'utf8');
  const t0 = performance.now();
  const { doc } = parseMarkdown(md);
  const t1 = performance.now();
  serializeDoc(doc);
  const t2 = performance.now();
  rows.push({ f, kb: md.length / 1024, parse: t1 - t0, ser: t2 - t1 });
}
rows.sort((a, b) => b.parse + b.ser - (a.parse + a.ser));
const sum = (k: 'parse' | 'ser') => rows.reduce((s, r) => s + r[k], 0);
const med = (k: 'parse' | 'ser') => [...rows].sort((a, b) => a[k] - b[k])[Math.floor(rows.length / 2)][k];
console.log(`files ${rows.length}, parse total ${sum('parse').toFixed(0)} ms (median ${med('parse').toFixed(1)}), serialize total ${sum('ser').toFixed(0)} ms (median ${med('ser').toFixed(1)})`);
for (const r of rows.slice(0, 5)) console.log(`${r.f} ${r.kb.toFixed(0)} KB parse ${r.parse.toFixed(0)} ms serialize ${r.ser.toFixed(0)} ms`);
