#!/usr/bin/env npx tsx
// Task 1 verification: spike 1's no-edit round trip still holds on the
// copied code, for the real corpus files (fetched by scripts/fetch-corpus.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { parseMarkdown, serializeDoc } from '../src/index.js';

const SPIKE_DIR = process.cwd();
const REAL_DIR = path.join(SPIKE_DIR, 'corpus/fetched/real');
const HANDWRITTEN_DIR = path.join(SPIKE_DIR, 'corpus/handwritten');

function listFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => path.join(dir, f));
}

function checkSet(name: string, files: string[]) {
  let ok = 0;
  let fail = 0;
  const failures: string[] = [];
  for (const file of files) {
    const md = fs.readFileSync(file, 'utf8');
    try {
      const { doc } = parseMarkdown(md);
      const out = serializeDoc(doc);
      if (out === md) {
        ok++;
      } else {
        fail++;
        failures.push(file);
      }
    } catch (e) {
      fail++;
      failures.push(`${file} (exception: ${(e as Error).message})`);
    }
  }
  console.log(`${name}: ${ok}/${files.length} byte-identical, ${fail} failed`);
  if (failures.length) {
    console.log(`  failures: ${failures.slice(0, 10).join(', ')}${failures.length > 10 ? ' ...' : ''}`);
  }
  return { ok, total: files.length };
}

const real = listFiles(REAL_DIR);
const handwritten = listFiles(HANDWRITTEN_DIR);

console.log(`Checking no-edit round trip (serializeDoc(parseMarkdown(md).doc) === md)`);
const r1 = checkSet('real', real);
const r2 = checkSet('handwritten', handwritten);

const total = r1.total + r2.total;
const okTotal = r1.ok + r2.ok;
console.log(`\nTotal (real + handwritten): ${okTotal}/${total} byte-identical`);
if (okTotal !== total) process.exit(1);
