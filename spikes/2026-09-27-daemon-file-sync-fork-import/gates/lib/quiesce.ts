// Brief 03 task 1: `quiesce()` waits until a daemon (and, when given, its
// counterpart remote client) has genuinely settled, instead of a gate
// sleeping a guessed amount of time. Four conditions, all polled together:
//
//   1. the daemon's queue is empty and no debounce timer is armed (`Daemon#idle`,
//      added for this brief -- see daemon.ts and the log entry for it);
//   2. the watched file's bytes are stable across two checks in a row;
//   3. the daemon's own Y.Doc and the remote client's Y.Doc (when supplied) have
//      equal state vectors -- everything either side did has reached the other;
//   4. (2) and (3) hold not just once but across one more full poll interval, so a
//      condition that flaps (e.g. a debounce timer that just fired and is about to
//      re-arm) isn't mistaken for settled.
import * as fs from 'node:fs';
import * as Y from 'yjs';
import type { Daemon } from '../../src/daemon/daemon.js';
import type { RemoteClient } from '../../src/testkit/remote-client.js';

export interface QuiesceOptions {
  daemon: Daemon;
  filePath: string;
  /** When given, also required: daemon and client state vectors equal. */
  client?: RemoteClient;
  timeoutMs?: number;
  pollMs?: number;
}

function readFileSafe(filePath: string): string | undefined {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (err: any) {
    if (err?.code === 'ENOENT') return undefined;
    throw err;
  }
}

function stateVectorsEqual(a: Y.Doc, b: Y.Doc): boolean {
  const sva = Y.encodeStateVector(a);
  const svb = Y.encodeStateVector(b);
  return Buffer.compare(Buffer.from(sva), Buffer.from(svb)) === 0;
}

function settled(opts: QuiesceOptions, lastText: string | undefined): { ok: boolean; text: string | undefined } {
  const text = readFileSafe(opts.filePath);
  const fileStable = text === lastText;
  const daemonIdle = opts.daemon.idle;
  const docsEqual = opts.client ? stateVectorsEqual(opts.daemon.docSync.doc, opts.client.ydoc) : true;
  return { ok: fileStable && daemonIdle && docsEqual, text };
}

/** Waits for the daemon (and optionally its remote counterpart) to settle. Throws on timeout. */
export async function quiesce(opts: QuiesceOptions): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 10000;
  const pollMs = opts.pollMs ?? 20;
  const deadline = Date.now() + timeoutMs;

  let lastText = readFileSafe(opts.filePath);
  let consecutiveOk = 0;
  // Two consecutive settled polls in a row (condition 4 above) before declaring quiet.
  const NEEDED = 2;

  for (;;) {
    const { ok, text } = settled(opts, lastText);
    lastText = text;
    consecutiveOk = ok ? consecutiveOk + 1 : 0;
    if (consecutiveOk >= NEEDED) return;
    if (Date.now() >= deadline) {
      throw new Error(
        `quiesce: timed out after ${timeoutMs}ms (daemon.idle=${opts.daemon.idle}, ` +
          `file readable=${lastText !== undefined})`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}
