// Brief 02, gate A: tables -- click a cell and type; Tab and Shift-Tab move
// between cells; Tab in the last cell does not insert a tab character.
// Adding rows/columns is not required. Uses `e2e/fixtures/table.md`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page, Locator } from '@playwright/test';
import { test, expect } from './fixtures.js';
import { LINE_END } from './keys.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, 'fixtures', 'table.md');
const DOC = 'table.md';

test.use({ seedFiles: [{ relpath: DOC, srcPath: FIXTURE }] });

async function openAndWait(page: Page, phraiseServer: { pageUrl(doc: string, user: string): string }): Promise<void> {
  await page.goto(phraiseServer.pageUrl(DOC, 'Alice'));
  await page.waitForFunction(() => (window as unknown as { phraise?: unknown }).phraise != null);
}

async function markdown(page: Page): Promise<string> {
  return page.evaluate(() => (window as unknown as { phraise: { markdown(): string } }).phraise.markdown());
}

function cellWithText(page: Page, text: string): Locator {
  return page.locator('#editor .ProseMirror td', { hasText: text }).first();
}

/** Click into a table cell (exact text match, so "a1" does not also match
 * inside a longer cell) and confirm the editor's selection actually landed
 * there before proceeding -- the same click/selection race documented in
 * `gateA-typing.spec.ts`. */
async function clickCell(page: Page, text: string): Promise<void> {
  const cell = page.locator('#editor .ProseMirror td').filter({ hasText: new RegExp(`^${text}$`) });
  await expect(cell).toHaveText(text);
  await cell.click();
  await expect
    .poll(() => page.evaluate(() => (window as any).phraise.editor.state.selection.$from.parent.textContent))
    .toBe(text);
}

test('[A] click a cell and type', async ({ page, phraiseServer }) => {
  const original = fs.readFileSync(FIXTURE, 'utf8');
  await openAndWait(page, phraiseServer);

  await clickCell(page, 'a1');
  await page.keyboard.press(LINE_END);
  await expect.poll(() => page.evaluate(() => (window as any).phraise.editor.state.selection.$from.parentOffset)).toBe('a1'.length);
  await page.keyboard.type('X');

  const expected = original.replace('| a1 | b1 |', '| a1X | b1 |');
  await expect.poll(() => markdown(page)).toBe(expected);
});

test('[A] Tab moves to the next cell in the same row', async ({ page, phraiseServer }) => {
  await openAndWait(page, phraiseServer);

  await clickCell(page, 'a1');
  await page.keyboard.press('Tab');
  await expect
    .poll(() => page.evaluate(() => (window as any).phraise.editor.state.selection.$from.parent.textContent))
    .toBe('b1');
});

test('[A] Tab in the last cell of a row wraps to the first cell of the next row', async ({ page, phraiseServer }) => {
  await openAndWait(page, phraiseServer);

  await clickCell(page, 'b1');
  await page.keyboard.press('Tab');
  await expect
    .poll(() => page.evaluate(() => (window as any).phraise.editor.state.selection.$from.parent.textContent))
    .toBe('a2');
});

test('[A] Shift-Tab moves to the previous cell', async ({ page, phraiseServer }) => {
  await openAndWait(page, phraiseServer);

  await clickCell(page, 'b1');
  await page.keyboard.press('Shift+Tab');
  await expect
    .poll(() => page.evaluate(() => (window as any).phraise.editor.state.selection.$from.parent.textContent))
    .toBe('a1');
});

test('[A] Tab in the very last cell does not insert a tab character', async ({ page, phraiseServer }) => {
  const original = fs.readFileSync(FIXTURE, 'utf8');
  await openAndWait(page, phraiseServer);

  await clickCell(page, 'b2');
  await page.keyboard.press(LINE_END);
  await page.keyboard.press('Tab');

  // No cell to move to and no tab character inserted: the document is
  // unchanged.
  await expect.poll(() => markdown(page)).toBe(original);
  await expect
    .poll(() => page.evaluate(() => (window as any).phraise.editor.state.selection.$from.parent.textContent))
    .toBe('b2');
});
