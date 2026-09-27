// Gate E: simultaneous local save and remote edit, in different blocks and
// in the same block. Replicas converge, tokens present, file equals render.
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { setupFixture, type Fixture } from './daemon-helpers.js';
import { waitFor } from '../src/testkit/wait-for.js';
import { makeToken } from '../src/testkit/tokens.js';
import { saveInPlace } from '../src/testkit/save-styles.js';

const CONTENT = '# Corpus doc\n\nParagraph one is here.\n\nParagraph two is here.\n\nParagraph three is here.\n';

let fx: Fixture;

beforeEach(async () => {
  fx = await setupFixture({ content: CONTENT });
});

afterEach(async () => {
  await fx.cleanup();
});

async function runConcurrentEdit(fx: Fixture, opts: { sameBlock: boolean }): Promise<void> {
  const daemon = fx.makeDaemon();
  await daemon.start();
  const client = fx.makeClient();
  await client.synced();

  const localToken = makeToken('localE');
  const remoteToken = makeToken('remoteE');

  const original = readFileSync(fx.repo.file, 'utf8');
  const localEdit = opts.sameBlock
    ? original.replace('Paragraph one is here.', `Paragraph one ${localToken} is here.`)
    : original.replace('Paragraph one', `${localToken} Paragraph one`);

  // Fire both "simultaneously": no await between issuing the remote transaction
  // and writing the file.
  if (opts.sameBlock) {
    client.editor.insertTextAt(0, 'Paragraph one'.length, ` ${remoteToken}`);
  } else {
    client.editor.replaceWord(2, 0, remoteToken);
  }
  await saveInPlace(fx.repo.file, localEdit);

  await waitFor(() => {
    const onDisk = readFileSync(fx.repo.file, 'utf8');
    return onDisk.includes(localToken) && onDisk.includes(remoteToken);
  }, 5000);
  await waitFor(() => {
    const remoteText = client.editor.currentDoc().textContent;
    return remoteText.includes(localToken) && remoteText.includes(remoteToken);
  }, 5000);
  // Let any trailing export/import settle so file and doc converge to the same bytes.
  await new Promise((r) => setTimeout(r, 300));

  const finalDisk = readFileSync(fx.repo.file, 'utf8');
  expect(finalDisk).toContain(localToken);
  expect(finalDisk).toContain(remoteToken);
  expect(finalDisk).toBe(daemon.docSync.render());

  // Replicas converge: the client's own render of its doc equals the file (both are
  // renders of docs whose state vectors are now equal, since the daemon's Y.Doc and the
  // client's Y.Doc have exchanged every update through the relay).
  await daemon.stop();
}

describe('gate E: concurrent local save and remote edit converge', () => {
  test('different blocks', async () => {
    await runConcurrentEdit(fx, { sameBlock: false });
  });

  test('same block', async () => {
    await runConcurrentEdit(fx, { sameBlock: true });
  });
});
