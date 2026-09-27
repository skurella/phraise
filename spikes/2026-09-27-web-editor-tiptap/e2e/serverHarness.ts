// Brief 01, task 4: starts `server/main.ts` as a real child process on a
// free port between 4400 and 4449 (charter: "Playwright's server fixture
// uses 4400 to 4449"), with a fresh temporary seeds directory and temporary
// SQLite database under `$TMPDIR`, and stops it afterwards -- including on
// test failure (see e2e/fixtures.ts's teardown, which always runs).
//
// Runs the server via `node --import tsx/esm server/main.ts`, not the `tsx`
// CLI binary: the CLI re-execs a second Node process that can survive
// killing the CLI's own pid (the same reason spike 5's src/harness.ts gives
// for the identical choice).
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SPIKE_ROOT = path.resolve(HERE, '..');

export interface PhraiseServer {
  port: number;
  relayPort: number;
  seedsDir: string;
  pageUrl(doc: string, user: string): string;
  stop(): Promise<void>;
}

function randomPortInRange(): number {
  // Charter: ports 4400 to 4499; the plan reserves 4400-4449 for this fixture.
  return 4400 + Math.floor(Math.random() * 50);
}

function waitForReady(proc: ChildProcessByStdio<null, Readable, Readable>, timeoutMs = 20000): Promise<{ port: number; relayPort: number }> {
  return new Promise((resolve, reject) => {
    let out = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`server did not become ready within ${timeoutMs}ms. output so far:\n${out}`));
    }, timeoutMs);

    function onData(chunk: Buffer) {
      out += chunk.toString();
      const m = /server-ready port=(\d+) relay-port=(\d+)/.exec(out);
      if (m && !settled) {
        settled = true;
        clearTimeout(timer);
        proc.stdout.off('data', onData);
        resolve({ port: Number(m[1]), relayPort: Number(m[2]) });
      }
    }
    proc.stdout.on('data', onData);
    proc.stderr.on('data', (chunk: Buffer) => {
      out += chunk.toString();
    });
    proc.once('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`server exited early (code ${code}) before becoming ready. output so far:\n${out}`));
    });
  });
}

async function stopProcess(proc: ChildProcessByStdio<null, Readable, Readable>): Promise<void> {
  if (proc.exitCode !== null || proc.signalCode !== null) return;
  proc.kill('SIGINT');
  await new Promise<void>((resolve) => {
    const escalate = setTimeout(() => {
      if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGKILL');
    }, 5000);
    proc.once('exit', () => {
      clearTimeout(escalate);
      resolve();
    });
  });
}

/**
 * Copy `seedFiles` (relpath -> absolute source path) into a fresh temporary
 * seeds directory under `$TMPDIR`, start `server/main.ts` on a free port in
 * 4400-4449 with a temporary database, and return a handle to talk to it.
 * Retries a few times if the randomly chosen port is already taken.
 */
export async function startServer(seedFiles: Record<string, string>): Promise<PhraiseServer> {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'phraise-web-editor-e2e-'));
  const seedsDir = path.join(tmpRoot, 'seeds');
  fs.mkdirSync(seedsDir, { recursive: true });
  for (const [relpath, srcPath] of Object.entries(seedFiles)) {
    const dest = path.join(seedsDir, relpath);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(srcPath, dest);
  }
  const dbPath = path.join(tmpRoot, 'db.sqlite');

  let lastErr: unknown;
  for (let attempt = 0; attempt < 10; attempt++) {
    const port = randomPortInRange();
    const proc = spawn(
      process.execPath,
      ['--import', 'tsx/esm', path.join(SPIKE_ROOT, 'server', 'main.ts'), '--port', String(port), '--db', dbPath, '--seeds', seedsDir],
      { cwd: SPIKE_ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
    ) as ChildProcessByStdio<null, Readable, Readable>;

    try {
      const ready = await waitForReady(proc);
      return {
        port: ready.port,
        relayPort: ready.relayPort,
        seedsDir,
        pageUrl(doc: string, user: string): string {
          return `http://127.0.0.1:${ready.port}/?doc=${encodeURIComponent(doc)}&user=${encodeURIComponent(user)}`;
        },
        async stop(): Promise<void> {
          await stopProcess(proc);
          fs.rmSync(tmpRoot, { recursive: true, force: true });
        },
      };
    } catch (err) {
      lastErr = err;
      await stopProcess(proc);
    }
  }
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  throw new Error(`could not start server on a free port in 4400-4449 after several attempts: ${String(lastErr)}`);
}
