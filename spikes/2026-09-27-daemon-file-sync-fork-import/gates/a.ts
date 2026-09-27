// Gate A (plan section 6): 200 remote word edits on a corpus README-shaped
// doc, each timed from the remote transaction to the file containing it.
// After each edit, every top-level block the edit did not touch is
// byte-identical to the PREVIOUS file's same block (not just to the
// original: edits accumulate in block 0 round over round).
import { readFileSync } from 'node:fs';
import { setupFixture } from './lib/fixture.js';
import { quiesce } from './lib/quiesce.js';
import { waitFor } from '../src/testkit/wait-for.js';
import { makeToken } from '../src/testkit/tokens.js';
import { diffingTopLevelBlocks } from './lib/blocks.js';
import { summarizeLatencies } from './lib/stats.js';
import type { GateOpts, GateResult } from './lib/types.js';

const CONTENT =
  '# Corpus doc\n\nParagraph one is here and stays put.\n\nParagraph two is here and stays put.\n\nParagraph three is here and stays put.\n\nParagraph four is here and stays put.\n';

export async function runGateA(opts: GateOpts = {}): Promise<GateResult> {
  const N = opts.quick ? 20 : 200;
  const fx = await setupFixture({ content: CONTENT });
  const failures: string[] = [];
  const latenciesMs: number[] = [];
  try {
    const daemon = fx.makeDaemon();
    await daemon.start();
    const client = fx.makeClient();
    await client.synced();

    let previous = readFileSync(fx.repo.file, 'utf8');

    for (let i = 0; i < N; i++) {
      const token = makeToken('remoteA');
      const start = Date.now();
      client.editor.replaceWord(0, i % 5, token);
      try {
        await waitFor(() => readFileSync(fx.repo.file, 'utf8').includes(token), 5000);
      } catch (err) {
        failures.push(`round ${i}: file never contained token: ${String((err as Error)?.message ?? err)}`);
        break;
      }
      latenciesMs.push(Date.now() - start);

      const onDisk = readFileSync(fx.repo.file, 'utf8');
      const touched = diffingTopLevelBlocks(previous, onDisk);
      const unexpected = touched.filter((idx) => idx !== 0);
      if (unexpected.length > 0) {
        failures.push(`round ${i}: unexpected block(s) changed: ${JSON.stringify(unexpected)}`);
      }
      if (!touched.includes(0)) {
        failures.push(`round ${i}: block 0 (the edited one) did not change`);
      }
      previous = onDisk;
    }

    await quiesce({ daemon, client, filePath: fx.repo.file, timeoutMs: 5000 });
    await daemon.stop();
  } finally {
    await fx.cleanup();
  }

  const stats = summarizeLatencies(latenciesMs);
  return {
    gate: 'A',
    requirement: 'Remote edit reaches the file; untouched blocks stay byte-identical. Latency median/p95.',
    pass: failures.length === 0 && stats.n === N,
    numbers: { trials: N, completed: stats.n, medianMs: stats.medianMs, p95Ms: stats.p95Ms, maxMs: stats.maxMs },
    failures,
  };
}
