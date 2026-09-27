// Brief 02, gate A: Mod-B, Mod-I, Mod-E, and Mod-K's link field, on
// `e2e/fixtures/shortcuts.md` (a target word between two untouched
// paragraphs). `ControlOrMeta` is used throughout so these work on both
// macOS and Linux.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page, Locator } from '@playwright/test';
import { test, expect } from './fixtures.js';
import { dblClickWord } from './mouseSelect.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, 'fixtures', 'shortcuts.md');
const DOC = 'shortcuts.md';

test.use({ seedFiles: [{ relpath: DOC, srcPath: FIXTURE }] });

async function openAndWait(page: Page, phraiseServer: { pageUrl(doc: string, user: string): string }): Promise<void> {
  await page.goto(phraiseServer.pageUrl(DOC, 'Alice'));
  await page.waitForFunction(() => (window as unknown as { phraise?: unknown }).phraise != null);
}

async function markdown(page: Page): Promise<string> {
  return page.evaluate(() => (window as unknown as { phraise: { markdown(): string } }).phraise.markdown());
}

function paragraphWithText(page: Page, text: string): Locator {
  return page.locator('#editor .ProseMirror p', { hasText: text }).first();
}

/** Select the word "word" inside "Select this word for formatting." with a
 * real double-click -- the natural mouse gesture for selecting one word
 * (see `e2e/mouseSelect.ts`). Brief 07 fix list: this replaces the earlier
 * `editor.commands.setTextSelection` version -- a real double-click turned
 * out to be perfectly reliable here (no race, no retry needed), so the
 * `setTextSelection` fallback this file's builder-log comment used to cite
 * was a workaround for a DIFFERENT technique (`Shift-ArrowRight`), not
 * evidence double-click itself was ever tried and found wanting. */
async function selectWord(page: Page): Promise<void> {
  const paragraph = paragraphWithText(page, 'Select this word for formatting.');
  await expect(paragraph).toHaveText('Select this word for formatting.');
  await dblClickWord(page, paragraph, 'word'); // verifies the selection itself; see e2e/mouseSelect.ts.
}

test('[A] Mod-B toggles bold on a selected word, and toggles it off again', async ({ page, phraiseServer }) => {
  const original = fs.readFileSync(FIXTURE, 'utf8');
  await openAndWait(page, phraiseServer);
  await selectWord(page);

  await page.keyboard.press('ControlOrMeta+b');
  const bolded = original.replace('Select this word for formatting.', 'Select this **word** for formatting.');
  await expect.poll(() => markdown(page)).toBe(bolded);

  await page.keyboard.press('ControlOrMeta+b');
  await expect.poll(() => markdown(page)).toBe(original);
});

test('[A] Mod-I toggles italic on a selected word', async ({ page, phraiseServer }) => {
  const original = fs.readFileSync(FIXTURE, 'utf8');
  await openAndWait(page, phraiseServer);
  await selectWord(page);

  await page.keyboard.press('ControlOrMeta+i');
  // The document has no existing emphasis to detect a style from, so the
  // serializer falls back to the schema's own default emphasis marker (`*`).
  const italic = original.replace('Select this word for formatting.', 'Select this *word* for formatting.');
  await expect.poll(() => markdown(page)).toBe(italic);
});

test('[A] Mod-E toggles inline code on a selected word (Google Docs has no shortcut for this; Mod-E is this spike\'s own choice)', async ({
  page,
  phraiseServer,
}) => {
  const original = fs.readFileSync(FIXTURE, 'utf8');
  await openAndWait(page, phraiseServer);
  await selectWord(page);

  await page.keyboard.press('ControlOrMeta+e');
  const coded = original.replace('Select this word for formatting.', 'Select this `word` for formatting.');
  await expect.poll(() => markdown(page)).toBe(coded);
});

test('[A] Mod-K opens a link field; Enter applies the link', async ({ page, phraiseServer }) => {
  const original = fs.readFileSync(FIXTURE, 'utf8');
  await openAndWait(page, phraiseServer);
  await selectWord(page);

  await page.keyboard.press('ControlOrMeta+k');
  const popup = page.locator('#phraise-link-popup');
  await expect(popup).toBeVisible();
  const input = popup.locator('input');
  await expect(input).toBeFocused();
  await input.fill('https://example.com');
  await page.keyboard.press('Enter');

  await expect(popup).toBeHidden();
  const linked = original.replace('Select this word for formatting.', 'Select this [word](https://example.com) for formatting.');
  await expect.poll(() => markdown(page)).toBe(linked);
});

test('[A] Mod-K then Escape cancels without applying a link', async ({ page, phraiseServer }) => {
  const original = fs.readFileSync(FIXTURE, 'utf8');
  await openAndWait(page, phraiseServer);
  await selectWord(page);

  await page.keyboard.press('ControlOrMeta+k');
  const popup = page.locator('#phraise-link-popup');
  await expect(popup).toBeVisible();
  await popup.locator('input').fill('https://example.com');
  await page.keyboard.press('Escape');

  await expect(popup).toBeHidden();
  await expect.poll(() => markdown(page)).toBe(original);
});
