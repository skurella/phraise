// Brief 02, gate B: copy. A selection puts `text/plain` holding Markdown
// (serialized through spike 1's serializer from a document built of the
// slice, with `src` stripped so it re-serializes cleanly) and `text/html`
// holding the rendered HTML. Tested with real Mod-C, reading the clipboard,
// then pasting into a second paragraph with Mod-V and checking the
// Markdown -- the brief's own prescribed method; `clipboard-read`/
// `clipboard-write` are granted below. Uses `e2e/fixtures/copy.md`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page, Locator } from '@playwright/test';
import { test, expect } from './fixtures.js';
import { clickThenShiftClick } from './mouseSelect.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, 'fixtures', 'copy.md');
const DOC = 'copy.md';

test.use({ seedFiles: [{ relpath: DOC, srcPath: FIXTURE }] });

async function openAndWait(page: Page, phraiseServer: { pageUrl(doc: string, user: string): string }): Promise<void> {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(phraiseServer.pageUrl(DOC, 'Alice'));
  await page.waitForFunction(() => (window as unknown as { phraise?: unknown }).phraise != null);
}

async function markdown(page: Page): Promise<string> {
  return page.evaluate(() => (window as unknown as { phraise: { markdown(): string } }).phraise.markdown());
}

function paragraphWithText(page: Page, text: string): Locator {
  return page.locator('#editor .ProseMirror p', { hasText: text }).first();
}

/** Select the given substring inside a paragraph with a real click-then-
 * shift-click (brief 07 fix list: replaces this file's earlier
 * `editor.commands.setTextSelection` version -- the standard mouse
 * gesture for selecting an arbitrary phrase, see `e2e/mouseSelect.ts`). */
async function selectSubstring(page: Page, paragraphText: string, substring: string): Promise<void> {
  const paragraph = paragraphWithText(page, paragraphText);
  await expect(paragraph).toHaveText(paragraphText);
  await clickThenShiftClick(page, { locator: paragraph, substring, edge: 'start' }, { locator: paragraph, substring, edge: 'end' }, substring);
}

async function placeCaretAtEnd(page: Page, paragraphText: string): Promise<void> {
  const paragraph = paragraphWithText(page, paragraphText);
  await expect(paragraph).toHaveText(paragraphText);
  await paragraph.click();
  await expect
    .poll(() => page.evaluate(() => (window as any).phraise.editor.state.selection.$from.parent.textContent))
    .toBe(paragraphText);
  await page.keyboard.press('End');
  await expect
    .poll(() => page.evaluate(() => (window as any).phraise.editor.state.selection.$from.parentOffset))
    .toBe(paragraphText.length);
}

test('[B] copying a same-paragraph selection puts Markdown text/plain and rendered text/html on the clipboard', async ({
  page,
  phraiseServer,
}) => {
  await openAndWait(page, phraiseServer);
  await selectSubstring(page, 'Hello world, this is the source.', 'world');

  await page.keyboard.press('ControlOrMeta+c');
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).not.toBe('');
  const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboardText).toBe('world');

  const html = await page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      if (item.types.includes('text/html')) return (await item.getType('text/html')).text();
    }
    return null;
  });
  expect(html).toContain('world');
});

test('[B] copying a selection spanning two paragraphs strips src, then pasting into a third paragraph reproduces the Markdown', async ({
  page,
  phraiseServer,
}) => {
  const original = fs.readFileSync(FIXTURE, 'utf8');
  await openAndWait(page, phraiseServer);

  // A real click-then-shift-click spanning both paragraphs (brief 07 fix
  // list: replaces the earlier `setTextSelection`-based version).
  const firstParagraph = paragraphWithText(page, 'Hello world, this is the source.');
  const secondParagraph = paragraphWithText(page, 'Second source paragraph here.');
  await expect(firstParagraph).toHaveText('Hello world, this is the source.');
  await expect(secondParagraph).toHaveText('Second source paragraph here.');
  await clickThenShiftClick(
    page,
    { locator: firstParagraph, substring: 'Hello ', edge: 'end' },
    { locator: secondParagraph, substring: 'Second source paragraph here.', edge: 'end' },
    'world, this is the source.\n\nSecond source paragraph here.',
  );

  await page.keyboard.press('ControlOrMeta+c');
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).not.toBe('');
  const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboardText).toBe('world, this is the source.\n\nSecond source paragraph here.');

  await placeCaretAtEnd(page, 'target');
  await page.keyboard.press('ControlOrMeta+v');

  // The clipboard's own text/plain ("world, this is the source.\n\nSecond
  // source paragraph here.") is plain prose with no Markdown construct
  // `looksLikeMarkdown` recognizes (see `src/editing/pasteMarkdown.ts`), so
  // `MarkdownPasteRule` declines and this paste goes through ProseMirror's
  // own default handling of the clipboard's text/html sibling instead --
  // still ending up as the same two paragraphs.
  const expected = original.replace('target', 'targetworld, this is the source.\n\nSecond source paragraph here.');
  await expect.poll(() => markdown(page)).toBe(expected);
});

// Brief 07 fix list: "copy a selection containing bold, a link and a
// two-item list; assert the clipboard's text/plain contains the Markdown
// syntax (**, [..](..), - ) and text/html the tags. The current test
// copies plain words only." A second fixture file, nested under its own
// `test.describe`/`test.use` (the `seedFiles` multi-element-array
// Playwright fixture bug this spike has hit three times before -- see the
// README's "Notes for the next brief" -- so a second seed file always gets
// its own `test.use`, never a second element in the same array).
test.describe('rich selection copy', () => {
  const richFixture = path.join(HERE, 'fixtures', 'copy-rich.md');
  const richDoc = 'copy-rich.md';
  test.use({ seedFiles: [{ relpath: richDoc, srcPath: richFixture }] });

  test('[B] copying a selection spanning bold, a link and a two-item list puts real Markdown syntax on text/plain and real tags on text/html', async ({
    page,
    phraiseServer,
  }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto(phraiseServer.pageUrl(richDoc, 'Alice'));
    await page.waitForFunction(() => (window as unknown as { phraise?: unknown }).phraise != null);

    const richParagraph = paragraphWithText(page, 'This has bold text and a link inside it.');
    const secondListItem = page.locator('#editor .ProseMirror li', { hasText: 'Item two' });
    await expect(richParagraph).toHaveText('This has bold text and a link inside it.');
    await expect(secondListItem).toHaveText('Item two');

    // Select from the start of the bold word through the end of the list --
    // spans a mark (bold), a mark with an attribute (the link), and a
    // separate block-level list with two items.
    await clickThenShiftClick(
      page,
      { locator: richParagraph, substring: 'bold text', edge: 'start' },
      { locator: secondListItem, substring: 'Item two', edge: 'end' },
      'bold text and a link inside it.\n\nItem one\n\nItem two',
    );

    await page.keyboard.press('ControlOrMeta+c');
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).not.toBe('');
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText).toContain('**bold text**');
    expect(clipboardText).toContain('[link](https://example.com/)');
    expect(clipboardText).toContain('- Item one');
    expect(clipboardText).toContain('- Item two');

    const html = await page.evaluate(async () => {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        if (item.types.includes('text/html')) return (await item.getType('text/html')).text();
      }
      return null;
    });
    expect(html).toBeTruthy();
    expect(html).toMatch(/<strong>\s*bold text\s*<\/strong>/);
    expect(html).toMatch(/<a[^>]*href="https:\/\/example\.com\/"[^>]*>\s*link\s*<\/a>/);
    expect(html).toMatch(/<li>/);
    expect(html).toContain('Item one');
    expect(html).toContain('Item two');
  });
});
