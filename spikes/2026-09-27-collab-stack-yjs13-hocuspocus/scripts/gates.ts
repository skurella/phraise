#!/usr/bin/env npx tsx
// Gate runner for stack 13. `npm run gates` runs every gate over the real
// corpus and prints a results table; `npm run gates:quick` runs a fast
// subset (5-file sample for gate C; B3 in full; short versions of D, E, G;
// F in full -- it's cheap). Gate H belongs to the orchestrator (primary
// sources) and is reported as "not run".
//
// Ports (charter: stack 13 uses 4210-4239):
//   4210 A, 4211-4212 B/B2, 4213 C (brief 01)
//   4214 B3 (brief 03)
//   4215-4216 D (convergence, caret/undo)
//   4217-4221 E (listing/collision, reconnect/reload, restart, size x2)
//   4222-4226 G (G1, G2 x2, G3, G4)
//   4227-4228 F (main scenario, continuous-typing variant) (brief 05)
import fs from 'node:fs';
import path from 'node:path';
import { runGateA } from '../gates/gateA.js';
import { runGateB } from '../gates/gateB.js';
import { runGateB3 } from '../gates/gateB3.js';
import { runGateC } from '../gates/gateC.js';
import { runGateD } from '../gates/gateD.js';
import { runGateE } from '../gates/gateE.js';
import { runGateF, runGateFContinuousTyping } from '../gates/gateF.js';
import { runGateG } from '../gates/gateG.js';

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

  console.log(`Running stack 13 gates${QUICK ? ' (quick: 5-file sample for gate C; short D/E/G)' : ' (full)'}...\n`);

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
    numbers: `path A (server-seeded): ${c.pathAPassed}/${c.total}; path B (client-loaded): ${c.pathBPassed}/${c.total}; ${fmtMs(c.elapsedMs)}; encoded state (path A, summed): ${fmtBytes(c.encodedStateBytesTotal)} (spike 1's plain-y-prosemirror A3: 160/294; stack 14's same measure: 18.70MB)`,
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

  // --- Gate B3 ---
  console.log('Gate B3: inline atom link edits (5 cases, live binding + workarounds)...');
  const dbB3 = path.join(DATA_DIR, 'gateB3.sqlite');
  fs.rmSync(dbB3, { force: true });
  const b3 = await runGateB3({ port: 4214, dbPath: dbB3 });
  rows.push({
    gate: 'B3. Inline atom link edits',
    result: b3.pass ? 'PASS' : 'FAIL',
    numbers: b3.detail,
  });
  if (!b3.pass) anyFailure = true;
  console.log(`  -> ${b3.pass ? 'PASS' : 'FAIL'}: ${b3.detail}\n`);

  // --- Gate D ---
  console.log(`Gate D: Tiptap 3.31.3 (dedupe, schema equivalence, convergence${QUICK ? '' : ', caret, undo'})...`);
  const d = await runGateD({ ports: { convergence: 4215, caret: 4216 }, dbDir: 'data', quick: QUICK });
  rows.push({
    gate: 'D. Tiptap',
    result: d.pass ? 'PASS' : 'FAIL',
    numbers: d.checks.map((c) => `${c.pass ? 'OK' : 'FAIL'}: ${c.name}`).join('; '),
  });
  if (!d.pass) anyFailure = true;
  console.log(`  -> ${d.pass ? 'PASS' : 'FAIL'}: ${d.detail}\n`);

  // --- Gate E ---
  console.log(`Gate E: attribution (listing, collision${QUICK ? '' : ', reconnect, reload, restart, size'})...`);
  const e = await runGateE({
    ports: { listing: 4217, reconnect: 4218, restart: 4219, sizeWith: 4220, sizeWithout: 4221 },
    dbDir: 'data',
    quick: QUICK,
  });
  rows.push({
    gate: 'E. Attribution',
    result: e.pass ? 'PASS' : 'FAIL',
    numbers: e.checks.map((c) => `${c.pass ? 'OK' : 'FAIL'}: ${c.name}`).join('; ') + (QUICK ? '' : `; overhead ${fmtBytes(e.sizeMeasurement.deltaBytes)} (${e.sizeMeasurement.deltaPct.toFixed(1)}%) of ${fmtBytes(e.sizeMeasurement.withoutAttributionBytes)}`),
  });
  if (!e.pass) anyFailure = true;
  console.log(`  -> ${e.pass ? 'PASS' : 'FAIL'}: ${e.detail}\n`);

  // --- Gate G ---
  console.log(`Gate G: persistence and reconnect${QUICK ? ' (G1 only)' : ' (G1-G4)'}...`);
  const g = await runGateG({ ports: { g1: 4222, g2a: 4223, g2b: 4224, g3: 4225, g4: 4226 }, dbDir: 'data', quick: QUICK });
  rows.push({
    gate: 'G. Persistence and reconnect',
    result: g.pass ? 'PASS' : 'FAIL',
    numbers: g.checks.map((c) => `${c.pass ? 'OK' : 'FAIL'}: ${c.name}`).join('; '),
  });
  if (!g.pass) anyFailure = true;
  console.log(`  -> ${g.pass ? 'PASS' : 'FAIL'}: ${g.detail}\n`);

  // --- Gate F ---
  console.log('Gate F: spike 2\'s rebase scenario with live editors (relay-applied rebase, offline bob, comments A-D)...');
  const dbF = path.join(DATA_DIR, 'gateF.sqlite');
  fs.rmSync(dbF, { force: true });
  const f = await runGateF({ port: 4227, dbPath: dbF });
  rows.push({
    gate: 'F. Rebase port (live editors)',
    result: f.pass ? 'PASS' : 'FAIL',
    numbers: f.checks.map((c) => `${c.pass ? 'OK' : 'FAIL'}: ${c.name}`).join('; '),
  });
  if (!f.pass) anyFailure = true;
  console.log(`  -> ${f.pass ? 'PASS' : 'FAIL'}: ${f.detail}\n`);

  console.log('Gate F variant: alice types continuously while the rebase is applied...');
  const dbFVariant = path.join(DATA_DIR, 'gateF-continuous.sqlite');
  fs.rmSync(dbFVariant, { force: true });
  const fVariant = await runGateFContinuousTyping({ port: 4228, dbPath: dbFVariant });
  rows.push({
    gate: 'F (variant). Continuous typing during rebase',
    result: fVariant.pass ? 'PASS' : 'FAIL',
    numbers: fVariant.detail,
  });
  if (!fVariant.pass) anyFailure = true;
  console.log(`  -> ${fVariant.pass ? 'PASS' : 'FAIL'}: ${fVariant.detail}\n`);

  rows.push({ gate: 'H. (orchestrator, primary sources)', result: 'not run', numbers: '-' });

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
    gateB3: b3,
    gateC: c,
    gateD: d,
    gateE: e,
    gateF: f,
    gateF_continuousTyping: fVariant,
    gateG: g,
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
