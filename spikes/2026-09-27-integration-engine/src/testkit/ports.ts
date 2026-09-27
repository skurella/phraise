// New for this spike (no equivalent file existed in the four source
// spikes' testkits under this name). Charter/plan section 9: ports 4300 to
// 4399, bound to 127.0.0.1 only.
import * as net from 'node:net';

export const PORT_RANGE_START = 4300;
export const PORT_RANGE_END = 4399; // inclusive

function checkFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => {
      srv.close(() => resolve(true));
    });
    srv.listen(port, '127.0.0.1');
  });
}

/**
 * Allocate a free TCP port on 127.0.0.1 in [4300, 4399]. Tries ports in
 * random order (so concurrent test files racing this function don't all
 * probe the same port first) and returns the first one that binds free.
 */
export async function allocatePort(): Promise<number> {
  const ports: number[] = [];
  for (let p = PORT_RANGE_START; p <= PORT_RANGE_END; p++) ports.push(p);
  // Fisher-Yates shuffle.
  for (let i = ports.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [ports[i], ports[j]] = [ports[j], ports[i]];
  }
  for (const port of ports) {
    if (await checkFree(port)) return port;
  }
  throw new Error(`allocatePort: no free port in [${PORT_RANGE_START}, ${PORT_RANGE_END}]`);
}

/** True if nothing is listening on `port` on 127.0.0.1 (used by the gate runner's end-of-run check). */
export async function isPortFree(port: number): Promise<boolean> {
  return checkFree(port);
}
