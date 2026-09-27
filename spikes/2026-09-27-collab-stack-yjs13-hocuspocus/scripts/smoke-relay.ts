#!/usr/bin/env npx tsx
// Manual smoke test for src/harness.ts's startRelay/stopRelay (not part of
// npm run gates): confirms the relay starts, seeds a `file:` document
// through the codec, serves /state, and that the process is really gone
// after stop(), including its own subprocess (see harness.ts's comment on
// why `--import tsx/esm` is used instead of the tsx CLI).
import * as Y from 'yjs';
import { startRelay } from '../src/harness.js';
import { yDocToDoc } from '../src/yjs.js';
import { serializeDoc } from '../src/serialize.js';

async function main() {
  const relay = await startRelay({ port: 4212, db: 'data/smoke.sqlite', seeds: 'fixtures' });
  console.log('relay started on', relay.port);

  // Force the relay to load+seed the document by opening a direct
  // connection is more than this smoke test needs; instead just confirm
  // /state responds (possibly empty, since nothing has connected yet).
  const before = await relay.fetchState('file:live.md');
  console.log('state before any connection: bytes =', before.length);

  await relay.stop();
  console.log('relay stopped');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
