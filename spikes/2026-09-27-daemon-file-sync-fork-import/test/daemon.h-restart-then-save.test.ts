// Regression (orchestrator review of brief 02): after a restart with nothing
// changed on either side, the version ring must still hold the persisted base,
// or the next save has no base candidates and the import throws.
import { afterEach, beforeEach, expect, test } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { setupFixture, type Fixture } from './daemon-helpers.js';
import { waitFor } from '../src/testkit/wait-for.js';
import { makeToken } from '../src/testkit/tokens.js';
import { serializeDoc, yDocToDoc } from '../src/md/index.js';

const CONTENT = '# Doc\n\nParagraph one is here.\n\nParagraph two is here.\n';

let fx: Fixture;

beforeEach(async () => {
  fx = await setupFixture({ content: CONTENT });
});

afterEach(async () => {
  await fx.cleanup();
});

test('gate H: restart with no changes, then a save is imported', async () => {
  const daemon1 = fx.makeDaemon();
  await daemon1.start();
  await daemon1.stop({ persist: true });

  const daemon2 = fx.makeDaemon();
  const errors: string[] = [];
  daemon2.on('error', (e: { message: string }) => errors.push(e.message));
  await daemon2.start();

  const client = fx.makeClient();
  await client.synced();

  const token = makeToken('afterRestart');
  writeFileSync(fx.repo.file, readFileSync(fx.repo.file, 'utf8').replace('Paragraph two', `${token} Paragraph two`));
  await waitFor(() => serializeDoc(yDocToDoc(client.ydoc)).includes(token), 5000);
  expect(errors).toEqual([]);
  await daemon2.stop();
});
