// Brief 02, gate B: paste. text/plain that is Markdown becomes rich content
// through spike 1's `parseMarkdown`; text/html from another app goes
// through the schema's `parseDOM`; a paste into the middle of a paragraph
// of a single-line Markdown fragment stays inline. Uses
// `e2e/fixtures/paste.md` ("Neighbour before." / "target" / "Neighbour
// after.").
//
// Dispatches a real `ClipboardEvent` with a real `DataTransfer` rather than
// driving the OS clipboard through Mod-V: this is the brief's documented
// fallback ("if real clipboard shortcuts cannot be driven in headless
// Chromium on this machine, dispatch a real ClipboardEvent with a
// DataTransfer instead, and say so in the test title and log"), chosen
// upfront here (not after Mod-V failed) because simulating a paste FROM
// ANOTHER APPLICATION is what is actually under test -- there is no other
// app's clipboard to Mod-C from in this harness, so constructing the
// DataTransfer directly is the faithful way to represent "some external
// content arrived in the clipboard", whereas gate B's copy tests (a
// same-page round trip) do drive Mod-C/Mod-V for real.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page, Locator } from '@playwright/test';
import { test, expect } from './fixtures.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, 'fixtures', 'paste.md');
const DOC = 'paste.md';

test.use({ seedFiles: [{ relpath: DOC, srcPath: FIXTURE }] });

async function openAndWait(page: Page, phraiseServer: { pageUrl(doc: string, user: string): string }): Promise<void> {
  await page.goto(phraiseServer.pageUrl(DOC, 'Alice'));
  await page.waitForFunction(() => (window as unknown as { phraise?: unknown }).phraise != null);
}

async function markdown(page: Page): Promise<string> {
  return page.evaluate(() => (window as unknown as { phraise: { markdown(): string } }).phraise.markdown());
}

function target(page: Page): Locator {
  return page.locator('#editor .ProseMirror p', { hasText: 'target' }).first();
}

async function focusTarget(page: Page, offset: number): Promise<void> {
  const el = target(page);
  await expect(el).toHaveText('target');
  await el.click();
  await expect
    .poll(() => page.evaluate(() => (window as any).phraise.editor.state.selection.$from.parent.textContent))
    .toBe('target');
  await page.keyboard.press('Home');
  for (let i = 0; i < offset; i++) await page.keyboard.press('ArrowRight');
  await expect.poll(() => page.evaluate(() => (window as any).phraise.editor.state.selection.$from.parentOffset)).toBe(offset);
}

async function clearTarget(page: Page): Promise<void> {
  await focusTarget(page, 'target'.length);
  for (let i = 0; i < 'target'.length; i++) await page.keyboard.press('Backspace');
  await expect.poll(() => page.evaluate(() => (window as any).phraise.editor.state.selection.$from.parent.textContent)).toBe('');
}

/** Dispatch a real `ClipboardEvent('paste', ...)` with a real `DataTransfer`
 * carrying the given MIME payloads, targeting the focused ProseMirror
 * editable element. */
async function dispatchPaste(page: Page, data: Record<string, string>): Promise<void> {
  await page.evaluate((payload) => {
    const dt = new DataTransfer();
    for (const [type, value] of Object.entries(payload)) dt.setData(type, value);
    const el = document.querySelector('#editor .ProseMirror')!;
    const event = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
    el.dispatchEvent(event);
  }, data);
}

test('[B] pasting Markdown text/plain (heading, list, bold, link) becomes rich block content', async ({ page, phraiseServer }) => {
  const original = fs.readFileSync(FIXTURE, 'utf8');
  await openAndWait(page, phraiseServer);
  await clearTarget(page);

  const pasted = '# Pasted Heading\n\n- one\n- two\n\nSome **bold** and a [link](https://example.com/x).';
  await dispatchPaste(page, { 'text/plain': pasted });

  const expected = original.replace('target', pasted);
  await expect.poll(() => markdown(page)).toBe(expected);
});

test('[B] pasting Markdown text/plain (a table) becomes a rich table', async ({ page, phraiseServer }) => {
  const original = fs.readFileSync(FIXTURE, 'utf8');
  await openAndWait(page, phraiseServer);
  await clearTarget(page);

  const pasted = '| A | B |\n| - | - |\n| 1 | 2 |';
  await dispatchPaste(page, { 'text/plain': pasted });

  await expect
    .poll(() => page.evaluate(() => (window as any).phraise.editor.state.doc.child(1).type.name))
    .toBe('table');
  const expected = original.replace('target', pasted);
  await expect.poll(() => markdown(page)).toBe(expected);
});

test('[B] pasting Markdown text/plain (a fenced code block) becomes a rich code block', async ({ page, phraiseServer }) => {
  const original = fs.readFileSync(FIXTURE, 'utf8');
  await openAndWait(page, phraiseServer);
  await clearTarget(page);

  const pasted = '```js\nconsole.log(1);\n```';
  await dispatchPaste(page, { 'text/plain': pasted });

  await expect
    .poll(() => page.evaluate(() => (window as any).phraise.editor.state.doc.child(1).attrs.lang))
    .toBe('js');
  const expected = original.replace('target', pasted);
  await expect.poll(() => markdown(page)).toBe(expected);
});

test('[B] pasting a single-line Markdown fragment mid-paragraph stays inline', async ({ page, phraiseServer }) => {
  const original = fs.readFileSync(FIXTURE, 'utf8');
  await openAndWait(page, phraiseServer);
  await focusTarget(page, 'tar'.length);

  await dispatchPaste(page, { 'text/plain': 'very **bold** stuff' });

  // Still exactly one paragraph, not split into more blocks.
  await expect.poll(() => page.evaluate(() => (window as any).phraise.editor.state.doc.childCount)).toBe(3);
  const expected = original.replace('target', 'tarvery **bold** stuffget');
  await expect.poll(() => markdown(page)).toBe(expected);
});

test('[B] pasting text/html from another app goes through the schema\'s parseDOM', async ({ page, phraiseServer }) => {
  const original = fs.readFileSync(FIXTURE, 'utf8');
  await openAndWait(page, phraiseServer);
  await clearTarget(page);

  // Plain prose (not recognized as Markdown by `looksLikeMarkdown`) paired
  // with an HTML payload: the plugin declines (falls through to
  // ProseMirror's own default paste handling, which parses text/html via
  // the schema's `parseDOM`), so the HTML's <strong> becomes a real bold
  // mark, not literal asterisks.
  await dispatchPaste(page, {
    'text/plain': 'Some bold text',
    'text/html': '<p>Some <strong>bold</strong> text</p>',
  });

  await expect
    .poll(() =>
      page.evaluate(() => {
        const editor = (window as any).phraise.editor;
        let found = false;
        editor.state.doc.descendants((node: any) => {
          if (node.isText && node.marks.some((m: any) => m.type.name === 'strong') && node.text === 'bold') found = true;
        });
        return found;
      }),
    )
    .toBe(true);
  const expected = original.replace('target', 'Some **bold** text');
  await expect.poll(() => markdown(page)).toBe(expected);
});
