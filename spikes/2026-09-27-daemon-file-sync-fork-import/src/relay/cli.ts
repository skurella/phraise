#!/usr/bin/env node
// Brief 02 task 5: run a relay standalone.
// Usage: npx tsx src/relay/cli.ts [--port N]
import { startRelay } from './relay.js';

function parseArgs(argv: string[]): { port?: number } {
  const out: { port?: number } = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--port') out.port = Number(argv[++i]);
  }
  return out;
}

async function main(): Promise<void> {
  const { port } = parseArgs(process.argv.slice(2));
  const relay = await startRelay({ port });
  console.log(JSON.stringify({ event: 'listening', url: relay.url, port: relay.port }));

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(JSON.stringify({ event: 'stopping', signal }));
    await relay.stop();
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
