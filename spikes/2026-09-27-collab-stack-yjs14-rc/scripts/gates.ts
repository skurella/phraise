#!/usr/bin/env npx tsx
// Gate runner for stack 14 (brief 02, task 8). `npm run gates` runs gates
// A, B and C over the real corpus and prints a results table; `npm run
// gates:quick` runs the same gates on a 5-file sample of gate C, for fast
// iteration. Gates D-H belong to later briefs and are reported as "not run".
//
// Ports: charter assigns stack 14 the range 4240-4269; this brief's gates
// use 4240-4243 (4240-4241 were used by ad hoc smoke scripts during
// development, kept clear of the gate runner's own range on purpose).
import fs from 'node:fs';
import path from 'node:path';
import { runGateA } from '../gates/gateA.js';
import { runGateB } from '../gates/gateB.js';
import { runGateC } from '../gates/gateC.js';

const QUICK = process.argv.includes('--quick');
const RESULTS_DIR = path.resolve('results');
const DATA_DIR = path.resolve('data');
fs.mkdirSync(RESULTS_DIR, { recursive: true });
fs.mkdirSync(DATA_DIR, { recursive: true });

interface Row {
  gate: string;
  result: 'PASS' | 'FAIL' | 'not run';
  numbers: string;
}

function fmtMs(ms: number): string {
  return ms < 1000 ? `${ms.toFixed(0)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function fmtBytes(n: number): string {
  return n < 1024 ? `${n}B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)}KB` : `${(n / 1024 / 1024).toFixed(2)}MB`;
}

async function main() {
  const rows: Row[] = [];
  let anyFailure = false;

  console.log(`Running stack 14 gates${QUICK ? ' (quick: 5-file sample for gate C)' : ' (full)'}...\n`);

  // --- Gate A ---
  console.log('Gate A: relay (two live editors + relay exchange edits)...');
  const dbA = path.join(DATA_DIR, 'gateA');
  fs.rmSync(dbA, { force: true, recursive: true });
  const a = await runGateA({ port: 4250, dbDir: dbA, seedsDir: 'fixtures' });
  rows.push({
    gate: 'A. Relay',
    result: a.pass ? 'PASS' : 'FAIL',
    numbers: `median round-trip latency (20 single-char edits): ${a.medianLatencyMs.toFixed(1)}ms`,
  });
  if (!a.pass) anyFailure = true;
  console.log(`  -> ${a.pass ? 'PASS' : 'FAIL'}: ${a.detail}\n`);

  // --- Gate B ---
  console.log('Gate B: schema fidelity while editing (no workarounds needed)...');
  const dbB = path.join(DATA_DIR, 'gateB');
  fs.rmSync(dbB, { force: true, recursive: true });
  const b = await runGateB({ port: 4251, dbDir: dbB, seedsDir: 'fixtures', docName: 'file:live.md' });
  rows.push({
    gate: 'B. Schema fidelity',
    result: b.pass ? 'PASS' : 'FAIL',
    numbers: b.pass
      ? `editor1 = editor2 = relay; every linked image kept its mark; update count stable at ${b.updateCounts.afterSettle}`
      : b.reasons.join('; '),
  });
  if (!b.pass) anyFailure = true;
  console.log(`  -> ${b.pass ? 'PASS' : 'FAIL'}: ${b.detail}\n`);

  // --- Gate C ---
  const sampleSize = QUICK ? 5 : undefined;
  console.log(`Gate C: corpus round trip, no-workaround measurement (${sampleSize ?? 'all'} files)...`);
  const dbC = path.join(DATA_DIR, 'gateC');
  fs.rmSync(dbC, { force: true, recursive: true });
  const c = await runGateC({ port: 4252, dbDir: dbC, corpusDir: 'corpus/fetched/real', sampleSize });
  rows.push({
    gate: 'C. Corpus round trip (no workaround needed)',
    result: c.pass ? 'PASS' : 'FAIL',
    numbers: `path A (server-seeded): ${c.pathAPassed}/${c.total}; path B (client-loaded): ${c.pathBPassed}/${c.total}; ${fmtMs(c.elapsedMs)}; encoded state (path A, summed): ${fmtBytes(c.encodedStateBytesTotal)} (spike 1's plain-y-prosemirror A3: 160/294; stack 13's gate C: 265/266 path A, 266/266 path B)`,
  });
  if (!c.pass) anyFailure = true;
  console.log(`  -> path A ${c.pathAPassed}/${c.total}, path B ${c.pathBPassed}/${c.total}, ${fmtMs(c.elapsedMs)}, ${fmtBytes(c.encodedStateBytesTotal)} total encoded state`);
  if (c.failures.length) {
    console.log('  Failures:');
    for (const f of c.failures) {
      console.log(`    ${f.file}: pathA=${f.pathA}${f.errorA ? ` (${f.errorA})` : ''} pathB=${f.pathB}${f.errorB ? ` (${f.errorB})` : ''}`);
    }
  }
  console.log();

  for (const gate of ['D', 'E', 'F', 'G']) {
    rows.push({ gate: `${gate}. (later brief)`, result: 'not run', numbers: '-' });
  }
  rows.push({
    gate: 'H. Maturity (Yjs 13/14 compatibility probe)',
    result: 'not run',
    numbers: 'see README / log: separate compat/ subpackage, task 6',
  });

  const header = '| Gate | Result | Numbers |\n|---|---|---|';
  const lines = rows.map((r) => `| ${r.gate} | ${r.result} | ${r.numbers} |`);
  const table = [header, ...lines].join('\n');
  console.log(table);

  const md = [
    '# Stack 14 gate results',
    '',
    `Generated ${new Date().toISOString()}. ${QUICK ? 'Quick run (gate C sampled at 5 files).' : 'Full run.'}`,
    '',
    table,
    '',
    '## Gate C failures',
    '',
    c.failures.length === 0
      ? 'None.'
      : c.failures
          .map((f) => `- \`${f.file}\`: pathA=${f.pathA}${f.errorA ? ` (${f.errorA})` : ''}, pathB=${f.pathB}${f.errorB ? ` (${f.errorB})` : ''}`)
          .join('\n'),
    '',
  ].join('\n');
  fs.writeFileSync(path.join(RESULTS_DIR, 'gates.md'), md);

  const json = {
    generatedAt: new Date().toISOString(),
    quick: QUICK,
    gateA: a,
    gateB: b,
    gateC: c,
  };
  fs.writeFileSync(path.join(RESULTS_DIR, 'gates.json'), JSON.stringify(json, null, 2));

  console.log(`\nWrote ${path.join('results', 'gates.md')} and ${path.join('results', 'gates.json')}.`);

  if (anyFailure) {
    console.error('\nOne or more gates failed.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
