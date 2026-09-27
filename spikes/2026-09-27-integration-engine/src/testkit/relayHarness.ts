// Brief 04 task 1 (last bullet): "src/testkit/relayHarness.ts starts either
// kind [in-process or child-process] and always stops it (`finally`, plus a
// process-exit safety net as spike 5 has)." Child-process mode is ported
// from spike 5 (collab-stack-yjs13-hocuspocus, branch
// spike/2026-09-27-collab-stack, commit eeb3fe2, `src/harness.ts`):
// `--import tsx/esm <file>` runs the CLI in-process under Node's own ESM
// loader hook, in a single process the whole way, so a plain
// `proc.kill('SIGKILL')` is enough (unlike the `tsx` CLI binary, which
// re-execs a second Node process that can survive a `SIGKILL` of the
// first -- spike 5's own finding, confirmed there with `lsof`).
import { spawn, type ChildProcess } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startRelay, type RelayOptions, type RelayHandle, type RelayState } from '../relay/index.js';
import { allocatePort } from './ports.js';
import { makeTempDir } from './tmp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_ENTRY = path.join(__dirname, '../relay/cli.ts');
const PACKAGE_ROOT = path.join(__dirname, '../..');

export interface RelayHarnessOptions {
  /** Default `'in-process'`: cheaper and gives tests direct access to `.state` for counters/branch bookkeeping. `'child-process'` is needed for anything that measures memory or must survive/observe a hard kill (spike 5's own reasoning, unchanged here). */
  mode?: 'in-process' | 'child-process';
  port?: number;
  dataDir?: string;
  remote: string;
  timings?: RelayOptions['timings'];
  /** child-process only: ms to wait for the ready line. Default 15000. */
  readyTimeoutMs?: number;
  /** In-process mode only: test-only hooks (`RelayOptions['testHooks']`), e.g. brief 09 defect 1's `afterPrepareCommit`. Never set outside tests. */
  testHooks?: RelayOptions['testHooks'];
}

export interface RelayHarnessHandle {
  mode: 'in-process' | 'child-process';
  port: number;
  baseUrl: string;
  wsUrl: string;
  dataDir: string;
  /** In-process only: direct access to the relay's own state (counters, branch bookkeeping) without going through HTTP. `undefined` for a child-process relay. */
  state?: RelayState;
  stop(): Promise<void>;
}

const liveHandles = new Set<{ kill(): void }>();
let exitHookInstalled = false;

function installExitHook(): void {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  const killAll = () => {
    for (const h of liveHandles) h.kill();
  };
  process.on('exit', killAll);
  process.on('SIGINT', () => {
    killAll();
    process.exit(1);
  });
  process.on('SIGTERM', () => {
    killAll();
    process.exit(1);
  });
}

async function startInProcess(opts: RelayHarnessOptions, port: number, dataDir: string): Promise<RelayHarnessHandle> {
  const handle: RelayHandle = await startRelay({ port, dataDir, remote: opts.remote, timings: opts.timings, testHooks: opts.testHooks });
  const entry = { kill: () => void handle.stop() };
  liveHandles.add(entry);
  return {
    mode: 'in-process',
    port: handle.port,
    baseUrl: handle.baseUrl,
    wsUrl: handle.wsUrl,
    dataDir,
    state: handle.state,
    async stop() {
      liveHandles.delete(entry);
      await handle.stop();
    },
  };
}

function startChildProcess(opts: RelayHarnessOptions, port: number, dataDir: string): Promise<RelayHarnessHandle> {
  const timeoutMs = opts.readyTimeoutMs ?? 15000;
  const args = ['--port', String(port), '--dataDir', dataDir, '--remote', opts.remote];
  if (opts.timings?.flushDebounceMs !== undefined) args.push('--flushDebounceMs', String(opts.timings.flushDebounceMs));
  if (opts.timings?.flushMaxIntervalMs !== undefined) args.push('--flushMaxIntervalMs', String(opts.timings.flushMaxIntervalMs));
  if (opts.timings?.pollMs !== undefined) args.push('--pollMs', String(opts.timings.pollMs));
  if (opts.timings?.recoveryWindowMs !== undefined) args.push('--recoveryWindowMs', String(opts.timings.recoveryWindowMs));

  return new Promise((resolve, reject) => {
    const proc: ChildProcess = spawn(process.execPath, ['--import', 'tsx/esm', CLI_ENTRY, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: PACKAGE_ROOT,
    });

    let settled = false;
    let stderrBuf = '';
    const entry = {
      kill: () => {
        if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGKILL');
      },
    };

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      entry.kill();
      reject(new Error(`relay child process did not become ready within ${timeoutMs}ms; stderr:\n${stderrBuf}`));
    }, timeoutMs);

    const handle: RelayHarnessHandle = {
      mode: 'child-process',
      port,
      baseUrl: `http://127.0.0.1:${port}`,
      wsUrl: `ws://127.0.0.1:${port}`,
      dataDir,
      async stop() {
        clearTimeout(timeout);
        liveHandles.delete(entry);
        if (proc.exitCode !== null || proc.signalCode !== null) return;
        await new Promise<void>((res) => {
          proc.once('exit', () => res());
          proc.kill('SIGTERM');
          setTimeout(() => {
            if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGKILL');
          }, 2000);
        });
      },
    };

    proc.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      if (!settled && text.includes('relay-ready')) {
        settled = true;
        clearTimeout(timeout);
        liveHandles.add(entry);
        resolve(handle);
      }
    });
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString('utf8');
    });
    proc.on('exit', (code, signal) => {
      liveHandles.delete(entry);
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(new Error(`relay child process exited before becoming ready (code=${code} signal=${signal}); stderr:\n${stderrBuf}`));
      }
    });
  });
}

/** Starts a relay (in-process by default) on a free port in [4300, 4399]. Callers must `stop()` it (typically in a `finally`); a process-exit safety net kills any relay left running if the process ends without doing so, as spike 5's harness does. */
export async function startRelayHarness(opts: RelayHarnessOptions): Promise<RelayHarnessHandle> {
  installExitHook();
  const port = opts.port ?? (await allocatePort());
  const dataDir = opts.dataDir ?? (await makeTempDir('phraise-relay-')).path;
  return opts.mode === 'child-process' ? startChildProcess(opts, port, dataDir) : startInProcess(opts, port, dataDir);
}
