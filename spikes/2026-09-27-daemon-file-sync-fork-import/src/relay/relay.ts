// Plan section 2 / brief 02 task 1: a Hocuspocus 4 relay bound to 127.0.0.1,
// in memory, `yDocOptions: { gc: false }` (documents this daemon forks from
// need tombstones, same reason DocSync requires `gc: false`), quiet, on a
// port in 4100-4199. No persistence: the relay is purely a message router
// for this spike, the daemon owns durability (plan 4.4).
import { Server } from '@hocuspocus/server';

export const PORT_MIN = 4100;
export const PORT_MAX = 4199;

export interface RelayHandle {
  readonly url: string;
  readonly port: number;
  stop(): Promise<void>;
}

export interface StartRelayOptions {
  /** Bind to this port. Without one, the first free port in 4100-4199 is used. */
  port?: number;
}

function candidatePorts(preferred?: number): number[] {
  if (preferred !== undefined) return [preferred];
  const ports: number[] = [];
  for (let p = PORT_MIN; p <= PORT_MAX; p++) ports.push(p);
  return ports;
}

/**
 * Try to bind `server`'s underlying http server on each candidate port in
 * turn, stopping at the first that succeeds. `Server#listen` resolves via an
 * internal `onListen` hook on success but never rejects on a plain bind
 * error (EADDRINUSE surfaces as an 'error' event on the http server instead
 * and the returned promise would hang forever), so this races the two.
 */
async function listenOnFirstFreePort(server: Server, ports: readonly number[]): Promise<number> {
  let lastError: unknown;
  for (const port of ports) {
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (err: unknown) => {
          server.httpServer.off('error', onError);
          reject(err);
        };
        server.httpServer.once('error', onError);
        server
          .listen(port)
          .then(() => {
            server.httpServer.off('error', onError);
            resolve();
          })
          .catch((err) => {
            server.httpServer.off('error', onError);
            reject(err);
          });
      });
      return port;
    } catch (err: any) {
      lastError = err;
      if (err?.code !== 'EADDRINUSE') throw err;
      // try the next candidate port
    }
  }
  throw lastError ?? new Error(`relay: no free port among ${ports.length} candidates`);
}

/** Start an in-memory Hocuspocus relay on 127.0.0.1. `stop()` leaves nothing listening. */
export async function startRelay(opts: StartRelayOptions = {}): Promise<RelayHandle> {
  const server = new Server({
    address: '127.0.0.1',
    quiet: true,
    stopOnSignals: false,
    yDocOptions: { gc: false, gcFilter: () => false },
  });

  const port = await listenOnFirstFreePort(server, candidatePorts(opts.port));

  let stopped = false;
  return {
    url: `ws://127.0.0.1:${port}`,
    port,
    async stop() {
      if (stopped) return;
      stopped = true;
      await server.destroy();
    },
  };
}
