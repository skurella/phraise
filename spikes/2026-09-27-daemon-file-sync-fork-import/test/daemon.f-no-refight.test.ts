// Gate F: after importing a local save, the daemon does not rewrite the
// file unless a remote change arrives. No `export` event carrying an actual
// write follows within 500ms of an import, and the file bytes are
// unchanged. Covers half-typed Markdown (an unclosed fence) too.
import { afterEach, beforeEach, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { setupFixture, type Fixture } from './daemon-helpers.js';
import { waitFor } from '../src/testkit/wait-for.js';
import { saveInPlace } from '../src/testkit/save-styles.js';

const CONTENT = '# Corpus doc\n\nParagraph one is here.\n\nParagraph two is here.\n\nParagraph three is here.\n';

let fx: Fixture;

beforeEach(async () => {
  fx = await setupFixture({ content: CONTENT });
});

afterEach(async () => {
  await fx.cleanup();
});

async function expectNoRefight(daemon: ReturnType<Fixture['makeDaemon']>, filePath: string, savedText: string): Promise<void> {
  let sawWritingExport = false;
  const onExport = () => {
    sawWritingExport = true;
  };
  daemon.on('export', onExport);
  try {
    await waitFor(() => readFileSync(filePath, 'utf8') === savedText, 5000);
    // Import handling schedules an export afterward; give it more than its debounce window to fire.
    await new Promise((r) => setTimeout(r, 500));
  } finally {
    daemon.off('export', onExport);
  }
  expect(sawWritingExport).toBe(false);
  expect(readFileSync(filePath, 'utf8')).toBe(savedText);
}

test('gate F: a local save is not rewritten (plain edit)', async () => {
  const daemon = fx.makeDaemon();
  await daemon.start();

  const original = readFileSync(fx.repo.file, 'utf8');
  const saved = original.replace('Paragraph two', 'Paragraph TWO-edited');
  await saveInPlace(fx.repo.file, saved);

  await expectNoRefight(daemon, fx.repo.file, saved);
  await daemon.stop();
});

test('gate F: a local save is not rewritten (half-typed unclosed fence)', async () => {
  const daemon = fx.makeDaemon();
  await daemon.start();

  const original = readFileSync(fx.repo.file, 'utf8');
  const halfTyped = `${original}\n\`\`\`js\nfunction f() {\n  return 1;\n`;
  await saveInPlace(fx.repo.file, halfTyped);

  await expectNoRefight(daemon, fx.repo.file, halfTyped);
  await daemon.stop();
});
