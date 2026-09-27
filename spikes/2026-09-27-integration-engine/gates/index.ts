// Placeholder gate runner (brief 01 task 1). Real gates (a.ts .. m.ts, plan
// section 9) are added by later briefs, one per gate, each exporting
// `run({quick}) -> GateResult`. This prints an empty results table and
// writes empty results/gates.md and results/gates.json, and exits 0, so
// `npm run gates`/`gates:quick` are wired up from the start.
import { mkdir, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface GateResult {
  gate: string;
  pass: boolean;
  summary: string;
  numbers?: Record<string, unknown>;
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SPIKE_DIR = path.resolve(HERE, '..');
const RESULTS_DIR = path.join(SPIKE_DIR, 'results');

async function main(): Promise<void> {
  const quick = process.argv.includes('--quick');
  // No gates registered yet: brief 02 onward adds one import + one push per
  // gate letter here as gates/<letter>.ts land.
  const results: GateResult[] = [];

  console.log(`Gates (${quick ? 'quick' : 'full'}):`);
  if (results.length === 0) {
    console.log('  (none registered yet)');
  }
  for (const r of results) {
    console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.gate}  ${r.summary}`);
  }

  await mkdir(RESULTS_DIR, { recursive: true });
  const md = [
    `# Gate results (${quick ? 'quick' : 'full'})`,
    '',
    '| Gate | Result | Summary |',
    '|---|---|---|',
    ...results.map((r) => `| ${r.gate} | ${r.pass ? 'PASS' : 'FAIL'} | ${r.summary} |`),
  ].join('\n');
  await writeFile(path.join(RESULTS_DIR, 'gates.md'), md + '\n', 'utf8');
  await writeFile(path.join(RESULTS_DIR, 'gates.json'), JSON.stringify(results, null, 2) + '\n', 'utf8');

  const anyFailed = results.some((r) => !r.pass);
  process.exit(anyFailed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
