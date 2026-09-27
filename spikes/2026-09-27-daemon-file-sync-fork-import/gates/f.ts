// Gate F (plan section 6): core round-trip numbers (`gates/f-roundtrip.ts`,
// run as a child process here so its own report file gets (re)written) plus
// the daemon-level "no re-fighting the editor" check: after an imported
// save, no `export` event that actually wrote bytes lands within 500ms
// unless a remote edit happened in that window (reusing
// `test/daemon.f-no-refight.test.ts`'s two scenarios).
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { setupFixture, type Fixture } from './lib/fixture.js';
import { saveInPlace } from '../src/testkit/save-styles.js';
import { waitFor } from '../src/testkit/wait-for.js';
import type { GateOpts, GateResult } from './lib/types.js';

const CONTENT = '# Corpus doc\n\nParagraph one is here.\n\nParagraph two is here.\n\nParagraph three is here.\n';
const SPIKE_ROOT = path.resolve(import.meta.dirname, '..');
const TSX_BIN = path.join(SPIKE_ROOT, 'node_modules', '.bin', 'tsx');
const F_ROUNDTRIP = path.join(SPIKE_ROOT, 'gates', 'f-roundtrip.ts');
const RESULTS_JSON = path.join(SPIKE_ROOT, 'results', 'f-roundtrip.json');

async function runFRoundtrip(quick: boolean): Promise<{ exitCode: number | null }> {
  return new Promise((resolve) => {
    const args = quick ? [F_ROUNDTRIP, '--quick'] : [F_ROUNDTRIP];
    const proc = spawn(TSX_BIN, args, { cwd: SPIKE_ROOT, stdio: 'inherit' });
    proc.on('exit', (code) => resolve({ exitCode: code }));
  });
}

async function expectNoRefight(fx: Fixture, savedText: string, failures: string[], label: string): Promise<void> {
  const daemon = fx.makeDaemon();
  await daemon.start();
  let sawWritingExport = false;
  daemon.on('export', () => {
    sawWritingExport = true;
  });
  await saveInPlace(fx.repo.file, savedText);
  try {
    await waitFor(() => readFileSync(fx.repo.file, 'utf8') === savedText, 5000);
    await new Promise((r) => setTimeout(r, 500));
  } catch (err) {
    failures.push(`${label}: save never landed: ${String((err as Error)?.message ?? err)}`);
  }
  if (sawWritingExport) failures.push(`${label}: daemon re-wrote the file after an imported save with no remote edit`);
  if (readFileSync(fx.repo.file, 'utf8') !== savedText) failures.push(`${label}: file bytes changed from what was saved`);
  await daemon.stop();
}

export async function runGateF(opts: GateOpts = {}): Promise<GateResult> {
  const failures: string[] = [];

  const { exitCode } = await runFRoundtrip(opts.quick ?? false);
  let core: any = undefined;
  try {
    core = JSON.parse(readFileSync(RESULTS_JSON, 'utf8'));
  } catch (err) {
    failures.push(`f-roundtrip.json unreadable: ${String((err as Error)?.message ?? err)}`);
  }
  if (core && core.failureCount > 0) {
    failures.push(`gates/f-roundtrip.ts: ${core.failureCount} core round-trip failures (see results/f-roundtrip.json)`);
  }
  if (exitCode !== 0 && !(core && core.failureCount > 0)) {
    failures.push(`gates/f-roundtrip.ts exited with code ${exitCode}`);
  }

  const fx1 = await setupFixture({ content: CONTENT });
  try {
    const original = readFileSync(fx1.repo.file, 'utf8');
    const saved = original.replace('Paragraph two', 'Paragraph TWO-edited');
    await expectNoRefight(fx1, saved, failures, 'no-refight-plain-edit');
  } finally {
    await fx1.cleanup();
  }

  const fx2 = await setupFixture({ content: CONTENT });
  try {
    const original = readFileSync(fx2.repo.file, 'utf8');
    const halfTyped = `${original}\n\`\`\`js\nfunction f() {\n  return 1;\n`;
    await expectNoRefight(fx2, halfTyped, failures, 'no-refight-half-typed-fence');
  } finally {
    await fx2.cleanup();
  }

  return {
    gate: 'F',
    requirement: 'Imported save reproduces saved bytes exactly (core); daemon does not re-fight the editor.',
    pass: failures.length === 0,
    numbers: core
      ? {
          corpusFiles: core.corpusFiles,
          passRate: core.passRate,
          coarseTextblocks: core.coarseTotal,
          repairs: core.repairTotal,
          forks: core.forkTotal,
          coreFailures: core.failureCount,
        }
      : {},
    failures,
  };
}
