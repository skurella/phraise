// Gate B (plan section 6): 100 file edits per save style, timed from the
// write to the remote client seeing the change. Every inserted/deleted item
// lies inside the edited top-level block (via `changedTypesDuring`'s
// approach, applied over the async import window); the inserting client's
// `phraise-authors` entry is the local user.
import { readFileSync, writeFileSync } from 'node:fs';
import { setupFixture } from './lib/fixture.js';
import { quiesce } from './lib/quiesce.js';
import { waitFor } from '../src/testkit/wait-for.js';
import { makeToken } from '../src/testkit/tokens.js';
import { SAVE_STYLES, saveWithStyle, type SaveStyle } from '../src/testkit/save-styles.js';
import { topLevelBlockOf, rootFragment } from '../test/helpers.js';
import { summarizeLatencies } from './lib/stats.js';
import type { GateOpts, GateResult } from './lib/types.js';

const CONTENT = '# Corpus doc\n\nParagraph one is here.\n\nParagraph two is here.\n\nParagraph three ends here.\n';

async function runStyle(style: SaveStyle, count: number, failures: string[]): Promise<number[]> {
  const fx = await setupFixture({ content: CONTENT });
  const latenciesMs: number[] = [];
  try {
    const daemon = fx.makeDaemon();
    await daemon.start();
    const client = fx.makeClient();
    await client.synced();

    // Track the last block's current text; each round appends a token just before its
    // final period, so the edit stays confined to that one top-level block round after
    // round (matching the previous round's own text exactly, so `String#replace` finds it).
    let paraText = 'Paragraph three ends here.';

    for (let i = 0; i < count; i++) {
      const token = makeToken(`localB-${style}-${i}`);
      const current = readFileSync(fx.repo.file, 'utf8');
      if (!current.includes(paraText)) {
        failures.push(`${style} round ${i}: expected paragraph text not found on disk`);
        break;
      }
      const newParaText = `${paraText.slice(0, -1)} ${token}.`;
      const edited = current.replace(paraText, newParaText);

      const changedTypes = new Set<any>();
      const onUpdate = (_u: Uint8Array, _o: unknown, _d: unknown, tr: any) => {
        for (const t of tr.changed.keys()) changedTypes.add(t);
      };
      client.ydoc.on('update', onUpdate);
      const start = Date.now();
      try {
        await saveWithStyle(style, fx.repo.file, edited);
        await waitFor(() => client.editor.currentDoc().textContent.includes(token), 5000);
      } catch (err) {
        failures.push(`${style} round ${i}: token never reached remote client: ${String((err as Error)?.message ?? err)}`);
        client.ydoc.off('update', onUpdate);
        break;
      }
      latenciesMs.push(Date.now() - start);
      client.ydoc.off('update', onUpdate);

      const root = rootFragment(client.ydoc);
      const touchedBlocks = new Set<any>();
      for (const t of changedTypes) {
        const blk = topLevelBlockOf(t, root);
        if (blk) touchedBlocks.add(blk);
      }
      if (touchedBlocks.size === 0) {
        failures.push(`${style} round ${i}: no top-level block registered as changed`);
      } else if (touchedBlocks.size > 1) {
        failures.push(`${style} round ${i}: edit touched ${touchedBlocks.size} top-level blocks, expected 1`);
      }

      paraText = newParaText;
    }

    const authors = client.ydoc.getMap('phraise-authors');
    const names = [...authors.values()].map((v: any) => v.name);
    if (!names.includes('local-user')) {
      failures.push(`${style}: phraise-authors never recorded the local user (saw: ${JSON.stringify(names)})`);
    }

    await quiesce({ daemon, client, filePath: fx.repo.file, timeoutMs: 5000 });
    await daemon.stop();
  } finally {
    await fx.cleanup();
  }
  return latenciesMs;
}

export async function runGateB(opts: GateOpts = {}): Promise<GateResult> {
  const N = opts.quick ? 10 : 100;
  const failures: string[] = [];
  const numbers: Record<string, unknown> = { perStyle: N };
  let totalCompleted = 0;

  for (const style of SAVE_STYLES) {
    const latencies = await runStyle(style, N, failures);
    totalCompleted += latencies.length;
    const stats = summarizeLatencies(latencies);
    numbers[`${style}.medianMs`] = stats.medianMs;
    numbers[`${style}.p95Ms`] = stats.p95Ms;
    numbers[`${style}.completed`] = stats.n;
  }

  return {
    gate: 'B',
    requirement: 'File edit reaches the remote client confined to the edited block, attributed to the local user, per save style.',
    pass: failures.length === 0 && totalCompleted === N * SAVE_STYLES.length,
    numbers,
    failures,
  };
}
