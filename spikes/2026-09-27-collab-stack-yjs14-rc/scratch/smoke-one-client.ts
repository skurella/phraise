import 'global-jsdom/register';
import { startRelay } from '../src/harness.js';
import { createLiveClient } from '../src/client.js';

async function main() {
  const relay = await startRelay({ port: 4241, db: 'data/smoke2', seeds: 'fixtures' });
  try {
    const a = await createLiveClient({ url: relay.wsUrl, docName: 'file:live.md', token: 'alice' });
    try {
      console.log('doc.attrs=', a.view.state.doc.attrs);
      console.log('textContent length=', a.view.state.doc.textContent.length);
      console.log('textContent snippet=', a.view.state.doc.textContent.slice(0, 80));
      let badgeLinked = false;
      a.view.state.doc.descendants((node) => {
        if (node.type.name === 'image' && node.attrs.url === 'badge.svg') {
          badgeLinked = node.marks.some((m) => m.type.name === 'link');
        }
      });
      console.log('badge.svg has link mark?', badgeLinked);
    } finally {
      a.destroy();
    }
  } finally {
    await relay.stop();
  }
}

main().catch((e) => {
  console.error('FAILED', e);
  process.exit(1);
});
