// Brief 03, gate C: blocks the editor does not model (raw HTML, front
// matter, math, footnote definitions, link reference definitions) appear as
// source blocks, editable as source, never corrupted by edits around them;
// Mermaid fences render as diagrams; HTML previews are sanitized.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page, Locator } from '@playwright/test';
import { test, expect } from './fixtures.js';
import { LINE_START } from './keys.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, 'fixtures', 'source-blocks.md');
const DOC = 'source-blocks.md';
const UNSAFE_FIXTURE = path.join(HERE, 'fixtures', 'unsafe-html.md');
const UNSAFE_DOC = 'unsafe-html.md';

// Two `test.use({ seedFiles: [...] })` calls, one per fixture file, rather
// than one call with a two-element array: Playwright's fixture-option
// merging turned a two-element array value into a non-iterable object here
// (confirmed with a throwaway repro spec, deleted before committing --
// single-element arrays were unaffected). This nested-`describe` shape is
// also the pattern `gateB-inputrules.spec.ts` already uses for its own
// second fixture, so it is a known-working shape in this codebase, not a
// new one.
test.use({ seedFiles: [{ relpath: DOC, srcPath: FIXTURE }] });

async function openAndWait(page: Page, phraiseServer: { pageUrl(doc: string, user: string): string }, doc = DOC): Promise<void> {
  await page.goto(phraiseServer.pageUrl(doc, 'Alice'));
  await page.waitForFunction(() => (window as unknown as { phraise?: unknown }).phraise != null);
}

async function markdown(page: Page): Promise<string> {
  return page.evaluate(() => (window as unknown as { phraise: { markdown(): string } }).phraise.markdown());
}

function paragraphWithText(page: Page, text: string): Locator {
  return page.locator('#editor .ProseMirror p', { hasText: text }).first();
}

async function selectionInfo(
  page: Page,
): Promise<{ parentType: string; parentText: string; parentOffset: number; parentSize: number; isNodeSelection: boolean }> {
  return page.evaluate(() => {
    const editor = (window as unknown as { phraise: { editor: import('@tiptap/core').Editor } }).phraise.editor;
    const { $from, from, to } = editor.state.selection;
    const node = editor.state.doc.nodeAt(from);
    return {
      parentType: $from.parent.type.name,
      parentText: $from.parent.textContent,
      parentOffset: $from.parentOffset,
      parentSize: $from.parent.content.size,
      isNodeSelection: node != null && to - from === node.nodeSize,
    };
  });
}

/** Click into a paragraph and move the caret to `offset` from its start via
 * real keyboard events, polling after each risky step -- see
 * `gateA-typing.spec.ts`'s `placeCaret` for why (a plain click/press
 * resolves before ProseMirror's `EditorView` has necessarily caught up). */
async function placeCaret(page: Page, locator: Locator, expectedText: string, offset: number): Promise<void> {
  await locator.click();
  await expect.poll(async () => (await selectionInfo(page)).parentText).toBe(expectedText);
  await page.keyboard.press(LINE_START);
  for (let i = 0; i < offset; i++) await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await selectionInfo(page)).parentOffset).toBe(offset);
}

test('[C] source blocks render with plain-language labels and no visible Markdown syntax', async ({ page, phraiseServer }) => {
  await openAndWait(page, phraiseServer);
  // The document's default initial selection lands inside the FIRST
  // top-level block (the yaml front matter here), which would otherwise
  // show that one block's own source editor rather than its preview. Move
  // the caret elsewhere first so every block below is asserted in its
  // steady-state (not-being-edited) preview mode.
  await page.locator('#editor .ProseMirror h1').click();

  const yamlBlock = page.locator('.phraise-source-block[data-raw-block-kind="yaml"]');
  await expect(yamlBlock.locator('.phraise-source-label')).toContainText('Page properties');
  await expect(yamlBlock.locator('.phraise-frontmatter-preview dt')).toHaveText(['title', 'author']);
  await expect(yamlBlock.locator('.phraise-frontmatter-preview dd')).toHaveText(['Source Blocks Fixture', 'Phraise']);
  await expect(yamlBlock.locator('.phraise-source-preview')).not.toContainText('---'); // no raw fence visible in the preview

  const htmlBlock = page.locator('.phraise-source-block[data-raw-block-kind="html"]');
  await expect(htmlBlock.locator('.phraise-source-label')).toContainText('HTML');
  await expect(htmlBlock.locator('.phraise-html-preview strong')).toHaveText('HTML');
  await expect(htmlBlock.locator('.phraise-source-preview')).not.toContainText('<div');

  const mathBlock = page.locator('.phraise-source-block[data-raw-block-kind="math"]');
  await expect(mathBlock.locator('.phraise-source-label')).toContainText('Formula');
  await expect(mathBlock.locator('.katex')).toHaveCount(1);
  await expect(mathBlock.locator('.phraise-source-preview')).not.toContainText('$$');

  const footnoteBlock = page.locator('.phraise-source-block[data-raw-block-kind="footnoteDefinition"]');
  await expect(footnoteBlock.locator('.phraise-source-label')).toContainText('Footnote');

  const definitionBlock = page.locator('.phraise-source-block[data-raw-block-kind="definition"]');
  await expect(definitionBlock.locator('.phraise-source-label')).toContainText('Link reference');

  // The footnote reference itself, inline in its paragraph, is a real
  // superscript number (brief 07 fix list: was an unobtrusive
  // "FOOTNOTE REF" chip), not `[^1]` literal text.
  const footnoteParagraph = paragraphWithText(page, 'Here is a claim with a footnote');
  await expect(footnoteParagraph).not.toContainText('[^1]');
  await expect(footnoteParagraph.locator('.phraise-footnote-ref')).toHaveCount(1);
  await expect(footnoteParagraph.locator('.phraise-footnote-ref sup')).toHaveText('1');

  const mermaidBlock = page.locator('.phraise-mermaid-block');
  await expect(mermaidBlock.locator('.phraise-source-label')).toContainText('Mermaid');
  await expect(mermaidBlock.locator('.phraise-mermaid-preview')).not.toContainText('```');
  await expect(mermaidBlock.locator('svg')).toHaveCount(1, { timeout: 10000 });
});

/** The position right after the last character of the first top-level
 * `raw_block` of the given `kind`'s own text content -- i.e. where a caret
 * belongs to append to its source. Computed directly rather than via a
 * native End keypress: a `<pre>` with real embedded newlines is multi-line,
 * and `End` there moves to the end of the current VISUAL line, not the
 * block's own last line -- not what this test needs, and not the gesture
 * under test (the block's own boundary/rendering is; see the source
 * comment on `moveCaretIntoBlock`). */
async function endOfRawBlockPos(page: Page, kind: string): Promise<number> {
  return page.evaluate((kind) => {
    const editor = (window as unknown as { phraise: { editor: import('@tiptap/core').Editor } }).phraise.editor;
    let pos = -1;
    editor.state.doc.forEach((node, offset) => {
      if (pos === -1 && node.type.name === 'raw_block' && node.attrs.kind === kind) pos = offset + node.nodeSize - 1;
    });
    return pos;
  }, kind);
}

test("[C] editing a source block through the keyboard changes exactly that block's bytes", async ({ page, phraiseServer }) => {
  const original = fs.readFileSync(FIXTURE, 'utf8');
  await openAndWait(page, phraiseServer);

  const htmlBlock = page.locator('.phraise-source-block[data-raw-block-kind="html"]');
  await htmlBlock.getByRole('button', { name: 'Edit source' }).click();
  await expect(htmlBlock).toHaveClass(/phraise-editing/);

  const endPos = await endOfRawBlockPos(page, 'html');
  await page.evaluate((pos) => {
    (window as unknown as { phraise: { editor: import('@tiptap/core').Editor } }).phraise.editor.commands.setTextSelection(pos);
  }, endPos);
  // Real focus-timing race (same shape as the typing brief's own documented
  // one): a click/command resolves before the browser has necessarily
  // moved DOM focus into the ProseMirror contenteditable root, so the very
  // first keystroke sent right after can be lost. Poll for real DOM focus
  // before typing.
  await expect.poll(() => page.evaluate(() => document.activeElement?.classList.contains('ProseMirror'))).toBe(true);
  await page.keyboard.type('<!-- edited -->');

  const expected = original.replace('  <p>Raw <strong>HTML</strong> content.</p>\n</div>', '  <p>Raw <strong>HTML</strong> content.</p>\n</div><!-- edited -->');
  await expect.poll(() => markdown(page)).toBe(expected);
});

test('[C] typing, Enter, Backspace and Delete in neighbouring paragraphs leave a source block byte-identical', async ({ page, phraiseServer }) => {
  const original = fs.readFileSync(FIXTURE, 'utf8');
  await openAndWait(page, phraiseServer);

  const before = paragraphWithText(page, 'Paragraph before the HTML block.');
  await placeCaret(page, before, 'Paragraph before the HTML block.', 'Paragraph before the HTML block.'.length);
  await page.keyboard.type(' More.');
  await page.keyboard.press('Enter');
  await page.keyboard.type('New line.');
  for (let i = 0; i < 'New line.'.length; i++) await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace'); // join the now-empty new paragraph back

  const expected = original.replace('Paragraph before the HTML block.', 'Paragraph before the HTML block. More.');
  await expect.poll(() => markdown(page)).toBe(expected);
});

test('[C] Backspace at the start of the paragraph after a source block selects the block instead of merging into it', async ({
  page,
  phraiseServer,
}) => {
  const original = fs.readFileSync(FIXTURE, 'utf8');
  await openAndWait(page, phraiseServer);

  const after = paragraphWithText(page, 'Paragraph between HTML and math.');
  await placeCaret(page, after, 'Paragraph between HTML and math.', 0);
  await page.keyboard.press('Backspace');

  await expect.poll(async () => (await selectionInfo(page)).isNodeSelection).toBe(true);
  // The document is otherwise untouched: nothing was deleted or merged.
  await expect.poll(() => markdown(page)).toBe(original);
});

test('[C] Delete at the end of the paragraph before a source block selects the block instead of merging into it', async ({
  page,
  phraiseServer,
}) => {
  const original = fs.readFileSync(FIXTURE, 'utf8');
  await openAndWait(page, phraiseServer);

  const before = paragraphWithText(page, 'Paragraph before the HTML block.');
  await placeCaret(page, before, 'Paragraph before the HTML block.', 'Paragraph before the HTML block.'.length);
  await page.keyboard.press('Delete');

  await expect.poll(async () => (await selectionInfo(page)).isNodeSelection).toBe(true);
  await expect.poll(() => markdown(page)).toBe(original);
});

test.describe('unsafe HTML block', () => {
  test.use({ seedFiles: [{ relpath: UNSAFE_DOC, srcPath: UNSAFE_FIXTURE }] });

  test('[C] an HTML block containing onerror and script is sanitized: no global flag, no script element', async ({ page, phraiseServer }) => {
    await openAndWait(page, phraiseServer, UNSAFE_DOC);

    // Give any (illegitimate) inline script a moment to have run, if it were
    // going to.
    await page.waitForTimeout(300);

    const scriptRan = await page.evaluate(() => (window as unknown as { scriptRan?: boolean }).scriptRan);
    const pwned = await page.evaluate(() => (window as unknown as { pwned?: boolean }).pwned);
    expect(scriptRan).toBeUndefined();
    expect(pwned).toBeUndefined();

    await expect(page.locator('#editor script')).toHaveCount(0);
    const htmlBlock = page.locator('.phraise-source-block[data-raw-block-kind="html"]');
    await expect(htmlBlock.locator('img')).toHaveCount(1);
    const onerror = await htmlBlock.locator('img').getAttribute('onerror');
    expect(onerror).toBeNull();
  });
});
