// Brief 04 task 8 (gates A-E); brief 06 task 7 adds F and G. The gate
// runner: runs every registered gate, prints a results table, writes
// `results/gates.md`/`results/gates.json`, exits non-zero on any failure,
// and checks at the end that nothing is still listening on 4300-4399
// (charter/plan section 9).
import { mkdir, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isPortFree, PORT_RANGE_START, PORT_RANGE_END } from '../src/testkit/ports.js';
import { run as runA } from './a.js';
import { run as runB } from './b.js';
import { run as runC } from './c.js';
import { run as runD } from './d.js';
import { run as runE } from './e.js';
import { run as runF } from './f.js';
import { run as runG } from './g.js';

export interface GateResult {
  gate: string;
  pass: boolean;
  summary: string;
  numbers?: Record<string, unknown>;
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SPIKE_DIR = path.resolve(HERE, '..');
const RESULTS_DIR = path.join(SPIKE_DIR, 'results');

const GATES: { letter: string; run: (opts: { quick?: boolean }) => Promise<GateResult> }[] = [
  { letter: 'A', run: runA },
  { letter: 'B', run: runB },
  { letter: 'C', run: runC },
  { letter: 'D', run: runD },
  { letter: 'E', run: runE },
  { letter: 'F', run: runF },
  { letter: 'G', run: runG },
];

async function checkPortsFree(): Promise<string[]> {
  const stillListening: number[] = [];
  for (let p = PORT_RANGE_START; p <= PORT_RANGE_END; p++) {
    if (!(await isPortFree(p))) stillListening.push(p);
  }
  return stillListening.map(String);
}

async function main(): Promise<void> {
  const quick = process.argv.includes('--quick');
  const results: GateResult[] = [];

  for (const g of GATES) {
    const start = Date.now();
    try {
      const r = await g.run({ quick });
      results.push(r);
    } catch (err) {
      results.push({ gate: g.letter, pass: false, summary: `threw: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}` });
    }
    console.log(`  ${results[results.length - 1].pass ? 'PASS' : 'FAIL'}  gate ${g.letter}  (${((Date.now() - start) / 1000).toFixed(1)}s)  ${results[results.length - 1].summary}`);
  }

  console.log(`\nGates (${quick ? 'quick' : 'full'}):`);
  for (const r of results) {
    console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.gate}  ${JSON.stringify(r.numbers ?? {})}`);
  }

  const leaked = await checkPortsFree();
  if (leaked.length > 0) {
    console.error(`\nPorts still listening after the run (leaked): ${leaked.join(', ')}`);
  } else {
    console.log('\nNo ports still listening in 4300-4399.');
  }

  await mkdir(RESULTS_DIR, { recursive: true });
  const md = [
    `# Gate results (${quick ? 'quick' : 'full'})`,
    '',
    '| Gate | Result | Summary |',
    '|---|---|---|',
    ...results.map((r) => `| ${r.gate} | ${r.pass ? 'PASS' : 'FAIL'} | ${r.summary.replace(/\|/g, '\\|')} |`),
    '',
    `Ports still listening in 4300-4399 after the run: ${leaked.length === 0 ? 'none' : leaked.join(', ')}`,
  ].join('\n');
  await writeFile(path.join(RESULTS_DIR, 'gates.md'), md + '\n', 'utf8');
  await writeFile(path.join(RESULTS_DIR, 'gates.json'), JSON.stringify({ results, portsLeaked: leaked }, null, 2) + '\n', 'utf8');

  const anyFailed = results.some((r) => !r.pass) || leaked.length > 0;
  process.exit(anyFailed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
