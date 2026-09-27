// Brief 02, gate A: lists -- Enter to add an item, Enter on an empty item
// to leave the list, Tab to nest, Shift-Tab to lift, in bullet and ordered
// lists. Uses `e2e/fixtures/lists.md`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page, Locator } from '@playwright/test';
import { test, expect } from './fixtures.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, 'fixtures', 'lists.md');
const DOC = 'lists.md';

test.use({ seedFiles: [{ relpath: DOC, srcPath: FIXTURE }] });

async function openAndWait(page: Page, phraiseServer: { pageUrl(doc: string, user: string): string }): Promise<void> {
  await page.goto(phraiseServer.pageUrl(DOC, 'Alice'));
  await page.waitForFunction(() => (window as unknown as { phraise?: unknown }).phraise != null);
}

async function markdown(page: Page): Promise<string> {
  return page.evaluate(() => (window as unknown as { phraise: { markdown(): string } }).phraise.markdown());
}

function listItemWithText(page: Page, text: string): Locator {
  return page.locator('#editor .ProseMirror li', { hasText: text }).first();
}

/** Click into a list item's paragraph and place the caret at `offset`,
 * polling past the two Playwright/browser timing races documented in
 * `gateA-typing.spec.ts`'s `placeCaret`. */
async function placeCaretInItem(page: Page, text: string, offset: number): Promise<void> {
  const item = listItemWithText(page, text);
  await expect(item).toHaveText(text);
  await item.click();
  await expect
    .poll(() => page.evaluate(() => (window as any).phraise.editor.state.selection.$from.parent.textContent))
    .toBe(text);
  await page.keyboard.press('Home');
  for (let i = 0; i < offset; i++) await page.keyboard.press('ArrowRight');
  await expect
    .poll(() => page.evaluate(() => (window as any).phraise.editor.state.selection.$from.parentOffset))
    .toBe(offset);
}

test('[A] Enter adds a bullet-list item', async ({ page, phraiseServer }) => {
  const original = fs.readFileSync(FIXTURE, 'utf8');
  await openAndWait(page, phraiseServer);

  await placeCaretInItem(page, 'Second item', 'Second item'.length);
  await page.keyboard.press('Enter');
  await page.keyboard.type('New item');

  const expected = original.replace('- Second item\n- Third item', '- Second item\n- New item\n- Third item');
  await expect.poll(() => markdown(page)).toBe(expected);
});

test('[A] Enter on an empty bullet-list item leaves the list', async ({ page, phraiseServer }) => {
  const original = fs.readFileSync(FIXTURE, 'utf8');
  await openAndWait(page, phraiseServer);

  // Empty the last item ("Third item") first (one Backspace per character,
  // from its end -- a Shift-End-then-Backspace approach was tried first and
  // found to extend the selection far past the current line in this
  // headless Chromium, deleting into the following ordered list; see the
  // builder log), then press Enter on it.
  await placeCaretInItem(page, 'Third item', 'Third item'.length);
  for (let i = 0; i < 'Third item'.length; i++) await page.keyboard.press('Backspace');
  await expect.poll(() => page.evaluate(() => (window as any).phraise.editor.state.selection.$from.parent.textContent)).toBe('');
  await page.keyboard.press('Enter');
  // The lifted item is now a genuinely empty top-level paragraph. An empty
  // paragraph has no Markdown representation at all (blank text parses to
  // zero blocks, not one empty paragraph), so `serializeDoc` would
  // correctly throw `UnverifiedSerializationError` on it right now -- exactly
  // as it should, since Phraise never writes a file whose meaning differs
  // from the document (this spike's whole `serializeDoc` design). A real
  // user leaving the list this way always keeps typing next, so the
  // realistic (and testable) end state is after that: type into the new
  // paragraph, THEN check the Markdown.
  await page.keyboard.type('New paragraph');

  const expected = original.replace('- First item\n- Second item\n- Third item\n\n1.', '- First item\n- Second item\n\nNew paragraph\n\n1.');
  await expect.poll(() => markdown(page)).toBe(expected);
});

test('[A] Tab nests a bullet-list item under the previous one', async ({ page, phraiseServer }) => {
  const original = fs.readFileSync(FIXTURE, 'utf8');
  await openAndWait(page, phraiseServer);

  await placeCaretInItem(page, 'Second item', 0);
  await page.keyboard.press('Tab');

  const expected = original.replace('- First item\n- Second item\n- Third item', '- First item\n  - Second item\n- Third item');
  await expect.poll(() => markdown(page)).toBe(expected);
});

test('[A] Shift-Tab lifts a nested bullet-list item back out', async ({ page, phraiseServer }) => {
  const original = fs.readFileSync(FIXTURE, 'utf8');
  await openAndWait(page, phraiseServer);

  await placeCaretInItem(page, 'Second item', 0);
  await page.keyboard.press('Tab');
  await expect
    .poll(() => markdown(page))
    .toBe(original.replace('- First item\n- Second item\n- Third item', '- First item\n  - Second item\n- Third item'));

  await page.keyboard.press('Shift+Tab');
  await expect.poll(() => markdown(page)).toBe(original);
});

test('[A] Enter adds an ordered-list item, renumbered', async ({ page, phraiseServer }) => {
  const original = fs.readFileSync(FIXTURE, 'utf8');
  await openAndWait(page, phraiseServer);

  await placeCaretInItem(page, 'One', 'One'.length);
  await page.keyboard.press('Enter');
  await page.keyboard.type('New');

  const expected = original.replace('1. One\n2. Two\n3. Three', '1. One\n2. New\n3. Two\n4. Three');
  await expect.poll(() => markdown(page)).toBe(expected);
});

test('[A] Tab nests an ordered-list item', async ({ page, phraiseServer }) => {
  const original = fs.readFileSync(FIXTURE, 'utf8');
  await openAndWait(page, phraiseServer);

  await placeCaretInItem(page, 'Two', 0);
  await page.keyboard.press('Tab');

  const expected = original.replace('1. One\n2. Two\n3. Three', '1. One\n   1. Two\n2. Three');
  await expect.poll(() => markdown(page)).toBe(expected);
});
