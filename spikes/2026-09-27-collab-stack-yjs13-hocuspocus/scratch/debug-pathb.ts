// Orchestrator debug: gate C path B (reused client pair, whole-document
// replace per file) over a window of corpus files; on a mismatch in editor 2,
// wait 5 s and print how editor 1, editor 2 and the original differ.
// Run: npx tsx scratch/debug-pathb.ts <firstIndex> <lastIndex>
import 'global-jsdom/register';
import fs from 'node:fs';
import path from 'node:path';
import { startRelay } from '../src/harness.js';
import { createLiveClient, waitUntil } from '../src/client.js';
import { parseMarkdown } from '../src/parse.js';
import { serializeDoc } from '../src/serialize.js';
import { replaceWholeDoc } from '../gates/lib/edits.js';

const dir = 'corpus/fetched/real';
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
const from = Number(process.argv[2] ?? 0);
const to = Number(process.argv[3] ?? files.length - 1);

function ser(d: any): string {
  try {
    return serializeDoc(d);
  } catch (e) {
    return `<<${(e as Error).message}>>`;
  }
}
function firstDiff(a: string, b: string): string {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return `at ${i}: A=${JSON.stringify(a.slice(Math.max(0, i - 60), i + 60))}\n      B=${JSON.stringify(b.slice(Math.max(0, i - 60), i + 60))}`;
}

const relay = await startRelay({ port: 4230, db: 'data/debug-pathb.sqlite', seeds: dir });
try {
  const [c1, c2] = await Promise.all([
    createLiveClient({ url: relay.wsUrl, docName: 'load:debug', token: 'b1' }),
    createLiveClient({ url: relay.wsUrl, docName: 'load:debug', token: 'b2' }),
  ]);
  for (let i = from; i <= to; i++) {
    const original = fs.readFileSync(path.join(dir, files[i]), 'utf8');
    replaceWholeDoc(c1.view, parseMarkdown(original).doc);
    const t0 = Date.now();
    await waitUntil(() => c2.view.state.doc.textContent.length === c1.view.state.doc.textContent.length, 8000).catch(() => {});
    const t1 = Date.now();
    const sameJson = () => JSON.stringify(c2.view.state.doc.toJSON()) === JSON.stringify(c1.view.state.doc.toJSON());
    let jsonOk = true;
    await waitUntil(sameJson, 8000).catch(() => { jsonOk = false; });
    const t2 = Date.now();
    if (t2 - t0 > 1000 || !jsonOk) console.log(`#${i} ${files[i]} ${original.length}B: length-equal ${t1 - t0} ms, json-equal ${jsonOk ? t2 - t1 + ' ms later' : 'NEVER (8 s)'}`);
    const o2 = ser(c2.view.state.doc);
    if (o2 === original) continue;
    await new Promise((r) => setTimeout(r, 5000));
    const o1 = ser(c1.view.state.doc);
    const o2b = ser(c2.view.state.doc);
    const j1 = JSON.stringify(c1.view.state.doc.toJSON());
    const j2 = JSON.stringify(c2.view.state.doc.toJSON());
    console.log(`#${i} ${files[i]}: editor1 ${o1 === original ? 'ok' : 'MISMATCH'}, editor2 ${o2b === original ? 'ok after wait' : 'MISMATCH'}, pm json equal ${j1 === j2}`);
    if (o2b !== original) console.log('  e2 vs original', firstDiff(original, o2b));
    if (o1 !== original) console.log('  e1 vs original', firstDiff(original, o1));
    if (j1 !== j2) console.log('  json e1 vs e2', firstDiff(j1, j2));
  }
  c1.destroy();
  c2.destroy();
} finally {
  await relay.stop();
}
process.exit(0);
