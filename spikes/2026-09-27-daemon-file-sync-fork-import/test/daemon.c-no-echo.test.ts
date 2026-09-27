// Gate C: 30 rapid alternating rounds (remote edit, file save, small random
// gaps). No import event whose bytes the test did not write (no echo); the
// final file equals the render of the converged doc; all tokens present.
import { afterEach, beforeEach, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { setupFixture, type Fixture } from './daemon-helpers.js';
import { waitFor } from '../src/testkit/wait-for.js';
import { makeToken } from '../src/testkit/tokens.js';
import { saveInPlace } from '../src/testkit/save-styles.js';

const CONTENT =
  '# Corpus doc\n\nParagraph one is here.\n\nParagraph two is here.\n\nParagraph three is here.\n\nParagraph four is here.\n';

let fx: Fixture;

beforeEach(async () => {
  fx = await setupFixture({ content: CONTENT });
});

afterEach(async () => {
  await fx.cleanup();
});

test('gate C: no echo under rapid alternating remote/local edits', async () => {
  const daemon = fx.makeDaemon();
  await daemon.start();
  const client = fx.makeClient();
  await client.synced();

  // Hash-based tracking (both events carry `hashText(text)` of the resulting
  // content) avoids racing the test's own in-flight writes: an import whose
  // hash matches a hash the daemon itself most recently exported is an echo.
  const exportedHashes = new Set<string>();
  const echoes: string[] = [];
  daemon.on('export', (e: { hash: string }) => {
    exportedHashes.add(e.hash);
  });
  daemon.on('import', (e: { hash: string }) => {
    if (exportedHashes.has(e.hash)) echoes.push(e.hash);
  });

  const allTokens: string[] = [];
  const ROUNDS = 30;

  for (let i = 0; i < ROUNDS; i++) {
    const remoteToken = makeToken(`remoteC${i}`);
    client.editor.insertParagraphAfter(i % 4, remoteToken);
    allTokens.push(remoteToken);

    await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 20)));

    const localToken = makeToken(`localC${i}`);
    const current = readFileSync(fx.repo.file, 'utf8');
    const withLocal = `${current}\n${localToken}\n`;
    await saveInPlace(fx.repo.file, withLocal);
    allTokens.push(localToken);

    await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 20)));
  }

  // Let everything settle: every token present in both the file and the remote doc.
  await waitFor(() => {
    const onDisk = readFileSync(fx.repo.file, 'utf8');
    return allTokens.every((t) => onDisk.includes(t));
  }, 15000);
  await waitFor(() => {
    const remoteText = client.editor.currentDoc().textContent;
    return allTokens.every((t) => remoteText.includes(t));
  }, 15000);

  // Quiesce: wait until file stops changing (no more in-flight exports/imports).
  await new Promise((r) => setTimeout(r, 500));

  expect(echoes).toEqual([]);

  const finalDisk = readFileSync(fx.repo.file, 'utf8');
  const rendered = daemon.docSync.render();
  expect(finalDisk).toBe(rendered);

  await daemon.stop();
});
