// Gate H (plan section 6): restart. Reuses the scenarios
// `test/daemon.h-restart.test.ts` and `test/daemon.h-restart-then-save.test.ts`
// already script (brief 03: "reuse their scenarios for gates D, G, H").
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
import { setupFixture, type Fixture } from './lib/fixture.js';
import { waitFor } from '../src/testkit/wait-for.js';
import { makeToken } from '../src/testkit/tokens.js';
import { serializeDoc, yDocToDoc } from '../src/md/index.js';
import type { GateOpts, GateResult } from './lib/types.js';

const CONTENT = '# Corpus doc\n\nParagraph one is here.\n\nParagraph two is here.\n\nParagraph three is here.\n';
const SPIKE_ROOT = path.resolve(import.meta.dirname, '..');
const TSX_BIN = path.join(SPIKE_ROOT, 'node_modules', '.bin', 'tsx');
const CLI_PATH = path.join(SPIKE_ROOT, 'src', 'daemon', 'cli.ts');

async function caseMergeFromPersistedBase(fx: Fixture): Promise<string[]> {
  const failures: string[] = [];
  const daemon1 = fx.makeDaemon();
  await daemon1.start();
  const client = fx.makeClient();
  await client.synced();
  await daemon1.stop({ persist: true });

  const remoteToken = makeToken('remoteH1');
  client.editor.replaceWord(1, 0, remoteToken);
  const localToken = makeToken('localH1');
  const onDiskBefore = readFileSync(fx.repo.file, 'utf8');
  writeFileSync(fx.repo.file, onDiskBefore.replace('Paragraph one', `${localToken} Paragraph one`), 'utf8');

  const daemon2 = fx.makeDaemon();
  await daemon2.start();
  try {
    await waitFor(() => {
      const onDisk = readFileSync(fx.repo.file, 'utf8');
      return onDisk.includes(remoteToken) && onDisk.includes(localToken);
    }, 5000);
  } catch (err) {
    failures.push(`merge-from-persisted-base: tokens never merged: ${String((err as Error)?.message ?? err)}`);
  }
  const finalDisk = readFileSync(fx.repo.file, 'utf8');
  if (finalDisk !== daemon2.docSync.render()) failures.push('merge-from-persisted-base: file does not equal render');
  await daemon2.stop();
  return failures;
}

async function caseConflictOnDeletedState(fx: Fixture): Promise<string[]> {
  const failures: string[] = [];
  const daemon1 = fx.makeDaemon();
  await daemon1.start();
  const client = fx.makeClient();
  await client.synced();

  const remoteToken = makeToken('remoteH2');
  client.editor.replaceWord(0, 0, remoteToken);
  await waitFor(() => readFileSync(fx.repo.file, 'utf8').includes(remoteToken), 5000);

  const stateDir = path.join(fx.repo.repoDir, '.git', 'phraise', 'daemon', fx.docName);
  await daemon1.stop({ persist: true });
  if (!existsSync(stateDir)) failures.push('conflict-on-deleted-state: state dir was never persisted');
  rmSync(stateDir, { recursive: true, force: true });

  const editedContent = readFileSync(fx.repo.file, 'utf8').replace('Paragraph two', 'Paragraph two LOCAL-EDIT-AFTER-STATE-DELETE');
  writeFileSync(fx.repo.file, editedContent, 'utf8');

  const daemon2 = fx.makeDaemon();
  const detaches: any[] = [];
  const conflicts: any[] = [];
  daemon2.on('detach', (e) => detaches.push(e));
  daemon2.on('conflict', (e) => conflicts.push(e));
  await daemon2.start();

  if (conflicts.length === 0) failures.push('conflict-on-deleted-state: no conflict event');
  if (detaches.length === 0) failures.push('conflict-on-deleted-state: no detach event');
  if (!daemon2.status().detached) failures.push('conflict-on-deleted-state: daemon not marked detached');
  if (readFileSync(fx.repo.file, 'utf8') !== editedContent) failures.push('conflict-on-deleted-state: file was overwritten');

  const dir = path.dirname(fx.repo.file);
  const conflictFiles = readdirSync(dir).filter((n) => n.includes('.phraise-conflict-'));
  if (conflictFiles.length !== 1) failures.push(`conflict-on-deleted-state: expected 1 conflict file, found ${conflictFiles.length}`);
  else {
    const conflictContent = readFileSync(path.join(dir, conflictFiles[0]), 'utf8');
    if (!conflictContent.includes(remoteToken)) failures.push('conflict-on-deleted-state: conflict copy missing remote content');
  }

  await daemon2.stop({ persist: false });
  return failures;
}

async function caseRestartNoChangesThenSave(fx: Fixture): Promise<string[]> {
  const failures: string[] = [];
  const daemon1 = fx.makeDaemon();
  await daemon1.start();
  await daemon1.stop({ persist: true });

  const daemon2 = fx.makeDaemon();
  const errors: string[] = [];
  daemon2.on('error', (e: { message: string }) => errors.push(e.message));
  await daemon2.start();

  const client = fx.makeClient();
  await client.synced();

  const token = makeToken('afterRestart');
  writeFileSync(fx.repo.file, readFileSync(fx.repo.file, 'utf8').replace('Paragraph two', `${token} Paragraph two`));
  try {
    await waitFor(() => serializeDoc(yDocToDoc(client.ydoc)).includes(token), 5000);
  } catch (err) {
    failures.push(`restart-no-changes-then-save: save after restart never reached remote: ${String((err as Error)?.message ?? err)}`);
  }
  if (errors.length > 0) failures.push(`restart-no-changes-then-save: daemon emitted error(s): ${errors.join('; ')}`);
  await daemon2.stop();
  return failures;
}

function spawnDaemonCli(fx: Fixture, userName: string): ChildProcessByStdio<null, Readable, Readable> {
  const proc = spawn(
    TSX_BIN,
    [CLI_PATH, '--relay', fx.relay.url, '--repo', fx.repo.repoDir, '--file', fx.repo.file, '--doc', fx.docName, '--user', userName],
    // `detached: true` makes this process the leader of its own process group (its pid
    // becomes its pgid); `TSX_BIN` (node_modules/.bin/tsx) is itself a wrapper that spawns
    // a SEPARATE node process (with the actual `--require`/`--import` loader flags) to run
    // `cli.ts` -- confirmed by inspection, that grandchild is a distinct pid, not this
    // process re-exec'd. A plain `SIGTERM` to the wrapper is forwarded to that grandchild by
    // tsx itself, so it dies too, but `SIGKILL` gives the wrapper no chance to forward
    // anything: the kernel kills it instantly, and the grandchild -- the actual daemon
    // process gate H's "crash" case exists to kill -- is orphaned. `killTree` below signals
    // the whole group (`-pid`) instead of just this one process, which reaches the
    // grandchild too regardless of which signal is used.
    { cwd: SPIKE_ROOT, stdio: ['ignore', 'pipe', 'pipe'], detached: true },
  );
  return proc;
}

/** Signals `proc`'s whole process group (see `spawnDaemonCli`), not just `proc` itself, so a `tsx` wrapper's grandchild can't be orphaned by a signal (`SIGKILL` above all) that the wrapper has no chance to forward. */
function killTree(proc: ChildProcessByStdio<null, Readable, Readable>, signal: NodeJS.Signals): void {
  if (proc.exitCode !== null || proc.signalCode !== null) return;
  if (proc.pid === undefined) return;
  try {
    process.kill(-proc.pid, signal);
  } catch {
    try {
      proc.kill(signal);
    } catch {
      // already gone
    }
  }
}

function waitForCliEvent(proc: ChildProcessByStdio<null, Readable, Readable>, eventName: string, timeoutMs = 15000): Promise<any> {
  return new Promise((resolve, reject) => {
    let buf = '';
    const cleanup = () => {
      clearTimeout(timer);
      proc.stdout.off('data', onData);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`waitForCliEvent(${eventName}): timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    const onData = (chunk: Buffer) => {
      buf += chunk.toString('utf8');
      let idx: number;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line);
          if (obj.event === eventName) {
            cleanup();
            resolve(obj);
            return;
          }
        } catch {
          // not a JSON event line
        }
      }
    };
    proc.stdout.on('data', onData);
  });
}

async function waitForExit(proc: ChildProcessByStdio<null, Readable, Readable>): Promise<void> {
  if (proc.exitCode !== null || proc.signalCode !== null) return;
  await new Promise<void>((resolve) => proc.once('exit', () => resolve()));
}

async function caseCliSigkill(fx: Fixture): Promise<string[]> {
  const failures: string[] = [];
  const cli1 = spawnDaemonCli(fx, 'cli-user');
  let cli2: ChildProcessByStdio<null, Readable, Readable> | undefined;
  let client: ReturnType<Fixture['makeClient']> | undefined;
  try {
    await waitForCliEvent(cli1, 'started');
    client = fx.makeClient();
    await client.synced();

    killTree(cli1, 'SIGKILL');
    await waitForExit(cli1);

    const remoteToken = makeToken('remoteHcli');
    client.editor.replaceWord(1, 0, remoteToken);

    const localToken = makeToken('localHcli');
    const before = readFileSync(fx.repo.file, 'utf8');
    writeFileSync(fx.repo.file, before.replace('Paragraph one', `${localToken} Paragraph one`), 'utf8');

    cli2 = spawnDaemonCli(fx, 'cli-user');
    await waitForCliEvent(cli2, 'started');

    await waitFor(() => {
      const onDisk = readFileSync(fx.repo.file, 'utf8');
      return onDisk.includes(remoteToken) && onDisk.includes(localToken);
    }, 8000);
  } catch (err) {
    failures.push(`cli-sigkill: ${String((err as Error)?.message ?? err)}`);
  } finally {
    client?.destroy();
    killTree(cli1, 'SIGKILL');
    if (cli2) {
      killTree(cli2, 'SIGTERM');
      await waitForExit(cli2);
    }
  }
  return failures;
}

const CASES: Array<{ name: string; fn: (fx: Fixture) => Promise<string[]> }> = [
  { name: 'merge-from-persisted-base', fn: caseMergeFromPersistedBase },
  { name: 'conflict-on-deleted-state', fn: caseConflictOnDeletedState },
  { name: 'restart-no-changes-then-save', fn: caseRestartNoChangesThenSave },
  { name: 'cli-sigkill', fn: caseCliSigkill },
];

export async function runGateH(_opts: GateOpts = {}): Promise<GateResult> {
  const failures: string[] = [];
  let passed = 0;
  for (const c of CASES) {
    const fx = await setupFixture({ content: CONTENT });
    try {
      const caseFailures = await c.fn(fx);
      if (caseFailures.length === 0) passed++;
      else failures.push(...caseFailures.map((f) => `${c.name}: ${f}`));
    } catch (err) {
      failures.push(`${c.name}: threw ${String((err as Error)?.message ?? err)}`);
    } finally {
      await fx.cleanup();
    }
  }
  return {
    gate: 'H',
    requirement: 'Restart merges from a persisted base; missing state yields a conflict copy, nothing overwritten.',
    pass: passed === CASES.length,
    numbers: { cases: CASES.length, passed },
    failures,
  };
}
