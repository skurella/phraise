// Gate-harness helper: spawn/kill the relay (src/relay.ts) as a real child
// process, bound to 127.0.0.1. Every gate and test that needs a relay goes
// through this so "no relay process is left running after any command,
// including a failing one" (charter/brief definition of done) is one place
// to get right: a process-level exit hook plus explicit stop() calls.
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RELAY_ENTRY = path.join(__dirname, 'relay.ts');
// `node --import tsx/esm <file>` runs the file in-process under Node's own
// ESM loader hook. The `tsx` CLI (`node_modules/.bin/tsx`) instead re-execs
// a second Node process internally, which then survives a SIGKILL of the
// first (measured directly: `lsof` still showed the listener after killing
// the CLI's own pid). `--import tsx/esm` has a single process the whole
// way, so a plain `proc.kill()` is enough.

export interface RelayHandle {
  port: number;
  db: string;
  seeds: string;
  proc: ChildProcess;
  baseUrl: string; // http://127.0.0.1:<port>
  wsUrl: string; // ws://127.0.0.1:<port>
  stop(): Promise<void>;
  /** GET /state/<docName> on the relay, returning the raw Yjs update bytes. */
  fetchState(documentName: string): Promise<Uint8Array>;
}

const liveHandles = new Set<RelayHandle>();

function killNow(handle: RelayHandle) {
  if (handle.proc.exitCode === null && handle.proc.signalCode === null) {
    handle.proc.kill('SIGKILL');
  }
}

let exitHookInstalled = false;
function installExitHook() {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  const killAll = () => {
    for (const h of liveHandles) killNow(h);
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
  process.on('uncaughtException', (err) => {
    console.error('[harness] uncaught exception, killing relays', err);
    killAll();
    process.exit(1);
  });
}

export interface StartRelayOptions {
  port: number;
  db: string;
  seeds: string;
  /** Milliseconds to wait for the ready line before giving up. Default 15000. */
  timeoutMs?: number;
  /** Gate G: override Hocuspocus's onStoreDocument debounce (default 2000ms/10000ms) so restart/kill scenarios don't need multi-second real waits. */
  debounce?: number;
  maxDebounce?: number;
  /** Gate E's size measurement only: run this relay with attribution recording disabled entirely. */
  noAttribution?: boolean;
}

export function startRelay(opts: StartRelayOptions): Promise<RelayHandle> {
  installExitHook();
  const { port, db, seeds, timeoutMs = 15000 } = opts;
  const args = ['--port', String(port), '--db', db, '--seeds', seeds];
  if (opts.debounce !== undefined) args.push('--debounce', String(opts.debounce));
  if (opts.maxDebounce !== undefined) args.push('--maxDebounce', String(opts.maxDebounce));
  if (opts.noAttribution) args.push('--no-attribution');
  return new Promise((resolve, reject) => {
    const proc = spawn(
      process.execPath,
      ['--import', 'tsx/esm', RELAY_ENTRY, ...args],
      { stdio: ['ignore', 'pipe', 'pipe'], cwd: path.join(__dirname, '..') },
    );

    let settled = false;
    let stderrBuf = '';
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      killNow(handle);
      reject(new Error(`relay did not become ready within ${timeoutMs}ms; stderr:\n${stderrBuf}`));
    }, timeoutMs);

    const handle: RelayHandle = {
      port,
      db,
      seeds,
      proc,
      baseUrl: `http://127.0.0.1:${port}`,
      wsUrl: `ws://127.0.0.1:${port}`,
      async stop() {
        clearTimeout(timeout);
        liveHandles.delete(handle);
        if (proc.exitCode !== null || proc.signalCode !== null) return;
        await new Promise<void>((res) => {
          proc.once('exit', () => res());
          proc.kill('SIGTERM');
          // Escalate if it doesn't die promptly.
          setTimeout(() => {
            if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGKILL');
          }, 2000);
        });
      },
      async fetchState(documentName: string) {
        const res = await fetch(`${handle.baseUrl}/state/${encodeURIComponent(documentName)}`);
        const buf = await res.arrayBuffer();
        return new Uint8Array(buf);
      },
    };

    proc.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      if (!settled && text.includes('relay-ready')) {
        settled = true;
        clearTimeout(timeout);
        liveHandles.add(handle);
        resolve(handle);
      }
    });
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString('utf8');
    });
    proc.on('exit', (code, signal) => {
      liveHandles.delete(handle);
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(new Error(`relay exited before becoming ready (code=${code} signal=${signal}); stderr:\n${stderrBuf}`));
      }
    });
  });
}

export async function stopRelay(handle: RelayHandle): Promise<void> {
  await handle.stop();
}

/** Kill every relay this process has started, in case a caller forgot. */
export async function stopAllRelays(): Promise<void> {
  await Promise.all([...liveHandles].map((h) => h.stop()));
}
