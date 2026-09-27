// Gate-harness helper: spawn/kill the relay (src/relay.ts) as a real child
// process, bound to 127.0.0.1. Every gate and test that needs a relay goes
// through this so "no relay process is left running after any command,
// including a failing one" (charter/brief definition of done) is one place
// to get right: a process-level exit hook plus explicit stop() calls.
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Brief 04, task 1: Hocuspocus 4.7 (src/relay-hocuspocus.ts) is now the
 * primary relay -- the postinstall symlink dedupe (scripts/postinstall-dedupe.mjs)
 * fixes the lib0 major-version crash that made brief 02's attempt (a) fail
 * (see the log and README for the full story). The custom relay from brief
 * 02 (src/relay-custom.ts, the ws/@y/protocols one) is kept as the
 * `relay: 'custom'` alternative, per the brief.
 */
export type RelayFlavor = 'hocuspocus' | 'custom';

function relayEntry(flavor: RelayFlavor): string {
  return path.join(__dirname, flavor === 'custom' ? 'relay-custom.ts' : 'relay-hocuspocus.ts');
}
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
  /** Default 'hocuspocus'. 'custom' spawns src/relay-custom.ts instead (brief 04 task 1's alternative-behind-a-flag). */
  relay?: RelayFlavor;
  /** Hocuspocus only: override the SQLite extension's onStoreDocument debounce (default 2000ms/10000ms). Ignored by the custom relay (which persists synchronously on every update). */
  debounce?: number;
  maxDebounce?: number;
  /** Hocuspocus only, gate E's size measurement: run with attribution recording disabled entirely. */
  noAttribution?: boolean;
}

export function startRelay(opts: StartRelayOptions): Promise<RelayHandle> {
  installExitHook();
  const { port, db, seeds, timeoutMs = 15000, relay = 'hocuspocus' } = opts;
  const args = ['--port', String(port), '--db', db, '--seeds', seeds];
  if (relay === 'hocuspocus') {
    if (opts.debounce !== undefined) args.push('--debounce', String(opts.debounce));
    if (opts.maxDebounce !== undefined) args.push('--maxDebounce', String(opts.maxDebounce));
    if (opts.noAttribution) args.push('--no-attribution');
  }
  return new Promise((resolve, reject) => {
    const proc = spawn(
      process.execPath,
      ['--import', 'tsx/esm', relayEntry(relay), ...args],
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
