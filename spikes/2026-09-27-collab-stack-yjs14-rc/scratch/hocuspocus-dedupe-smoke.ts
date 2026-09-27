import 'global-jsdom/register';
import { spawn } from 'node:child_process';
import * as Y from 'yjs';
import { createLiveClient, waitUntil } from './src/client-attempt-a-hocuspocus.js';
import { ynodeToPmnode } from '@y/prosemirror';
import { schema } from './src/schema.js';
import { serializeDoc } from './src/serialize.js';

const port = 4271;
const relay: any = { kill(){} };
const kill = () => { try { relay.kill('SIGKILL'); } catch {} };
process.on('exit', kill);

async function main() {
  setTimeout(()=>{console.log("TIMEOUT");process.exit(2)},20000);
  const url = `ws://127.0.0.1:${port}`;
  const a = await createLiveClient({ url, docName: 'file:live.md', token: 'alice' });
  const b = await createLiveClient({ url, docName: 'file:live.md', token: 'bob' });
  console.log('synced lengths', a.view.state.doc.textContent.length, b.view.state.doc.textContent.length);
  const end = a.view.state.doc.content.size - 1;
  a.view.dispatch(a.view.state.tr.insertText('HELLO', end));
  await waitUntil(() => b.view.state.doc.textContent.includes('HELLO'), 5000);
  console.log('edit a -> b ok');
  let linked = 0;
  b.view.state.doc.descendants((n) => { if (n.type.name === 'image' && n.marks.length) linked++; });
  console.log('linked images in b', linked, 'doc attrs', JSON.stringify(b.view.state.doc.attrs));
  const res = await fetch(`http://127.0.0.1:${port}/state/${encodeURIComponent('file:live.md')}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const d = new Y.Doc();
  Y.applyUpdate(d, bytes);
  const relayDoc = ynodeToPmnode((d as any).get('prosemirror'), schema);
  console.log('relay equals b:', serializeDoc(relayDoc) === serializeDoc(b.view.state.doc));
  a.destroy();
  b.destroy();
}
main().then(() => { kill(); process.exit(0); }, (e) => { console.error('FAILED', e); kill(); process.exit(1); });
