// Gate E (plan section 6): at least 50 scripted concurrent-edit cases
// (local save and remote edit fired together), alternating "different
// blocks" and "same block", varied timing. Replicas converge, every
// inserted token present, file equals render.
import { readFileSync } from 'node:fs';
import * as Y from 'yjs';
import { setupFixture } from './lib/fixture.js';
import { quiesce } from './lib/quiesce.js';
import { waitFor } from '../src/testkit/wait-for.js';
import { makeToken } from '../src/testkit/tokens.js';
import { saveInPlace } from '../src/testkit/save-styles.js';
import { mulberry32, randInt } from './lib/prng.js';
import type { GateOpts, GateResult } from './lib/types.js';

const CONTENT = '# Corpus doc\n\nParagraph one is here.\n\nParagraph two is here.\n\nParagraph three is here.\n';
const SEED = 0xe5000001;

async function runCase(seed: number, sameBlock: boolean, failures: string[]): Promise<boolean> {
  const rng = mulberry32(seed);
  const preDelay = randInt(rng, 30); // delay between issuing the remote transaction and writing the file

  const fx = await setupFixture({ content: CONTENT });
  let ok = true;
  try {
    const daemon = fx.makeDaemon();
    await daemon.start();
    const client = fx.makeClient();
    await client.synced();

    const localToken = makeToken('localE');
    const remoteToken = makeToken('remoteE');

    const original = readFileSync(fx.repo.file, 'utf8');
    const localEdit = sameBlock
      ? original.replace('Paragraph one is here.', `Paragraph one ${localToken} is here.`)
      : original.replace('Paragraph one', `${localToken} Paragraph one`);

    if (sameBlock) {
      client.editor.insertTextAt(0, 'Paragraph one'.length, ` ${remoteToken}`);
    } else {
      client.editor.replaceWord(2, 0, remoteToken);
    }
    if (preDelay > 0) await new Promise((r) => setTimeout(r, preDelay));
    await saveInPlace(fx.repo.file, localEdit);

    await waitFor(() => {
      const onDisk = readFileSync(fx.repo.file, 'utf8');
      return onDisk.includes(localToken) && onDisk.includes(remoteToken);
    }, 5000);
    await waitFor(() => {
      const remoteText = client.editor.currentDoc().textContent;
      return remoteText.includes(localToken) && remoteText.includes(remoteToken);
    }, 5000);

    await quiesce({ daemon, client, filePath: fx.repo.file, timeoutMs: 5000 });

    const finalDisk = readFileSync(fx.repo.file, 'utf8');
    if (!finalDisk.includes(localToken) || !finalDisk.includes(remoteToken)) {
      failures.push(`seed ${seed} (sameBlock=${sameBlock}): a token is missing from the final file`);
      ok = false;
    }
    if (finalDisk !== daemon.docSync.render()) {
      failures.push(`seed ${seed} (sameBlock=${sameBlock}): final file does not equal render`);
      ok = false;
    }
    const daemonSv = Buffer.from(Y.encodeStateVector(daemon.docSync.doc));
    const clientSv = Buffer.from(Y.encodeStateVector(client.ydoc));
    if (Buffer.compare(daemonSv, clientSv) !== 0) {
      failures.push(`seed ${seed} (sameBlock=${sameBlock}): daemon and client state vectors differ after quiescing`);
      ok = false;
    }

    await daemon.stop();
  } catch (err) {
    failures.push(`seed ${seed} (sameBlock=${sameBlock}): threw ${String((err as Error)?.message ?? err)}`);
    ok = false;
  } finally {
    await fx.cleanup();
  }
  return ok;
}

export async function runGateE(opts: GateOpts = {}): Promise<GateResult> {
  const N = opts.quick ? 10 : 50;
  const failures: string[] = [];
  let passed = 0;
  for (let i = 0; i < N; i++) {
    const seed = SEED + i;
    const sameBlock = i % 2 === 0;
    if (await runCase(seed, sameBlock, failures)) passed++;
  }
  return {
    gate: 'E',
    requirement: 'Concurrent local and remote edits converge; nothing lost; file equals render.',
    pass: passed === N,
    numbers: { cases: N, passed },
    failures,
  };
}
