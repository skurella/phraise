// Brief 02, gate A: typing, with real keyboard events. Each scenario is its
// own test titled `[A] ...`, using `e2e/fixtures/typing.md`, which has
// several paragraphs (and a heading, and a list) so an edit to one leaves
// its neighbours byte-identical by construction: every test asserts the
// FULL serialized Markdown against an expected string built from the
// original file text.
//
// Caret placement uses real keyboard navigation (Home, then ArrowRight N
// times, or Shift-ArrowRight for a selection) rather than scripting the DOM
// Selection object directly, per the brief's "real keyboard events
// (`page.keyboard`)".
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page, Locator } from '@playwright/test';
import { test, expect } from './fixtures.js';
import { LINE_START } from './keys.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, 'fixtures', 'typing.md');
const DOC = 'typing.md';

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

async function selectionParentOffset(page: Page): Promise<{ text: string; offset: number }> {
  return page.evaluate(() => {
    const editor = (window as unknown as { phraise: { editor: import('@tiptap/core').Editor } }).phraise.editor;
    const { $from } = editor.state.selection;
    return { text: $from.parent.textContent, offset: $from.parentOffset };
  });
}

/** Click into a paragraph and move the caret to `offset` from its start via
 * real keyboard events (Home then ArrowRight, matching the brief's ask for
 * real `page.keyboard`-driven interaction).
 *
 * Two races confirmed by observing this fail (see the builder log) before
 * adding the waits below, both because a plain Playwright `.click()`/
 * `.press()` resolves as soon as the DOM event is dispatched, not once
 * ProseMirror's `EditorView` has caught up and applied the resulting
 * selection change to `state.selection`:
 *  - `Home` sent immediately after `.click()` acted on the OLD selection
 *    (the doc's initial default, position 1) instead of the just-clicked
 *    paragraph;
 *  - a tight loop of `ArrowRight` presses with no delay between them raced
 *    ahead of the browser's own native caret movement in this headless
 *    Chromium, so most of the presses were lost (`Enter` ended up splitting
 *    at the original offset, not the intended one).
 * Polling for the actual end state after each risky step avoids both. */
async function placeCaret(page: Page, locator: Locator, expectedText: string, offset: number): Promise<void> {
  await locator.click();
  await expect.poll(async () => (await selectionParentOffset(page)).text).toBe(expectedText);
  await page.keyboard.press(LINE_START);
  for (let i = 0; i < offset; i++) await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await selectionParentOffset(page)).offset).toBe(offset);
}

/** Same, but extends a selection from the current caret by `count`
 * characters using Shift-ArrowRight. */
async function extendSelection(page: Page, count: number): Promise<void> {
  for (let i = 0; i < count; i++) await page.keyboard.press('Shift+ArrowRight');
}

async function selectionHead(page: Page): Promise<{ text: string; offset: number }> {
  return page.evaluate(() => {
    const editor = (window as unknown as { phraise: { editor: import('@tiptap/core').Editor } }).phraise.editor;
    const { $head } = editor.state.selection;
    return { text: $head.parent.textContent, offset: $head.parentOffset };
  });
}

/** Extend the current selection to the right, one real Shift-ArrowRight at
 * a time (including across a paragraph boundary), until its head reaches
 * the given paragraph text and offset. Brief 07 fix list: replaces this
 * file's earlier `setTextSelection`-based cross-paragraph selection --
 * real cross-block Shift-ArrowRight DOES work in this headless Chromium
 * (the orchestrator's own confirmed technique), provided each press's
 * effect on `editor.state.selection` is polled to settle before checking
 * it or sending the next one: the browser's own `selectionchange` is
 * asynchronous relative to `page.keyboard.press()` resolving, so reading
 * the selection immediately after a press can see the PREVIOUS value. */
async function extendSelectionAcrossBlocksTo(page: Page, targetText: string, targetOffset: number, maxPresses = 100): Promise<void> {
  for (let i = 0; i < maxPresses; i++) {
    const before = await selectionHead(page);
    if (before.text === targetText && before.offset === targetOffset) return;
    await page.keyboard.press('Shift+ArrowRight');
    await expect.poll(async () => JSON.stringify(await selectionHead(page))).not.toBe(JSON.stringify(before));
  }
  throw new Error(
    `extendSelectionAcrossBlocksTo: selection head did not reach {text: ${JSON.stringify(targetText)}, offset: ${targetOffset}} within ${maxPresses} presses`,
  );
}

test('[A] type a word mid-paragraph', async ({ page, phraiseServer }) => {
  const original = fs.readFileSync(FIXTURE, 'utf8');
  await openAndWait(page, phraiseServer);

  await placeCaret(page, paragraphWithText(page, 'Second paragraph here.'), 'Second paragraph here.', 'Second paragraph '.length);
  await page.keyboard.type('inserted ');

  const expected = original.replace('Second paragraph here.', 'Second paragraph inserted here.');
  await expect.poll(() => markdown(page)).toBe(expected);
});

test('[A] Enter splits a paragraph, then Backspace at the start of the second half joins it back byte-identical', async ({ page, phraiseServer }) => {
  const original = fs.readFileSync(FIXTURE, 'utf8');
  await openAndWait(page, phraiseServer);

  await placeCaret(page, paragraphWithText(page, 'First paragraph here.'), 'First paragraph here.', 'First '.length);
  await page.keyboard.press('Enter');

  // The re-serialized second half's trailing space on the FIRST half is
  // escaped as `&#x20;` by mdast-util-to-markdown (a trailing space before a
  // hard paragraph boundary is otherwise ambiguous on reparse -- the same
  // escaping `copyMarkdown.spec.ts`'s unit tests observe).
  const splitExpected = original.replace('First paragraph here.', 'First&#x20;\n\nparagraph here.');
  await expect.poll(() => markdown(page)).toBe(splitExpected);

  // The caret is now at the start of the second half ("paragraph here.").
  await page.keyboard.press('Backspace');
  await expect.poll(() => markdown(page)).toBe(original);
});

test('[A] Backspace at the start of a paragraph following a heading joins it into the heading', async ({ page, phraiseServer }) => {
  const original = fs.readFileSync(FIXTURE, 'utf8');
  await openAndWait(page, phraiseServer);

  await placeCaret(page, paragraphWithText(page, 'First paragraph here.'), 'First paragraph here.', 0);
  await page.keyboard.press('Backspace');

  const expected = original.replace('# Heading One\n\nFirst paragraph here.', '# Heading OneFirst paragraph here.');
  await expect.poll(() => markdown(page)).toBe(expected);
});

test('[A] Delete at the end of a paragraph preceding a list', async ({ page, phraiseServer }) => {
  const original = fs.readFileSync(FIXTURE, 'utf8');
  await openAndWait(page, phraiseServer);

  const paragraph = paragraphWithText(page, 'Third paragraph before a list.');
  await placeCaret(page, paragraph, 'Third paragraph before a list.', 'Third paragraph before a list.'.length);
  await page.keyboard.press('Delete');

  // Observed behaviour (recorded here rather than guessed): a paragraph
  // cannot text-merge with a following list (different, non-joinable node
  // types), so ProseMirror's default `joinForward` instead lifts the
  // list's FIRST item out as its own new top-level paragraph, leaving the
  // list with one fewer item -- Google Docs does the same thing when you
  // delete forward from the end of a paragraph into a list. The lifted
  // paragraph is a genuinely new top-level block, so it re-serializes fresh
  // (`src`/`gap` null) rather than reusing anything from the list's `src`.
  const expected = original.replace(
    'Third paragraph before a list.\n\n- List item one\n- List item two',
    'Third paragraph before a list.\n\nList item one\n\n- List item two',
  );
  await expect.poll(() => markdown(page)).toBe(expected);
});

test('[A] select across two paragraphs and type over the selection', async ({ page, phraiseServer }) => {
  const original = fs.readFileSync(FIXTURE, 'utf8');
  await openAndWait(page, phraiseServer);

  // Establish a selection spanning the two paragraphs with real keyboard
  // events throughout: place the caret with Home/ArrowRight, then extend it
  // across the paragraph boundary with real Shift-ArrowRight presses (see
  // `extendSelectionAcrossBlocksTo`'s own comment).
  await placeCaret(page, paragraphWithText(page, 'First paragraph here.'), 'First paragraph here.', 'First '.length);
  await extendSelectionAcrossBlocksTo(page, 'Second paragraph here.', 'Second '.length);
  await page.keyboard.type('X');

  const expected = original.replace('First paragraph here.\n\nSecond paragraph here.', 'First Xparagraph here.');
  await expect.poll(() => markdown(page)).toBe(expected);
});
