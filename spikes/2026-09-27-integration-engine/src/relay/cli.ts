#!/usr/bin/env npx tsx
// New for this spike (brief 04, src/relay/). Thin CLI wrapper around
// `startRelay` for a child-process run (plan section 2: "src/relay/cli.ts
// wraps it for child-process runs, needed for memory measurement and hard
// kills"). Prints a ready line on stdout once listening, ported from spike
// 5's `src/relay.ts`/`src/harness.ts` convention (`src/testkit/
// relayHarness.ts` waits for it), and handles SIGTERM by flushing every
// open branch's draft before exiting -- best-effort durability on a
// graceful stop, mirroring spike 5's SIGTERM handler.
import { startRelay, type RelayOptions } from './server.js';
import { flushBranch } from './flush.js';

interface Args extends RelayOptions {}

function parseArgs(argv: string[]): Args {
  const out: Partial<Args> & { timings?: NonNullable<RelayOptions['timings']> } = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port') out.port = Number(argv[++i]);
    else if (a === '--dataDir') out.dataDir = argv[++i];
    else if (a === '--remote') out.remote = argv[++i];
    else if (a === '--flushDebounceMs') out.timings = { ...out.timings, flushDebounceMs: Number(argv[++i]) };
    else if (a === '--flushMaxIntervalMs') out.timings = { ...out.timings, flushMaxIntervalMs: Number(argv[++i]) };
  }
  if (!out.port || !out.dataDir || !out.remote) {
    throw new Error('usage: cli.ts --port <n> --dataDir <path> --remote <url> [--flushDebounceMs <ms>] [--flushMaxIntervalMs <ms>]');
  }
  return out as Args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const handle = await startRelay(args);
  console.log(`relay-ready port=${handle.port} dataDir=${args.dataDir} remote=${args.remote}`);

  let stopping = false;
  async function shutdown(): Promise<void> {
    if (stopping) return;
    stopping = true;
    try {
      for (const branchState of handle.state.branches.values()) {
        await flushBranch(handle.state.gitStore, branchState, handle.state.counters);
      }
    } catch (err) {
      console.error('[relay] flush-on-shutdown failed', err);
    }
    await handle.stop();
    process.exit(0);
  }

  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
}

main().catch((err) => {
  console.error('[relay] fatal', err);
  process.exit(1);
});
