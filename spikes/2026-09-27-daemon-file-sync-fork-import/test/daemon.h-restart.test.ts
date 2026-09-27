// Gate H: restart. Stop, edit both sides, restart: merged from the
// persisted base. Stop, delete the state directory, edit the file, restart:
// conflict copy beside the file, file untouched, detach event. CLI variant:
// spawn the CLI, SIGKILL it, edit both sides, respawn: merged.
import { afterEach, beforeEach, expect, test } from 'vitest';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
import { setupFixture, type Fixture } from './daemon-helpers.js';
import { waitFor } from '../src/testkit/wait-for.js';
import { makeToken } from '../src/testkit/tokens.js';

const CONTENT = '# Corpus doc\n\nParagraph one is here.\n\nParagraph two is here.\n\nParagraph three is here.\n';

const SPIKE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TSX_BIN = path.join(SPIKE_ROOT, 'node_modules', '.bin', 'tsx');
const CLI_PATH = path.join(SPIKE_ROOT, 'src', 'daemon', 'cli.ts');

let fx: Fixture;

beforeEach(async () => {
  fx = await setupFixture({ content: CONTENT });
});

afterEach(async () => {
  await fx.cleanup();
});

test('gate H: stop, edit both sides, restart: merged', async () => {
  const daemon1 = fx.makeDaemon();
  await daemon1.start();
  const client = fx.makeClient();
  await client.synced();

  await daemon1.stop({ persist: true });

  // Edit both sides while the daemon is stopped.
  const remoteToken = makeToken('remoteH1');
  client.editor.replaceWord(1, 0, remoteToken);

  const localToken = makeToken('localH1');
  const onDiskBefore = readFileSync(fx.repo.file, 'utf8');
  writeFileSync(fx.repo.file, onDiskBefore.replace('Paragraph one', `${localToken} Paragraph one`), 'utf8');

  // A fresh Daemon instance simulates a real process restart: no in-memory state
  // survives except what was persisted to `stateDir` and the relay's own live doc.
  const daemon2 = fx.makeDaemon();
  await daemon2.start();

  await waitFor(() => {
    const onDisk = readFileSync(fx.repo.file, 'utf8');
    return onDisk.includes(remoteToken) && onDisk.includes(localToken);
  }, 5000);

  const finalDisk = readFileSync(fx.repo.file, 'utf8');
  expect(finalDisk).toBe(daemon2.docSync.render());

  await daemon2.stop();
});

test('gate H: stop, delete the state directory, edit the file, restart: conflict copy beside the file, file untouched, detach', async () => {
  const daemon1 = fx.makeDaemon();
  await daemon1.start();
  const client = fx.makeClient();
  await client.synced();

  // Give the CRDT some content the file doesn't have, so a conflict is observable.
  const remoteToken = makeToken('remoteH2');
  client.editor.replaceWord(0, 0, remoteToken);
  await waitFor(() => readFileSync(fx.repo.file, 'utf8').includes(remoteToken), 5000);

  const stateDir = path.join(fx.repo.repoDir, '.git', 'phraise', 'daemon', fx.docName);
  await daemon1.stop({ persist: true });
  expect(existsSync(stateDir)).toBe(true);
  rmSync(stateDir, { recursive: true, force: true });

  const editedContent = readFileSync(fx.repo.file, 'utf8').replace(
    'Paragraph two',
    'Paragraph two LOCAL-EDIT-AFTER-STATE-DELETE',
  );
  writeFileSync(fx.repo.file, editedContent, 'utf8');

  const daemon2 = fx.makeDaemon();
  const detaches: any[] = [];
  const conflicts: any[] = [];
  daemon2.on('detach', (e) => detaches.push(e));
  daemon2.on('conflict', (e) => conflicts.push(e));
  await daemon2.start();

  expect(conflicts.length).toBeGreaterThan(0);
  expect(detaches.length).toBeGreaterThan(0);
  expect(daemon2.status().detached).toBe(true);

  // The file itself is left completely untouched.
  expect(readFileSync(fx.repo.file, 'utf8')).toBe(editedContent);

  // A conflict copy exists beside the file, containing the CRDT's render.
  const dir = path.dirname(fx.repo.file);
  const conflictFiles = readdirSync(dir).filter((n) => n.includes('.phraise-conflict-'));
  expect(conflictFiles.length).toBe(1);
  const conflictContent = readFileSync(path.join(dir, conflictFiles[0]), 'utf8');
  expect(conflictContent).toContain(remoteToken);

  await daemon2.stop({ persist: false });
});

function spawnDaemonCli(fx: Fixture, userName: string): ChildProcessByStdio<null, Readable, Readable> {
  const proc = spawn(
    TSX_BIN,
    [CLI_PATH, '--relay', fx.relay.url, '--repo', fx.repo.repoDir, '--file', fx.repo.file, '--doc', fx.docName, '--user', userName],
    { cwd: SPIKE_ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  proc.stderr.on('data', (chunk) => process.stderr.write(`[cli stderr] ${chunk}`));
  return proc;
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
          // not a JSON event line; ignore
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

test('gate H CLI variant: spawn the CLI, SIGKILL it, edit both sides, respawn: merged', async () => {
  const cli1 = spawnDaemonCli(fx, 'cli-user');
  let cli2: ChildProcessByStdio<null, Readable, Readable> | undefined;
  try {
    await waitForCliEvent(cli1, 'started');

    const client = fx.makeClient();
    try {
      await client.synced();

      cli1.kill('SIGKILL');
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
    } finally {
      client.destroy();
    }
  } finally {
    if (cli1.exitCode === null && cli1.signalCode === null) cli1.kill('SIGKILL');
    if (cli2 && cli2.exitCode === null && cli2.signalCode === null) {
      cli2.kill('SIGTERM');
      await waitForExit(cli2);
    }
  }
}, 20000);
