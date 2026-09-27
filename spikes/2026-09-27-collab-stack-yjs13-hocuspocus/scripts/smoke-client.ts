#!/usr/bin/env npx tsx
// Manual smoke test (not part of npm run gates): two live clients connected
// to one relay, one types into a paragraph, the other observes it.
import 'global-jsdom/register';
import fs from 'node:fs';
import { insertText, waitUntil } from '../gates/lib/edits.js';
import { startRelay } from '../src/harness.js';
import { createLiveClient } from '../src/client.js';

async function main() {
  const relay = await startRelay({ port: 4213, db: 'data/smoke-client.sqlite', seeds: 'fixtures' });
  try {
    const [a, b] = await Promise.all([
      createLiveClient({ url: relay.wsUrl, docName: 'file:live.md', token: 'alice' }),
      createLiveClient({ url: relay.wsUrl, docName: 'file:live.md', token: 'bob' }),
    ]);
    console.log('both clients synced');
    console.log('a doc attrs:', a.view.state.doc.attrs);
    console.log('b doc attrs:', b.view.state.doc.attrs);

    // Find the closing paragraph in editor A and type into it.
    let pos = -1;
    a.view.state.doc.descendants((node, p) => {
      if (pos === -1 && node.isTextblock && node.textContent.includes('A closing paragraph')) {
        pos = p + node.nodeSize - 1; // end of that paragraph's content
      }
    });
    if (pos === -1) throw new Error('paragraph not found');
    insertText(a.view, pos, 'HELLO');

    await waitUntil(() => b.view.state.doc.textContent.includes('HELLO'), 5000);
    console.log('editor B saw the edit from editor A');

    const stateBytes = await relay.fetchState('file:live.md');
    console.log('relay state bytes:', stateBytes.length);

    a.destroy();
    b.destroy();
  } finally {
    await relay.stop();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
