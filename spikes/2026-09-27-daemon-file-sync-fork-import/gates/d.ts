// Gate D (plan section 6): at least 50 scripted stale-save cases, each with
// varied timing. Editor loads V0, two remote edits land (V1, V2), editor
// saves V0 plus its own edit. All remote edits and the local edit must be
// present afterwards; the file must equal the render. One fixture per case
// (each is a fresh daemon+repo), timings drawn from a seeded PRNG so a
// failing case reproduces from its seed.
import { readFileSync } from 'node:fs';
import { setupFixture } from './lib/fixture.js';
import { quiesce } from './lib/quiesce.js';
import { waitFor } from '../src/testkit/wait-for.js';
import { makeToken } from '../src/testkit/tokens.js';
import { saveInPlace } from '../src/testkit/save-styles.js';
import { mulberry32, randInt } from './lib/prng.js';
import type { GateOpts, GateResult } from './lib/types.js';

const CONTENT = '# Corpus doc\n\nParagraph one is here.\n\nParagraph two is here.\n\nParagraph three is here.\n';
const SEED = 0xd47e0001;

// Every fifth case lands 60 more remote edits (each written to the file, so
// each is a version in the daemon's ring) before the stale save: more than the
// ring holds at full density (orchestrator addition after the review found the
// original FIFO ring evicted the editor's base after 32 writes).
const MANY = 60;

async function runCase(seed: number, failures: string[], extraRemoteEdits: number): Promise<boolean> {
  const rng = mulberry32(seed);
  const gap1 = randInt(rng, 100); // delay before second remote edit
  const gap2 = randInt(rng, 100); // delay before the stale save lands

  const fx = await setupFixture({ content: CONTENT });
  let ok = true;
  try {
    const daemon = fx.makeDaemon();
    await daemon.start();
    const client = fx.makeClient();
    await client.synced();

    const v0 = readFileSync(fx.repo.file, 'utf8');

    const remoteToken1 = makeToken('remoteD1');
    client.editor.replaceWord(1, 1, remoteToken1);
    await waitFor(() => readFileSync(fx.repo.file, 'utf8').includes(remoteToken1), 5000);

    await new Promise((r) => setTimeout(r, gap1));

    const remoteToken2 = makeToken('remoteD2');
    client.editor.replaceWord(2, 1, remoteToken2);
    await waitFor(() => readFileSync(fx.repo.file, 'utf8').includes(remoteToken2), 5000);

    const extraTokens: string[] = [];
    for (let k = 0; k < extraRemoteEdits; k++) {
      const t = makeToken('remoteDx');
      extraTokens.push(t);
      client.editor.insertParagraphAfter(3, t);
      await waitFor(() => readFileSync(fx.repo.file, 'utf8').includes(t), 5000);
    }

    await new Promise((r) => setTimeout(r, gap2));

    const localToken = makeToken('localD');
    const staleSave = v0.replace('Paragraph one', `${localToken} Paragraph one`);
    await saveInPlace(fx.repo.file, staleSave);

    await waitFor(() => {
      const onDisk = readFileSync(fx.repo.file, 'utf8');
      return onDisk.includes(localToken) && onDisk.includes(remoteToken1) && onDisk.includes(remoteToken2);
    }, 5000);

    await quiesce({ daemon, client, filePath: fx.repo.file, timeoutMs: 5000 });

    const finalDisk = readFileSync(fx.repo.file, 'utf8');
    if (!finalDisk.includes(localToken)) {
      failures.push(`seed ${seed}: local token missing`);
      ok = false;
    }
    if (!finalDisk.includes(`Paragraph ${remoteToken1} is here.`)) {
      failures.push(`seed ${seed}: remote edit 1 not preserved exactly`);
      ok = false;
    }
    if (!finalDisk.includes(`Paragraph ${remoteToken2} is here.`)) {
      failures.push(`seed ${seed}: remote edit 2 not preserved exactly`);
      ok = false;
    }
    const missingExtra = extraTokens.filter((t) => !finalDisk.includes(t));
    if (missingExtra.length > 0) {
      failures.push(`seed ${seed}: ${missingExtra.length} of ${extraTokens.length} extra remote edits reverted`);
      ok = false;
    }
    if (finalDisk !== daemon.docSync.render()) {
      failures.push(`seed ${seed}: final file does not equal render`);
      ok = false;
    }

    await daemon.stop();
  } catch (err) {
    failures.push(`seed ${seed}: threw ${String((err as Error)?.message ?? err)}`);
    ok = false;
  } finally {
    await fx.cleanup();
  }
  return ok;
}

export async function runGateD(opts: GateOpts = {}): Promise<GateResult> {
  const N = opts.quick ? 10 : 50;
  const failures: string[] = [];
  let passed = 0;
  for (let i = 0; i < N; i++) {
    const seed = SEED + i;
    if (await runCase(seed, failures, i % 5 === 4 ? MANY : 0)) passed++;
  }
  return {
    gate: 'D',
    requirement: 'Stale save does not revert remote edits made after its base.',
    pass: passed === N,
    numbers: { cases: N, passed, casesWith60ExtraRemoteEdits: Math.floor(N / 5) },
    failures,
  };
}
