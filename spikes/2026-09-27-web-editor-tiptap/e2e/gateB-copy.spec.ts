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

/** Select the given substring inside a paragraph via the editor's own
 * `setTextSelection` (see `gateA-typing.spec.ts`'s builder-log comment for
 * why real Shift-Arrow selection extension proved unreliable in this
 * headless Chromium). What is under test here -- copy/paste -- uses real
 * `page.keyboard` events throughout. */
async function selectSubstring(page: Page, paragraphText: string, substring: string): Promise<void> {
  const paragraph = paragraphWithText(page, paragraphText);
  await expect(paragraph).toHaveText(paragraphText);
  await paragraph.click();
  await expect
    .poll(() => page.evaluate(() => (window as any).phraise.editor.state.selection.$from.parent.textContent))
    .toBe(paragraphText);
  await page.evaluate(
    ({ paragraphText: pText, substring: sub }) => {
      const editor = (window as any).phraise.editor;
      let from = -1;
      let to = -1;
      editor.state.doc.descendants((node: any, pos: number) => {
        if (!node.isText || node.text !== pText) return true;
        const idx = node.text.indexOf(sub);
        from = pos + idx;
        to = from + sub.length;
        return true;
      });
      editor.commands.setTextSelection({ from, to });
    },
    { paragraphText, substring },
  );
  await expect.poll(() => page.evaluate(() => (window as any).phraise.editor.state.selection.empty)).toBe(false);
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

  await selectSubstring(page, 'Hello world, this is the source.', 'world, this is the source.');
  // Extend into the second paragraph via the same `setTextSelection`
  // technique, spanning both paragraphs.
  await page.evaluate(() => {
    const editor = (window as any).phraise.editor;
    let from = -1;
    let to = -1;
    editor.state.doc.descendants((node: any, pos: number) => {
      if (!node.isText) return true;
      if (node.text === 'Hello world, this is the source.') from = pos + 'Hello '.length;
      if (node.text === 'Second source paragraph here.') to = pos + 'Second source paragraph here.'.length;
      return true;
    });
    editor.commands.setTextSelection({ from, to });
  });
  await expect.poll(() => page.evaluate(() => (window as any).phraise.editor.state.selection.empty)).toBe(false);

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
