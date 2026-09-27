// Brief 01, task 7, gate A smoke test: open a handwritten fixture in
// Chromium, click into the first paragraph's end, type ' hello' with real
// keyboard events, and assert window.phraise.markdown() equals the original
// with exactly that change; then open the Markdown panel and see the text.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from './fixtures.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CORPUS_DIR = path.resolve(HERE, '..', 'corpus', 'handwritten');
const FIXTURE = 'no-trailing-newline.md';

test.use({ seedFiles: [{ relpath: FIXTURE, srcPath: path.join(CORPUS_DIR, FIXTURE) }] });

test('[A] smoke: type into the first paragraph and it round-trips exactly', async ({ page, phraiseServer }) => {
  const original = fs.readFileSync(path.join(CORPUS_DIR, FIXTURE), 'utf8');
  // Sanity check on the fixture itself, so a future edit to the fixture
  // fails loudly here instead of producing a confusing assertion below.
  expect(original).toBe('# No Trailing Newline\n\nThis file ends without a newline.\n\nParagraph here with text.');

  await page.goto(phraiseServer.pageUrl(FIXTURE, 'Alice'));
  await page.waitForFunction(() => (window as unknown as { phraise?: unknown }).phraise != null);

  const firstParagraph = page.locator('#editor .ProseMirror p').first();
  await expect(firstParagraph).toHaveText('This file ends without a newline.');
  await firstParagraph.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' hello');

  const expected = original.replace('This file ends without a newline.', 'This file ends without a newline. hello');
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { phraise: { markdown(): string } }).phraise.markdown()))
    .toBe(expected);

  await page.getByRole('button', { name: 'Markdown' }).click();
  await expect(page.locator('#markdown-panel')).toBeVisible();
  await expect(page.locator('#markdown-output')).toContainText('This file ends without a newline. hello');
});
