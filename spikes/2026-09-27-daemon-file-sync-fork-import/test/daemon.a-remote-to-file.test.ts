// Gate A: a remote edit reaches the file, and blocks the edit did not touch
// stay byte-identical. Reports median/p95 latency from the remote
// transaction to the file containing it.
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { setupFixture, type Fixture } from './daemon-helpers.js';
import { waitFor } from '../src/testkit/wait-for.js';
import { makeToken, tokensIn } from '../src/testkit/tokens.js';

const CONTENT =
  '# Corpus doc\n\nParagraph one is here and stays put.\n\nParagraph two is here and stays put.\n\nParagraph three is here and stays put.\n\nParagraph four is here and stays put.\n';

let fx: Fixture;

beforeEach(async () => {
  fx = await setupFixture({ content: CONTENT });
});

afterEach(async () => {
  await fx.cleanup();
});

test('gate A: remote word edits reach the file; untouched blocks are byte-identical', async () => {
  const daemon = fx.makeDaemon();
  await daemon.start();
  const client = fx.makeClient();
  await client.synced();

  const untouchedParagraphs = [
    'Paragraph two is here and stays put.',
    'Paragraph three is here and stays put.',
    'Paragraph four is here and stays put.',
  ];

  const N = 20;
  const latenciesMs: number[] = [];

  for (let i = 0; i < N; i++) {
    const token = makeToken('remoteA');
    const start = Date.now();
    client.editor.replaceWord(0, i % 5, token);
    await waitFor(() => readFileSync(fx.repo.file, 'utf8').includes(token), 5000);
    latenciesMs.push(Date.now() - start);

    const onDisk = readFileSync(fx.repo.file, 'utf8');
    for (const p of untouchedParagraphs) {
      expect(onDisk).toContain(p);
    }
  }

  latenciesMs.sort((a, b) => a - b);
  const median = latenciesMs[Math.floor(latenciesMs.length / 2)];
  const p95 = latenciesMs[Math.floor(latenciesMs.length * 0.95)];
  console.log(`gate A latency (n=${N}): median ${median}ms, p95 ${p95}ms`);
  expect(median).toBeLessThan(2000);

  await daemon.stop();
});
