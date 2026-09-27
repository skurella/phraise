// Gate D: stale save. The editor reads V0, two remote edits land and the
// daemon writes V1 and V2, the editor saves V0 plus its own token. All
// remote tokens and the local token must be present afterwards, and the
// file must equal the render.
import { afterEach, beforeEach, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { setupFixture, type Fixture } from './daemon-helpers.js';
import { waitFor } from '../src/testkit/wait-for.js';
import { makeToken } from '../src/testkit/tokens.js';
import { saveInPlace } from '../src/testkit/save-styles.js';

const CONTENT =
  '# Corpus doc\n\nParagraph one is here.\n\nParagraph two is here.\n\nParagraph three is here.\n';

let fx: Fixture;

beforeEach(async () => {
  fx = await setupFixture({ content: CONTENT });
});

afterEach(async () => {
  await fx.cleanup();
});

test('gate D: a stale save does not revert remote edits made after its base', async () => {
  const daemon = fx.makeDaemon();
  await daemon.start();
  const client = fx.makeClient();
  await client.synced();

  // V0: what the editor "reads".
  const v0 = readFileSync(fx.repo.file, 'utf8');

  // Two remote edits land while the editor sits on V0; each is written to
  // the file by the daemon (V1, then V2).
  const remoteToken1 = makeToken('remoteD1');
  client.editor.replaceWord(1, 1, remoteToken1); // paragraph 1: "Paragraph two is here." -> "Paragraph {token1} is here."
  await waitFor(() => readFileSync(fx.repo.file, 'utf8').includes(remoteToken1), 5000);

  const remoteToken2 = makeToken('remoteD2');
  client.editor.replaceWord(2, 1, remoteToken2); // paragraph 2: "Paragraph three is here." -> "Paragraph {token2} is here."
  await waitFor(() => readFileSync(fx.repo.file, 'utf8').includes(remoteToken2), 5000);

  // The editor now saves its buffer: V0 plus its own edit, ignorant of V1/V2.
  const localToken = makeToken('localD');
  const staleSave = v0.replace('Paragraph one', `${localToken} Paragraph one`);
  await saveInPlace(fx.repo.file, staleSave);

  await waitFor(() => {
    const onDisk = readFileSync(fx.repo.file, 'utf8');
    return onDisk.includes(localToken) && onDisk.includes(remoteToken1) && onDisk.includes(remoteToken2);
  }, 5000);

  const finalDisk = readFileSync(fx.repo.file, 'utf8');
  expect(finalDisk).toContain(localToken);
  expect(finalDisk).toContain(remoteToken1);
  expect(finalDisk).toContain(remoteToken2);
  // The remote edits themselves are preserved exactly, not just present anywhere in the file.
  expect(finalDisk).toContain(`Paragraph ${remoteToken1} is here.`);
  expect(finalDisk).toContain(`Paragraph ${remoteToken2} is here.`);

  expect(finalDisk).toBe(daemon.docSync.render());

  await daemon.stop();
});
