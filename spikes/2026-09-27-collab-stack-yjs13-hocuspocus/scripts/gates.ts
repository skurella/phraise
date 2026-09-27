#!/usr/bin/env npx tsx
// Gate runner for stack 13 (brief 01, task 8). `npm run gates` runs gates
// A, B and C over the real corpus and prints a results table; `npm run
// gates:quick` runs the same gates on a 5-file sample of gate C, for fast
// iteration. Gates D-H belong to later briefs and are reported as "not run".
//
// Ports (charter: stack 13 uses 4210-4239, this brief's gates get
// 4210-4213; a later brief's gates D/E/G get the rest of the range).
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

async function main() {
  const rows: Row[] = [];
  let anyFailure = false;

  console.log(`Running stack 13 gates${QUICK ? ' (quick: 5-file sample for gate C)' : ' (full)'}...\n`);

  // --- Gate A ---
  console.log('Gate A: relay (two live editors + relay exchange edits)...');
  const dbA = path.join(DATA_DIR, 'gateA.sqlite');
  fs.rmSync(dbA, { force: true });
  const a = await runGateA({ port: 4210, dbPath: dbA, seedsDir: 'fixtures' });
  rows.push({
    gate: 'A. Relay',
    result: a.pass ? 'PASS' : 'FAIL',
    numbers: `median round-trip latency (20 single-char edits): ${a.medianLatencyMs.toFixed(1)}ms`,
  });
  if (!a.pass) anyFailure = true;
  console.log(`  -> ${a.pass ? 'PASS' : 'FAIL'}: ${a.detail}\n`);

  // --- Gate B (with workarounds) ---
  console.log('Gate B: schema fidelity while editing (with workarounds)...');
  const dbB1 = path.join(DATA_DIR, 'gateB-workarounds.sqlite');
  fs.rmSync(dbB1, { force: true });
  const b1 = await runGateB({
    port: 4211,
    dbPath: dbB1,
    seedsDir: 'fixtures',
    docName: 'file:live.md',
    withWorkarounds: true,
  });
  rows.push({
    gate: 'B. Schema fidelity (with workarounds)',
    result: b1.pass ? 'PASS' : 'FAIL',
    numbers: b1.pass ? 'editor1 = editor2 = relay; every linked image kept its mark' : b1.reasons.join('; '),
  });
  if (!b1.pass) anyFailure = true;
  console.log(`  -> ${b1.pass ? 'PASS' : 'FAIL'}: ${b1.detail}\n`);

  // --- Gate B negative control (plain:, no workarounds) ---
  console.log('Gate B: negative control (plain:, no workaround plugins)...');
  const dbB2 = path.join(DATA_DIR, 'gateB-plain.sqlite');
  fs.rmSync(dbB2, { force: true });
  const b2 = await runGateB({
    port: 4212,
    dbPath: dbB2,
    seedsDir: 'fixtures',
    docName: 'plain:live.md',
    withWorkarounds: false,
  });
  rows.push({
    gate: 'B2. Negative control (plain:, must show the loss)',
    result: b2.pass ? 'PASS' : 'FAIL',
    numbers: b2.pass ? `loss confirmed: ${b2.reasons.join('; ')}` : 'did NOT detect any loss -- unexpected',
  });
  if (!b2.pass) anyFailure = true;
  console.log(`  -> ${b2.pass ? 'PASS' : 'FAIL'}: ${b2.detail}\n`);

  // --- Gate C ---
  const sampleSize = QUICK ? 5 : undefined;
  console.log(`Gate C: workaround cost over the real corpus (${sampleSize ?? 'all'} files)...`);
  const dbC = path.join(DATA_DIR, 'gateC.sqlite');
  fs.rmSync(dbC, { force: true });
  const c = await runGateC({ port: 4213, dbPath: dbC, corpusDir: 'corpus/fetched/real', sampleSize });
  rows.push({
    gate: 'C. Workaround cost (corpus round trip)',
    result: c.pass ? 'PASS' : 'FAIL',
    numbers: `path A (server-seeded): ${c.pathAPassed}/${c.total}; path B (client-loaded): ${c.pathBPassed}/${c.total}; ${fmtMs(c.elapsedMs)} (spike 1's plain-y-prosemirror A3: 160/294)`,
  });
  if (!c.pass) anyFailure = true;
  console.log(`  -> path A ${c.pathAPassed}/${c.total}, path B ${c.pathBPassed}/${c.total}, ${fmtMs(c.elapsedMs)}`);
  if (c.failures.length) {
    console.log('  Failures:');
    for (const f of c.failures) {
      console.log(`    ${f.file}: pathA=${f.pathA}${f.errorA ? ` (${f.errorA})` : ''} pathB=${f.pathB}${f.errorB ? ` (${f.errorB})` : ''}`);
    }
  }
  console.log();

  for (const gate of ['D', 'E', 'F', 'G', 'H']) {
    rows.push({ gate: `${gate}. (later brief)`, result: 'not run', numbers: '-' });
  }

  // --- Print table ---
  const header = '| Gate | Result | Numbers |\n|---|---|---|';
  const lines = rows.map((r) => `| ${r.gate} | ${r.result} | ${r.numbers} |`);
  const table = [header, ...lines].join('\n');
  console.log(table);

  const md = [
    '# Stack 13 gate results',
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
    gateB_workarounds: b1,
    gateB_negativeControl: b2,
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
