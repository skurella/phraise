// Gate B: a file edit reaches the remote client as operations confined to
// the changed block, attributed to the local user, for each of the three
// ways editors save.
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { setupFixture, type Fixture } from './daemon-helpers.js';
import { waitFor } from '../src/testkit/wait-for.js';
import { SAVE_STYLES, saveWithStyle } from '../src/testkit/save-styles.js';
import { topLevelBlockOf, rootFragment } from './helpers.js';

const CONTENT =
  '# Corpus doc\n\nParagraph one is here and stays put.\n\nParagraph two is here and stays put.\n\nParagraph three is here and stays put.\n';

let fx: Fixture;

beforeEach(async () => {
  fx = await setupFixture({ content: CONTENT });
});

afterEach(async () => {
  await fx.cleanup();
});

describe.each(SAVE_STYLES)('gate B: file edit reaches the remote client (%s save)', (style) => {
  test(`${style} save is imported and confined to the edited block`, async () => {
    const daemon = fx.makeDaemon();
    await daemon.start();
    const client = fx.makeClient();
    await client.synced();

    const original = readFileSync(fx.repo.file, 'utf8');
    const token = `LOCALEDIT-${style}`;
    const edited = original.replace('Paragraph two', `${token} Paragraph two`);
    expect(edited).not.toBe(original);

    const start = Date.now();
    // Capture every Y type the import changes, over the whole window until the token appears
    // (the import happens asynchronously in the daemon, so `changedTypesDuring`'s synchronous
    // callback form does not fit here).
    const changedTypes = new Set<any>();
    const onUpdate = (_u: Uint8Array, _o: unknown, _d: unknown, tr: any) => {
      for (const t of tr.changed.keys()) changedTypes.add(t);
    };
    client.ydoc.on('update', onUpdate);
    try {
      await saveWithStyle(style, fx.repo.file, edited);
      await waitFor(() => client.editor.currentDoc().textContent.includes(token), 5000);
    } finally {
      client.ydoc.off('update', onUpdate);
    }
    const latency = Date.now() - start;
    console.log(`gate B (${style}) latency: ${latency}ms`);

    const root = rootFragment(client.ydoc);
    const touchedBlocks = new Set<any>();
    for (const t of changedTypes) {
      const blk = topLevelBlockOf(t, root);
      if (blk) touchedBlocks.add(blk);
    }
    expect(touchedBlocks.size).toBeGreaterThan(0);
    expect(touchedBlocks.size).toBeLessThanOrEqual(1);

    // Every author record present maps some client to the local user.
    const authors = client.ydoc.getMap('phraise-authors');
    const names = [...authors.values()].map((v: any) => v.name);
    expect(names).toContain('local-user');

    await daemon.stop();
  });
});
