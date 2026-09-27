#!/usr/bin/env node
// Brief 02 task 5:
// npx tsx src/daemon/cli.ts --relay <url> --repo <dir> --file <path> --doc <name> --user <name>
// Prints events as JSON lines, exits cleanly on SIGINT/SIGTERM (persisting).
import { Daemon } from './daemon.js';

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      out[arg.slice(2)] = argv[i + 1] ?? '';
      i++;
    }
  }
  return out;
}

const EVENT_NAMES = [
  'import',
  'import-noop',
  'export',
  'export-skip',
  'detach',
  'attach',
  'rebase',
  'conflict',
  'error',
] as const;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  for (const key of ['relay', 'repo', 'file', 'doc', 'user']) {
    if (!args[key]) {
      console.error(`daemon cli: missing --${key}`);
      process.exit(1);
    }
  }

  const daemon = new Daemon({
    repoDir: args.repo,
    file: args.file,
    docName: args.doc,
    relayUrl: args.relay,
    user: { name: args.user },
  });

  for (const eventName of EVENT_NAMES) {
    daemon.on(eventName, (payload: unknown) => {
      const body = typeof payload === 'object' && payload !== null ? payload : {};
      console.log(JSON.stringify({ event: eventName, ...body }));
    });
  }

  await daemon.start();
  console.log(JSON.stringify({ event: 'started' }));

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(JSON.stringify({ event: 'stopping', signal }));
    await daemon.stop({ persist: true });
    console.log(JSON.stringify({ event: 'stopped' }));
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
