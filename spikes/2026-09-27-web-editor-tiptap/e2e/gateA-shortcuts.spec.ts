// Brief 02, gate A: Mod-B, Mod-I, Mod-E, and Mod-K's link field, on
// `e2e/fixtures/shortcuts.md` (a target word between two untouched
// paragraphs). `ControlOrMeta` is used throughout so these work on both
// macOS and Linux.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page, Locator } from '@playwright/test';
import { test, expect } from './fixtures.js';

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

/** Select the word "word" inside "Select this word for formatting.".
 *
 * Clicks the paragraph first (to focus the editor -- a real user action),
 * then sets the selection via the editor's own `setTextSelection` command,
 * computed from the live doc's real text position. `gateA-typing.spec.ts`'s
 * builder-log comment covers why: real `Shift-ArrowRight` sequences raced
 * ahead of the browser's own caret movement in this headless Chromium and
 * produced the wrong range. What is actually under test here (a keyboard
 * shortcut applied to an existing selection) still uses real
 * `page.keyboard` events throughout. */
async function selectWord(page: Page): Promise<void> {
  const paragraph = paragraphWithText(page, 'Select this word for formatting.');
  await expect(paragraph).toHaveText('Select this word for formatting.');
  await paragraph.click();
  await expect
    .poll(() => page.evaluate(() => (window as any).phraise.editor.state.selection.$from.parent.textContent))
    .toBe('Select this word for formatting.');
  await page.evaluate(() => {
    const editor = (window as unknown as { phraise: { editor: import('@tiptap/core').Editor } }).phraise.editor;
    let from = -1;
    let to = -1;
    editor.state.doc.descendants((node, pos) => {
      if (!node.isText || node.text !== 'Select this word for formatting.') return true;
      const idx = node.text.indexOf('word');
      from = pos + idx;
      to = from + 'word'.length;
      return true;
    });
    editor.commands.setTextSelection({ from, to });
  });
  await expect.poll(() => page.evaluate(() => (window as any).phraise.editor.state.selection.empty)).toBe(false);
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
