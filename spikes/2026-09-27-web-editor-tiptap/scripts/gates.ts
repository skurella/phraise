#!/usr/bin/env npx tsx
// Brief 07: `npm run gates` builds, runs every Playwright project
// (chromium, and firefox/webkit for gates A-D -- see playwright.config.ts),
// prints both of `gateReporter.ts`'s tables, and exits non-zero if any
// CHROMIUM gate failed -- "the reporter prints a second table,
// cross-browser results by gate and browser, marked informational; the
// gate verdict and the exit code stay on Chromium" (the brief's own
// words). Playwright's OWN process exit code reflects EVERY project's
// test results, including a browser that can't even launch on this
// machine (confirmed: Firefox does not launch here at all -- see the
// builder log) -- which would make `npm run gates` fail for a reason
// that has nothing to do with Chromium. So this script ignores
// Playwright's raw exit code and instead reads `results/gates.json`
// (`gateReporter.ts`'s own Chromium-only `gates` array) to decide the
// final exit code itself.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SPIKE_ROOT = path.resolve(HERE, '..');

function run(command: string, args: string[]): number {
  const result = spawnSync(command, args, {
    cwd: SPIKE_ROOT,
    stdio: 'inherit',
    env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: path.join(SPIKE_ROOT, '.pw-browsers') },
  });
  return result.status ?? 1;
}

interface GateRow {
  gate: string;
  passed: number;
  failed: number;
  skipped: number;
  status: 'PASS' | 'FAIL' | 'not run';
}
interface GatesReport {
  overallStatus: string;
  gates: GateRow[];
}

function main(): void {
  const buildStatus = run('npx', ['vite', 'build']);
  if (buildStatus !== 0) {
    console.error('[gates] build failed');
    process.exit(buildStatus);
  }

  // Playwright's own exit code is intentionally NOT used below -- see this
  // file's header comment.
  const gatesJsonPath = path.join(SPIKE_ROOT, 'results', 'gates.json');
  // Never judge a run by a previous run's results.
  fs.rmSync(gatesJsonPath, { force: true });
  run('npx', ['playwright', 'test']);

  if (!fs.existsSync(gatesJsonPath)) {
    console.error('[gates] results/gates.json was not written -- the test run likely crashed before completing.');
    process.exit(1);
  }
  const report = JSON.parse(fs.readFileSync(gatesJsonPath, 'utf8')) as GatesReport;
  // A gate with no tests is a failure of the gate command too: every gate A to K must run.
  const failedGates = report.gates.filter((g) => g.status !== 'PASS').map((g) => `${g.gate} (${g.status})`);
  if (failedGates.length > 0) {
    console.error(`[gates] Chromium gate(s) failed: ${failedGates.join(', ')}`);
    process.exit(1);
  }
  console.log('[gates] every Chromium gate A to K ran and passed.');
  process.exit(0);
}

main();
