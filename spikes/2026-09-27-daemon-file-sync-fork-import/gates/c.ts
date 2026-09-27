// Gate C (plan section 6): 200 rapid alternating rounds (remote edit, file
// save, 0-20ms gaps). "An echo is an import event whose text the harness
// never wrote to the file" (brief 03): tracked by hashing every string the
// harness itself wrote via `saveInPlace`, plus every hash the daemon itself
// exported (bytes the harness never typed either -- importing those back
// would be the daemon re-reading its own write). Both counts must be zero.
import { readFileSync } from 'node:fs';
import { setupFixture } from './lib/fixture.js';
import { quiesce } from './lib/quiesce.js';
import { waitFor } from '../src/testkit/wait-for.js';
import { makeToken } from '../src/testkit/tokens.js';
import { saveInPlace } from '../src/testkit/save-styles.js';
import { hashText } from '../src/core/versions.js';
import type { GateOpts, GateResult } from './lib/types.js';

const CONTENT =
  '# Corpus doc\n\nParagraph one is here.\n\nParagraph two is here.\n\nParagraph three is here.\n\nParagraph four is here.\n';

export async function runGateC(opts: GateOpts = {}): Promise<GateResult> {
  const ROUNDS = opts.quick ? 20 : 200;
  const failures: string[] = [];
  const fx = await setupFixture({ content: CONTENT });
  let echoCount = 0;
  let importOfDaemonBytesCount = 0;

  try {
    const daemon = fx.makeDaemon();
    await daemon.start();
    const client = fx.makeClient();
    await client.synced();

    const exportedHashes = new Set<string>();
    const harnessWrittenHashes = new Set<string>([hashText(CONTENT)]);

    daemon.on('export', (e: { hash: string }) => exportedHashes.add(e.hash));
    daemon.on('import', (e: { hash: string }) => {
      if (exportedHashes.has(e.hash)) {
        importOfDaemonBytesCount++;
        failures.push(`import event hash ${e.hash.slice(0, 12)} matches a hash the daemon itself exported`);
      } else if (!harnessWrittenHashes.has(e.hash)) {
        echoCount++;
        failures.push(`import event hash ${e.hash.slice(0, 12)} does not match any text the harness wrote`);
      }
    });

    const allTokens: string[] = [];

    for (let i = 0; i < ROUNDS; i++) {
      const remoteToken = makeToken(`remoteC${i}`);
      client.editor.insertParagraphAfter(i % 4, remoteToken);
      allTokens.push(remoteToken);

      await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 20)));

      const localToken = makeToken(`localC${i}`);
      const current = readFileSync(fx.repo.file, 'utf8');
      const withLocal = `${current}\n${localToken}\n`;
      harnessWrittenHashes.add(hashText(withLocal));
      await saveInPlace(fx.repo.file, withLocal);
      allTokens.push(localToken);

      await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 20)));
    }

    try {
      await waitFor(() => {
        const onDisk = readFileSync(fx.repo.file, 'utf8');
        return allTokens.every((t) => onDisk.includes(t));
      }, 15000);
      await waitFor(() => {
        const remoteText = client.editor.currentDoc().textContent;
        return allTokens.every((t) => remoteText.includes(t));
      }, 15000);
    } catch (err) {
      failures.push(`tokens never converged: ${String((err as Error)?.message ?? err)}`);
    }

    await quiesce({ daemon, client, filePath: fx.repo.file, timeoutMs: 10000 });

    const finalDisk = readFileSync(fx.repo.file, 'utf8');
    const rendered = daemon.docSync.render();
    if (finalDisk !== rendered) {
      failures.push('final file does not equal daemon render after quiescing');
    }

    await daemon.stop();
  } finally {
    await fx.cleanup();
  }

  return {
    gate: 'C',
    requirement: 'No echo: the daemon\'s own writes never come back as edits, under rapid alternating edits.',
    pass: echoCount === 0 && importOfDaemonBytesCount === 0 && failures.length === 0,
    numbers: { rounds: ROUNDS, echoCount, importOfDaemonBytesCount },
    failures,
  };
}
