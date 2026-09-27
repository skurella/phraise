#!/usr/bin/env npx tsx
// Gate runner for stack 14. `npm run gates` runs every gate over the real
// corpus and prints a results table; `npm run gates:quick` runs a fast
// subset (5-file sample for gate C; B3 in full; short versions of D, E, G)
// for builders. Gate F belongs to a later brief and gate H is the
// orchestrator's own primary-source write-up; both are reported as
// "not run" here.
//
// Ports (charter: stack 14 uses 4240-4269):
//   4240 A (custom relay), 4241 A (Hocuspocus) -- brief 04 task 1's
//     "run gate A on both" comparison
//   4242 B, 4243 C (both against Hocuspocus, the primary relay from here on)
//   4244 B3
//   4245-4246 D (convergence, caret/undo)
//   4247-4251 E (listing/collision, reconnect/reload, restart, size x2)
//   4252-4256 G (G1, G2 x2, G3, G4)
import fs from 'node:fs';
import path from 'node:path';
import { runGateA } from '../gates/gateA.js';
import { runGateB } from '../gates/gateB.js';
import { runGateC } from '../gates/gateC.js';
import { runGateB3 } from '../gates/gateB3.js';
import { runGateD } from '../gates/gateD.js';
import { runGateE } from '../gates/gateE.js';
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

  console.log(`Running stack 14 gates${QUICK ? ' (quick: 5-file sample for gate C; B3 full; short D/E/G)' : ' (full)'}...\n`);

  // --- Gate A, on BOTH relay flavors (brief 04 task 1) ---
  console.log('Gate A: relay, custom (attempt b, ws/@y/protocols)...');
  const dbACustom = path.join(DATA_DIR, 'gateA-custom');
  fs.rmSync(dbACustom, { force: true, recursive: true });
  const aCustom = await runGateA({ port: 4240, dbDir: dbACustom, seedsDir: 'fixtures', relay: 'custom' });
  console.log(`  -> ${aCustom.pass ? 'PASS' : 'FAIL'}: ${aCustom.detail}\n`);

  console.log('Gate A: relay, Hocuspocus (now the primary relay)...');
  const dbAHp = path.join(DATA_DIR, 'gateA-hocuspocus.sqlite');
  fs.rmSync(dbAHp, { force: true });
  const aHp = await runGateA({ port: 4241, dbDir: dbAHp, seedsDir: 'fixtures', relay: 'hocuspocus' });
  rows.push({
    gate: 'A. Relay (custom / Hocuspocus)',
    result: aCustom.pass && aHp.pass ? 'PASS' : 'FAIL',
    numbers: `custom: ${aCustom.medianLatencyMs.toFixed(1)}ms median; Hocuspocus: ${aHp.medianLatencyMs.toFixed(1)}ms median -- ${Math.abs(aCustom.medianLatencyMs - aHp.medianLatencyMs) < 15 ? 'no material difference' : 'a measurable difference, see the log'} (same jsdom-polling-interval caveat applies to both)`,
  });
  if (!aCustom.pass || !aHp.pass) anyFailure = true;
  console.log(`  -> ${aHp.pass ? 'PASS' : 'FAIL'}: ${aHp.detail}\n`);

  // --- Gate B, against Hocuspocus ---
  console.log('Gate B: schema fidelity while editing (Hocuspocus, no workarounds needed)...');
  const dbB = path.join(DATA_DIR, 'gateB-hp.sqlite');
  fs.rmSync(dbB, { force: true });
  const b = await runGateB({ port: 4242, dbDir: dbB, seedsDir: 'fixtures', docName: 'file:live.md' });
  rows.push({
    gate: 'B. Schema fidelity (Hocuspocus)',
    result: b.pass ? 'PASS' : 'FAIL',
    numbers: b.pass
      ? `editor1 = editor2 = relay; every linked image kept its mark; update count stable at ${b.updateCounts.afterSettle}; matches brief 02's custom-relay result (also PASS)`
      : b.reasons.join('; '),
  });
  if (!b.pass) anyFailure = true;
  console.log(`  -> ${b.pass ? 'PASS' : 'FAIL'}: ${b.detail}\n`);

  // --- Gate C, against Hocuspocus ---
  const sampleSize = QUICK ? 5 : undefined;
  console.log(`Gate C: corpus round trip, no-workaround measurement (Hocuspocus, ${sampleSize ?? 'all'} files)...`);
  const dbC = path.join(DATA_DIR, 'gateC-hp.sqlite');
  fs.rmSync(dbC, { force: true });
  const c = await runGateC({ port: 4243, dbDir: dbC, corpusDir: 'corpus/fetched/real', sampleSize });
  const sizeMatchesCustom = !sampleSize && Math.abs(c.encodedStateBytesTotal - 19606322) < 200000; // brief 02's custom-relay figure: 18.70MB
  rows.push({
    gate: 'C. Corpus round trip (no workaround needed)',
    result: c.pass ? 'PASS' : 'FAIL',
    numbers: `path A (server-seeded): ${c.pathAPassed}/${c.total}; path B (client-loaded): ${c.pathBPassed}/${c.total}; ${fmtMs(c.elapsedMs)}; encoded state (path A, summed): ${fmtBytes(c.encodedStateBytesTotal)}${sampleSize ? '' : ` (task 6: matches brief 02's custom-relay figure of 18.70MB${sizeMatchesCustom ? ', confirmed' : ' -- DIFFERS, see the log'})`} (spike 1's plain-y-prosemirror A3: 160/294; stack 13's gate C: 265/266 path A, 266/266 path B)`,
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
  console.log('Gate B3: inline atom link edits (5 cases, live Hocuspocus binding)...');
  const dbB3 = path.join(DATA_DIR, 'gateB3-hp.sqlite');
  fs.rmSync(dbB3, { force: true });
  const b3 = await runGateB3({ port: 4244, dbPath: dbB3 });
  rows.push({ gate: 'B3. Inline atom link edits', result: b3.pass ? 'PASS' : 'FAIL', numbers: b3.detail });
  if (!b3.pass) anyFailure = true;
  console.log(`  -> ${b3.pass ? 'PASS' : 'FAIL'}: ${b3.detail}\n`);

  // --- Gate D ---
  console.log(`Gate D: Tiptap 3.31.3 core + custom extensions (dedupe, schema equivalence, convergence${QUICK ? '' : ', caret, undo'})...`);
  const d = await runGateD({ ports: { convergence: 4245, caret: 4246 }, dbDir: 'data', quick: QUICK });
  rows.push({
    gate: 'D. Tiptap (custom extensions, no Tiptap collab package works with Yjs 14)',
    result: d.pass ? 'PASS' : 'FAIL',
    numbers: d.checks.map((c) => `${c.pass ? 'OK' : 'FAIL'}: ${c.name}`).join('; '),
  });
  if (!d.pass) anyFailure = true;
  console.log(`  -> ${d.pass ? 'PASS' : 'FAIL'}: ${d.detail}\n`);

  // --- Gate E ---
  console.log(`Gate E: attribution (IdMap listing, collision${QUICK ? '' : ', reconnect, reload, restart, size'}) + suggestion mode...`);
  const e = await runGateE({
    ports: { listing: 4247, reconnect: 4248, restart: 4249, sizeWith: 4250, sizeWithout: 4251 },
    dbDir: 'data',
    quick: QUICK,
  });
  rows.push({
    gate: 'E. Attribution (IdMap) + suggestion mode',
    result: e.pass ? 'PASS' : 'FAIL',
    numbers:
      e.checks.map((c) => `${c.pass ? 'OK' : 'FAIL'}: ${c.name}`).join('; ') +
      (QUICK ? '' : `; overhead ${fmtBytes(e.sizeMeasurement.deltaBytes)} (${e.sizeMeasurement.deltaPct.toFixed(1)}%) of ${fmtBytes(e.sizeMeasurement.withoutAttributionBytes)}`) +
      `; suggestion mode: ${e.suggestionMode.checks.map((c) => `${c.pass ? 'OK' : 'FAIL'}: ${c.name}`).join('; ')}`,
  });
  if (!e.pass) anyFailure = true;
  console.log(`  -> ${e.pass ? 'PASS' : 'FAIL'}: ${e.detail}\n`);

  // --- Gate G ---
  console.log(`Gate G: persistence and reconnect (Hocuspocus)${QUICK ? ' (G1 only)' : ' (G1-G4)'}...`);
  const g = await runGateG({ ports: { g1: 4252, g2a: 4253, g2b: 4254, g3: 4255, g4: 4256 }, dbDir: 'data', quick: QUICK });
  rows.push({
    gate: 'G. Persistence and reconnect',
    result: g.pass ? 'PASS' : 'FAIL',
    numbers: g.checks.map((c) => `${c.pass ? 'OK' : 'FAIL'}: ${c.name}`).join('; '),
  });
  if (!g.pass) anyFailure = true;
  console.log(`  -> ${g.pass ? 'PASS' : 'FAIL'}: ${g.detail}\n`);

  for (const gate of ['F']) {
    rows.push({ gate: `${gate}. (later brief)`, result: 'not run', numbers: '-' });
  }
  rows.push({
    gate: 'H. Maturity (Yjs 13/14 compatibility probe)',
    result: 'not run',
    numbers: 'see README / log: separate compat/ subpackage, brief 02 task 6 -- the orchestrator writes the fuller maturity account',
  });

  const header = '| Gate | Result | Numbers |\n|---|---|---|';
  const lines = rows.map((r) => `| ${r.gate} | ${r.result} | ${r.numbers} |`);
  const table = [header, ...lines].join('\n');
  console.log(table);

  const md = [
    '# Stack 14 gate results',
    '',
    `Generated ${new Date().toISOString()}. ${QUICK ? 'Quick run (gate C sampled at 5 files; short D/E/G).' : 'Full run.'}`,
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
    gateA_custom: aCustom,
    gateA_hocuspocus: aHp,
    gateB: b,
    gateC: c,
    gateB3: b3,
    gateD: d,
    gateE: e,
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
