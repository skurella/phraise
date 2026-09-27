import 'global-jsdom/register';
import { createLiveClient } from '../src/client.js';

async function main() {
  const [a, b] = await Promise.all([
    createLiveClient({ url: 'ws://127.0.0.1:4242', docName: 'file:live.md', token: 'alice' }),
    createLiveClient({ url: 'ws://127.0.0.1:4242', docName: 'file:live.md', token: 'bob' }),
  ]);
  console.log('both synced', a.view.state.doc.textContent.length, b.view.state.doc.textContent.length);
  a.destroy();
  b.destroy();
}

main().catch((e) => {
  console.error('FAILED', e);
  process.exit(1);
});
