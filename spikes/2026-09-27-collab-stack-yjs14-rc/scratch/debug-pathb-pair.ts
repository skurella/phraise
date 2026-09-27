import 'global-jsdom/register';
import fs from 'node:fs';
import path from 'node:path';
import { startRelay } from '../src/harness.js';
import { createLiveClient, waitUntil } from '../src/client.js';
import { parseMarkdown } from '../src/parse.js';
import { serializeDoc } from '../src/serialize.js';
import { replaceWholeDoc } from '../gates/lib/edits.js';

const filesArg = process.argv.slice(2);

async function main() {
  const relay = await startRelay({ port: 4245, db: 'data/debug-pathb-pair', seeds: 'corpus/fetched/real' });
  try {
    const [b1, b2] = await Promise.all([
      createLiveClient({ url: relay.wsUrl, docName: 'load:debugpair', token: 'b1' }),
      createLiveClient({ url: relay.wsUrl, docName: 'load:debugpair', token: 'b2' }),
    ]);
    try {
      for (const file of filesArg) {
        const original = fs.readFileSync(path.join('corpus/fetched/real', file), 'utf8');
        const { doc } = parseMarkdown(original);
        replaceWholeDoc(b1.view, doc);
        await waitUntil(() => b2.view.state.doc.textContent.length === b1.view.state.doc.textContent.length, 8000);
        let out1: string | undefined;
        let err1: string | undefined;
        try {
          out1 = serializeDoc(b1.view.state.doc);
        } catch (e) {
          err1 = (e as Error).message;
        }
        let out2: string | undefined;
        let err: string | undefined;
        try {
          out2 = serializeDoc(b2.view.state.doc);
        } catch (e) {
          err = (e as Error).message;
        }
        console.log(file, ': editor1', out1 === original ? 'ok' : `FAIL ${err1 ?? 'byte mismatch'}`, '| editor2', out2 === original ? 'ok' : `FAIL ${err ?? 'byte mismatch'}`);
        if (out1 !== undefined && out1 !== original) {
          let idx = -1;
          const len = Math.min(out1.length, original.length);
          for (let i = 0; i < len; i++) { if (out1[i] !== original[i]) { idx = i; break; } }
          if (idx === -1 && out1.length !== original.length) idx = len;
          console.log('  first diff idx=', idx, 'original len=', original.length, 'out1 len=', out1.length);
          console.log('  original around:', JSON.stringify(original.slice(Math.max(0, idx - 40), idx + 40)));
          console.log('  out1     around:', JSON.stringify(out1.slice(Math.max(0, idx - 40), idx + 40)));
        }
      }
    } finally {
      b1.destroy();
      b2.destroy();
    }
  } finally {
    await relay.stop();
  }
}

main().catch((e) => {
  console.error('FAILED', e);
  process.exit(1);
});
