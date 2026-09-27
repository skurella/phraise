// Brief 02, gate B: input rules at the start of an empty or plain paragraph
// -- `# ` through `###### `, `- ` and `* `, `1. `, `> `, a code fence
// (typing ``` then Enter, and ```js then Enter giving `lang: js`), `---`
// then Enter for a thematic break, and Backspace right after any of them
// undoes it back to plain text. Uses `e2e/fixtures/input-rules.md`
// ("Neighbour before." / "placeholder" / "Neighbour after."): every test
// asserts the full serialized Markdown, so the two neighbours prove nothing
// outside the target paragraph moved.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page, Locator } from '@playwright/test';
import { test, expect } from './fixtures.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, 'fixtures', 'input-rules.md');
const DOC = 'input-rules.md';

test.use({ seedFiles: [{ relpath: DOC, srcPath: FIXTURE }] });

async function openAndWait(page: Page, phraiseServer: { pageUrl(doc: string, user: string): string }): Promise<void> {
  await page.goto(phraiseServer.pageUrl(DOC, 'Alice'));
  await page.waitForFunction(() => (window as unknown as { phraise?: unknown }).phraise != null);
}

async function markdown(page: Page): Promise<string> {
  return page.evaluate(() => (window as unknown as { phraise: { markdown(): string } }).phraise.markdown());
}

function target(page: Page): Locator {
  return page.locator('#editor .ProseMirror p, #editor .ProseMirror h1, #editor .ProseMirror h2', { hasText: 'placeholder' }).first();
}

/** Click into the "placeholder" paragraph and place the caret at its start. */
async function focusTarget(page: Page): Promise<void> {
  const el = target(page);
  await expect(el).toHaveText('placeholder');
  await el.click();
  await expect
    .poll(() => page.evaluate(() => (window as any).phraise.editor.state.selection.$from.parent.textContent))
    .toBe('placeholder');
  await page.keyboard.press('Home');
  await expect.poll(() => page.evaluate(() => (window as any).phraise.editor.state.selection.$from.parentOffset)).toBe(0);
}

/** Clear the placeholder paragraph's text entirely (for the fence/
 * thematic-break scenarios, which match the whole paragraph text). */
async function clearTarget(page: Page): Promise<void> {
  await focusTarget(page);
  await page.keyboard.press('End');
  await expect
    .poll(() => page.evaluate(() => (window as any).phraise.editor.state.selection.$from.parentOffset))
    .toBe('placeholder'.length);
  for (let i = 0; i < 'placeholder'.length; i++) await page.keyboard.press('Backspace');
  await expect.poll(() => page.evaluate(() => (window as any).phraise.editor.state.selection.$from.parent.textContent)).toBe('');
}

for (let level = 1; level <= 6; level++) {
  test(`[B] "${'#'.repeat(level)} " converts an empty/plain paragraph to a level-${level} heading`, async ({ page, phraiseServer }) => {
    const original = fs.readFileSync(FIXTURE, 'utf8');
    await openAndWait(page, phraiseServer);
    await focusTarget(page);

    await page.keyboard.type('#'.repeat(level) + ' ');

    const expected = original.replace('placeholder', `${'#'.repeat(level)} placeholder`);
    await expect.poll(() => markdown(page)).toBe(expected);
  });
}

test('[B] "- " converts to a bullet list', async ({ page, phraiseServer }) => {
  const original = fs.readFileSync(FIXTURE, 'utf8');
  await openAndWait(page, phraiseServer);
  await focusTarget(page);

  await page.keyboard.type('- ');

  const expected = original.replace('placeholder', '- placeholder');
  await expect.poll(() => markdown(page)).toBe(expected);
});

test('[B] "* " converts to a bullet list', async ({ page, phraiseServer }) => {
  const original = fs.readFileSync(FIXTURE, 'utf8');
  await openAndWait(page, phraiseServer);
  await focusTarget(page);

  await page.keyboard.type('* ');

  const expected = original.replace('placeholder', '* placeholder');
  await expect.poll(() => markdown(page)).toBe(expected);
});

test('[B] "1. " converts to an ordered list', async ({ page, phraiseServer }) => {
  const original = fs.readFileSync(FIXTURE, 'utf8');
  await openAndWait(page, phraiseServer);
  await focusTarget(page);

  await page.keyboard.type('1. ');

  const expected = original.replace('placeholder', '1. placeholder');
  await expect.poll(() => markdown(page)).toBe(expected);
});

test('[B] "> " converts to a blockquote', async ({ page, phraiseServer }) => {
  const original = fs.readFileSync(FIXTURE, 'utf8');
  await openAndWait(page, phraiseServer);
  await focusTarget(page);

  await page.keyboard.type('> ');

  const expected = original.replace('placeholder', '> placeholder');
  await expect.poll(() => markdown(page)).toBe(expected);
});

test('[B] a bare ``` fence then Enter converts to an empty code block', async ({ page, phraiseServer }) => {
  const original = fs.readFileSync(FIXTURE, 'utf8');
  await openAndWait(page, phraiseServer);
  await clearTarget(page);

  await page.keyboard.type('```');
  await page.keyboard.press('Enter');
  await page.keyboard.type('code here');

  const expected = original.replace('placeholder', '```\ncode here\n```');
  await expect.poll(() => markdown(page)).toBe(expected);
});

test('[B] "```js" then Enter converts to a code block with lang: js', async ({ page, phraiseServer }) => {
  const original = fs.readFileSync(FIXTURE, 'utf8');
  await openAndWait(page, phraiseServer);
  await clearTarget(page);

  await page.keyboard.type('```js');
  await page.keyboard.press('Enter');
  await page.keyboard.type('console.log(1)');

  const expected = original.replace('placeholder', '```js\nconsole.log(1)\n```');
  await expect.poll(() => markdown(page)).toBe(expected);
});

test('[B] "---" then Enter converts to a thematic break', async ({ page, phraiseServer }) => {
  const original = fs.readFileSync(FIXTURE, 'utf8');
  await openAndWait(page, phraiseServer);
  await clearTarget(page);

  await page.keyboard.type('---');
  await page.keyboard.press('Enter');

  // A next sibling ("Neighbour after.") already exists, so no extra empty
  // paragraph is inserted after the rule -- the cursor lands at the start
  // of that existing paragraph instead.
  const expected = original.replace('placeholder', '---');
  await expect.poll(() => markdown(page)).toBe(expected);
});

test('[B] Backspace right after "# " undoes it back to plain text', async ({ page, phraiseServer }) => {
  const original = fs.readFileSync(FIXTURE, 'utf8');
  await openAndWait(page, phraiseServer);
  await focusTarget(page);

  await page.keyboard.type('# ');
  await expect.poll(() => markdown(page)).toBe(original.replace('placeholder', '# placeholder'));

  // The restored text literally starts with "# ", which would be
  // misparsed as a heading again on reparse -- the serializer correctly
  // escapes the leading `#` to keep it as plain text.
  await page.keyboard.press('Backspace');
  await expect.poll(() => markdown(page)).toBe(original.replace('placeholder', '\\# placeholder'));
});

test('[B] Backspace right after a bare ``` fence undoes it back to plain text', async ({ page, phraiseServer }) => {
  const original = fs.readFileSync(FIXTURE, 'utf8');
  await openAndWait(page, phraiseServer);
  await clearTarget(page);

  await page.keyboard.type('```');
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => (window as any).phraise.editor.state.selection.$from.parent.type.name)).toBe('code_block');

  // The restored text literally starts with "```", which would be
  // misparsed as a fence marker again on reparse -- the serializer escapes
  // the leading backtick.
  await page.keyboard.press('Backspace');
  await expect.poll(() => markdown(page)).toBe(original.replace('placeholder', '\\`\\`\\`'));
});

// "Backspace right after `---`" only lands the cursor in a freshly-created
// EMPTY paragraph (the state the structural undo in
// `enterConversions.ts` looks for) when there is no existing next sibling
// to reuse -- with `input-rules.md`'s trailing "Neighbour after."
// paragraph, the cursor instead lands at the start of that (non-empty)
// paragraph, and Backspace there is a normal join/select against the rule,
// not an undo (this is a real, deliberate scope edge documented here, not a
// bug: see `enterConversions.ts`'s comment on why the undo is structural
// rather than tracked). A separate fixture with "placeholder" as the LAST
// block exercises the actual undo path.
test.describe('thematic-break Backspace-undo (placeholder as the last block)', () => {
  test.use({ seedFiles: [{ relpath: 'input-rules-last.md', srcPath: path.join(HERE, 'fixtures', 'input-rules-last.md') }] });

  test('[B] Backspace right after "---" undoes it back to plain text', async ({ page, phraiseServer }) => {
    const fixture = path.join(HERE, 'fixtures', 'input-rules-last.md');
    const original = fs.readFileSync(fixture, 'utf8');
    await page.goto(phraiseServer.pageUrl('input-rules-last.md', 'Alice'));
    await page.waitForFunction(() => (window as unknown as { phraise?: unknown }).phraise != null);

    const el = target(page);
    await expect(el).toHaveText('placeholder');
    await el.click();
    await expect
      .poll(() => page.evaluate(() => (window as any).phraise.editor.state.selection.$from.parent.textContent))
      .toBe('placeholder');
    await page.keyboard.press('End');
    for (let i = 0; i < 'placeholder'.length; i++) await page.keyboard.press('Backspace');
    await expect.poll(() => page.evaluate(() => (window as any).phraise.editor.state.selection.$from.parent.textContent)).toBe('');

    await page.keyboard.type('---');
    await page.keyboard.press('Enter');
    await expect
      .poll(() => page.evaluate(() => (window as any).phraise.editor.state.doc.child(1).type.name))
      .toBe('horizontal_rule');

    // The restored text literally starts with "---", ambiguous with a
    // thematic break (or a setext heading underline) on reparse -- the
    // serializer escapes the leading dash.
    await page.keyboard.press('Backspace');
    await expect.poll(() => markdown(page)).toBe(original.replace('placeholder', '\\---'));
  });
});
