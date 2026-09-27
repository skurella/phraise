// Brief 07, gate J: feel. Two things:
// 1. An automated check that in normal editing no Markdown syntax is
//    visible, on two real documents (the Express README; a real
//    kubernetes/enhancements KEP with a GFM table and a fenced code
//    block, `corpus/fetched/kubernetes-enhancements-
//    kepssigapimachinery4153declarativeva.md` -- the brief's own suggested
//    `...kepssigapps4017...` turned out to have no table at all, confirmed
//    by grepping its raw source before picking a different one, per the
//    brief's own "or similar, check it has both").
// 2. Ten screenshots into `screenshots/`, PNG, 1280x800, device scale 1,
//    each asserted under 300 KB, real content throughout (no lorem ipsum):
//    the two documents above, real gate D/F/H fixtures already used
//    elsewhere in this spike (genuine, if plain, English sentences -- not
//    placeholder text), driven with the same real keyboard/mouse
//    techniques those gates' own tests use.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page, Locator } from '@playwright/test';
import { test, expect } from './fixtures.js';
import { clickThenShiftClick } from './mouseSelect.js';
import { lineStartKey, lineEndKey } from './keys.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.join(HERE, '..', 'screenshots');
fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

const README_FIXTURE = path.join(HERE, '..', 'corpus', 'fetched', 'npm-express-readme.md');
const DESIGN_DOC_FIXTURE = path.join(HERE, '..', 'corpus', 'fetched', 'kubernetes-enhancements-kepssigapimachinery4153declarativeva.md');
const COMMENTS_FIXTURE = path.join(HERE, 'fixtures', 'comments.md');
const COLLAB_FIXTURE = path.join(HERE, 'fixtures', 'collab.md');
const SOURCE_BLOCKS_FIXTURE = path.join(HERE, 'fixtures', 'source-blocks.md');
const GATE_H_FIXTURE = path.join(HERE, 'fixtures', 'gate-h.md');
const TYPING_FIXTURE = path.join(HERE, 'fixtures', 'typing.md');

const VIEWPORT = { width: 1280, height: 800 };
const MAX_SCREENSHOT_BYTES = 300 * 1024;

/** Copies a fixture directly into the running server's own seeds
 * directory -- see `gateK-scale.spec.ts`'s `seedDoc` for why this spike's
 * own `seedFiles`-array Playwright fixture bug makes this the reliable
 * choice whenever a file needs several independently-named docs. */
function seedDoc(phraiseServer: { seedsDir: string }, relpath: string, srcPath: string): void {
  fs.copyFileSync(srcPath, path.join(phraiseServer.seedsDir, relpath));
}

async function openAndWait(page: Page, phraiseServer: { pageUrl(doc: string, user: string): string }, doc: string, user: string): Promise<void> {
  await page.setViewportSize(VIEWPORT);
  await page.goto(phraiseServer.pageUrl(doc, user));
  await page.waitForFunction(() => (window as unknown as { phraise?: unknown }).phraise != null);
}

async function screenshotAndCheck(page: Page, name: string): Promise<void> {
  const file = path.join(SCREENSHOTS_DIR, name);
  await page.screenshot({ path: file, type: 'png' });
  const { size } = fs.statSync(file);
  expect(size, `${name} should be under 300KB (was ${size} bytes)`).toBeLessThan(MAX_SCREENSHOT_BYTES);
}

function paragraphAt(page: Page, index: number): Locator {
  return page.locator('#editor .ProseMirror > p').nth(index);
}

// ---------------------------------------------------------------------------
// The automated "no visible Markdown syntax" check.
// ---------------------------------------------------------------------------

/** Walks the rendered editor's DOM, concatenating visible text (inserting a
 * newline at each block-level element's boundary, so the "line starting
 * with `#` " check has real lines to look at), and SKIPPING any `<pre>`
 * subtree -- covering real code blocks (`<pre><code>`, schema `toDOM`),
 * a source block's own open source editor (`<pre class="phraise-source-
 * editor">`), and a raw-text preview fallback, all per the brief's own
 * "outside code blocks and outside a source block's open source editor" --
 * and anything CSS-hidden (a closed source editor, a hidden popover).
 * Returns the list of problems found (empty = clean). */
async function findMarkdownLeaks(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const root = document.querySelector('#editor .ProseMirror');
    if (!root) return ['#editor .ProseMirror not found'];
    const BLOCK_TAGS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE', 'TR', 'DIV', 'UL', 'OL', 'TABLE', 'HR', 'THEAD', 'TBODY']);
    let out = '';
    function isHiddenEl(el: Element): boolean {
      const cs = getComputedStyle(el);
      return cs.display === 'none' || cs.visibility === 'hidden';
    }
    function walk(node: Node): void {
      if (node.nodeType === Node.TEXT_NODE) {
        out += node.textContent ?? '';
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const el = node as Element;
      if (el.tagName === 'PRE') return;
      if (isHiddenEl(el)) return;
      const block = BLOCK_TAGS.has(el.tagName);
      if (block) out += '\n';
      for (const child of Array.from(el.childNodes)) walk(child);
      if (block) out += '\n';
    }
    walk(root);

    const problems: string[] = [];
    if (out.includes('**')) problems.push('** (bold marker)');
    if (out.includes('__')) problems.push('__ (strong/underline marker)');
    if (out.includes('`')) problems.push('` (backtick)');
    if (out.includes('](')) problems.push('](  (link/image syntax)');
    if (out.includes('![')) problems.push('![ (image syntax)');
    if (out.includes('[^')) problems.push('[^ (footnote reference syntax)');
    for (const line of out.split('\n')) {
      const trimmed = line.trim();
      if (/^#+\s/.test(trimmed)) {
        problems.push(`heading marker on a rendered line: ${JSON.stringify(trimmed.slice(0, 40))}`);
        break;
      }
    }
    return problems;
  });
}

test('[J] no Markdown syntax is visible in normal editing: the Express README', async ({ page, phraiseServer }) => {
  const doc = 'feel-readme.md';
  seedDoc(phraiseServer, doc, README_FIXTURE);
  await openAndWait(page, phraiseServer, doc, 'Alice');
  const problems = await findMarkdownLeaks(page);
  expect(problems, `Markdown syntax leaked into the rendered README: ${problems.join(', ')}`).toEqual([]);
});

test('[J] no Markdown syntax is visible in normal editing: a real design doc with a table and a code block', async ({ page, phraiseServer }) => {
  const doc = 'feel-designdoc.md';
  seedDoc(phraiseServer, doc, DESIGN_DOC_FIXTURE);
  await openAndWait(page, phraiseServer, doc, 'Alice');
  const problems = await findMarkdownLeaks(page);
  expect(problems, `Markdown syntax leaked into the rendered design doc: ${problems.join(', ')}`).toEqual([]);
});

// ---------------------------------------------------------------------------
// Screenshots.
// ---------------------------------------------------------------------------

test('[J] screenshot: the Express README, top of the page', async ({ page, phraiseServer }) => {
  const doc = 'shot-readme.md';
  seedDoc(phraiseServer, doc, README_FIXTURE);
  await openAndWait(page, phraiseServer, doc, 'Alice');
  // `img:not(.ProseMirror-separator)`: ProseMirror renders invisible
  // separator `<img>` placeholders around inline atoms that otherwise
  // shift `.first()`/`nth()` -- an established finding from brief 04's own
  // gate D/E/I tests (see the README's "Notes for the next brief").
  const logo = page.locator('#editor .ProseMirror img:not(.ProseMirror-separator)').first();
  await expect(logo).toBeVisible();
  // Give the (real, external) logo image a chance to actually load before
  // the screenshot, rather than capturing mid-fetch.
  await page.waitForFunction(() => {
    const img = document.querySelector('#editor .ProseMirror img:not(.ProseMirror-separator)') as HTMLImageElement | null;
    return !!img && img.complete;
  });
  await screenshotAndCheck(page, 'readme-top.png');
});

test('[J] screenshot: a design doc with a table and a code block', async ({ page, phraiseServer }) => {
  const doc = 'shot-designdoc.md';
  seedDoc(phraiseServer, doc, DESIGN_DOC_FIXTURE);
  await openAndWait(page, phraiseServer, doc, 'Alice');

  // Find a real table with a real code block nearby (within a handful of
  // blocks), scroll to it -- this design doc has 3 tables and 16 code
  // blocks (confirmed before picking it; see this file's header comment).
  const found = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('#editor .ProseMirror > *'));
    for (let i = 0; i < els.length; i++) {
      if (els[i]!.tagName !== 'TABLE') continue;
      for (let j = i + 1; j < Math.min(i + 6, els.length); j++) {
        if (els[j]!.classList.contains('phraise-code-block')) return { tableIdx: i };
      }
    }
    return null;
  });
  expect(found, 'expected to find a table followed by a code block within a few blocks').not.toBeNull();
  await page.evaluate((idx) => {
    const els = Array.from(document.querySelectorAll('#editor .ProseMirror > *'));
    els[idx]!.scrollIntoView({ block: 'start' });
    document.querySelector('#editor')!.scrollBy(0, -40);
  }, found!.tableIdx);

  await screenshotAndCheck(page, 'design-doc-table-and-code.png');
});

test('[J] screenshot: a comment thread with a reply, two users', async ({ page, phraiseServer, browser }) => {
  const doc = 'shot-comments.md';
  seedDoc(phraiseServer, doc, COMMENTS_FIXTURE);
  const original = fs.readFileSync(COMMENTS_FIXTURE, 'utf8');

  const alice = page;
  const bobContext = await browser.newContext();
  const bob = await bobContext.newPage();

  await openAndWait(alice, phraiseServer, doc, 'Alice');
  await openAndWait(bob, phraiseServer, doc, 'Bob');
  const markdown = (p: Page) => p.evaluate(() => (window as unknown as { phraise: { markdown(): string } }).phraise.markdown());
  await expect.poll(() => markdown(alice)).toBe(original);
  await expect.poll(() => markdown(bob)).toBe(original);

  const targetParagraph = paragraphAt(alice, 0);
  const targetText = 'Alice will point at the golden retriever puppy while explaining the process.';
  const phrase = 'the golden retriever puppy';
  await expect(targetParagraph).toHaveText(targetText);

  // Real click-then-shift-click selection of the phrase (the same real
  // mouse gesture the fix list's gate A/B tests use, `e2e/mouseSelect.ts`).
  await clickThenShiftClick(
    alice,
    { locator: targetParagraph, substring: phrase, edge: 'start' },
    { locator: targetParagraph, substring: phrase, edge: 'end' },
    phrase,
  );

  await alice.bringToFront();
  const commentButton = alice.locator('#phraise-comment-button');
  await expect(commentButton).toBeVisible();
  await commentButton.click();
  const composerInput = alice.locator('#comments-sidebar .phraise-comment-composer-input');
  await expect(composerInput).toBeFocused();
  await alice.keyboard.type('What breed is this?');
  await alice.keyboard.press('Enter');

  const bobThread = bob.locator('#comments-sidebar .phraise-comment-thread').first();
  await expect(bobThread).toHaveCount(1, { timeout: 10000 });

  await bob.bringToFront();
  const replyInput = bobThread.locator('.phraise-comment-reply-input');
  await replyInput.click();
  await bob.keyboard.type('A golden retriever, obviously.');
  await bob.keyboard.press('Enter');

  const aliceThread = alice.locator('#comments-sidebar .phraise-comment-thread').first();
  await expect(aliceThread.locator('.phraise-comment-message')).toHaveCount(2);

  await alice.bringToFront();
  await screenshotAndCheck(alice, 'comment-thread-with-reply.png');
  await bobContext.close();
});

test('[J] screenshot: two named cursors in one paragraph', async ({ page, phraiseServer, browser }) => {
  const doc = 'shot-cursors.md';
  seedDoc(phraiseServer, doc, COLLAB_FIXTURE);
  const original = fs.readFileSync(COLLAB_FIXTURE, 'utf8');

  const alice = page;
  const bobContext = await browser.newContext();
  const bob = await bobContext.newPage();
  const carolContext = await browser.newContext();
  const carol = await carolContext.newPage();

  await openAndWait(alice, phraiseServer, doc, 'Alice');
  await openAndWait(bob, phraiseServer, doc, 'Bob');
  await openAndWait(carol, phraiseServer, doc, 'Carol');
  const markdown = (p: Page) => p.evaluate(() => (window as unknown as { phraise: { markdown(): string } }).phraise.markdown());
  await expect.poll(() => markdown(alice)).toBe(original);
  await expect.poll(() => markdown(bob)).toBe(original);
  await expect.poll(() => markdown(carol)).toBe(original);

  const paragraphText = "Alice's paragraph starts here.";
  const parentText = (p: Page) =>
    p.evaluate(() => {
      const editor = (window as any).phraise.editor;
      return editor.state.selection.$from.parent.textContent as string;
    });
  const parentOffset = (p: Page) =>
    p.evaluate(() => {
      const editor = (window as any).phraise.editor;
      return editor.state.selection.$from.parentOffset as number;
    });

  // Both Alice's and Bob's own paragraph locator (index 0, structural --
  // never `hasText`, since a remote caret's own DOM label can land inside
  // a paragraph's textContent, see gateD-collab.spec.ts's header comment).
  // Each click is polled to have actually landed in the right paragraph
  // before sending further keys -- the same discipline every other gate's
  // caret-placement helper in this suite uses (a plain click/press
  // resolves before ProseMirror necessarily catches up).
  await alice.bringToFront();
  await paragraphAt(alice, 0).click();
  await expect.poll(() => parentText(alice)).toBe(paragraphText);
  await alice.keyboard.press(lineStartKey(alice));
  for (let i = 0; i < 6; i++) await alice.keyboard.press('ArrowRight'); // after "Alice "
  await expect.poll(() => parentOffset(alice)).toBe(6);

  await bob.bringToFront();
  await paragraphAt(bob, 0).click();
  await expect.poll(() => parentText(bob)).toBe(paragraphText);
  await bob.keyboard.press(lineEndKey(bob));
  await expect.poll(() => parentOffset(bob)).toBe(paragraphText.length);

  // Carol (a third, idle spectator) sees BOTH remote carets decorated with
  // name labels at once -- a screenshot from Alice's or Bob's own page
  // would only ever show the OTHER one's caret (a user's own caret is the
  // plain native browser cursor, not a `CollaborationCaret` decoration).
  await expect
    .poll(() => carol.evaluate(() => document.querySelectorAll('.collaboration-cursor__label').length))
    .toBeGreaterThanOrEqual(2);
  await carol.bringToFront();
  await screenshotAndCheck(carol, 'two-named-cursors.png');

  await bobContext.close();
  await carolContext.close();
});

test('[J] screenshot: a source block with its preview, and one with its source editor open', async ({ page, phraiseServer }) => {
  const doc = 'shot-sourceblocks.md';
  seedDoc(phraiseServer, doc, SOURCE_BLOCKS_FIXTURE);
  await openAndWait(page, phraiseServer, doc, 'Alice');

  // Front matter's preview, visible at the very top by default (this
  // brief's own fix: a raw block no longer opens in "editing" mode before
  // the editor has ever been focused).
  await expect(page.locator('.phraise-source-block[data-raw-block-kind="yaml"] .phraise-frontmatter-preview')).toBeVisible();
  await screenshotAndCheck(page, 'source-block-preview.png');

  // The HTML block's own source editor, opened via its real "Edit source"
  // button (a real click, not a scripted selection).
  const htmlBlock = page.locator('.phraise-source-block[data-raw-block-kind="html"]');
  await htmlBlock.scrollIntoViewIfNeeded();
  await htmlBlock.locator('.phraise-edit-source-button').click();
  await expect(htmlBlock).toHaveClass(/phraise-editing/);
  await screenshotAndCheck(page, 'source-block-editing.png');
});

test('[J] screenshot: a rendered Mermaid diagram', async ({ page, phraiseServer }) => {
  const doc = 'shot-mermaid.md';
  seedDoc(phraiseServer, doc, SOURCE_BLOCKS_FIXTURE);
  await openAndWait(page, phraiseServer, doc, 'Alice');

  const mermaidBlock = page.locator('.phraise-mermaid-block');
  await mermaidBlock.scrollIntoViewIfNeeded();
  await expect(mermaidBlock.locator('svg')).toHaveCount(1, { timeout: 10000 });
  await screenshotAndCheck(page, 'mermaid-diagram.png');
});

test('[J] screenshot: the unverifiable-block banner', async ({ page, phraiseServer }) => {
  const doc = 'shot-gate-h.md';
  seedDoc(phraiseServer, doc, GATE_H_FIXTURE);
  await openAndWait(page, phraiseServer, doc, 'Alice');

  // The same real-UI unlink gate H's own test uses (Mod-K's "Remove link"
  // button) -- see gateH-unverified.spec.ts's `unlinkAutolink`.
  const linkParagraph = page.locator('#editor .ProseMirror > p').nth(1);
  await linkParagraph.click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const editor = (window as any).phraise.editor;
        return editor.state.selection.$from.marks().some((m: { type: { name: string } }) => m.type.name === 'link');
      }),
    )
    .toBe(true);
  await page.keyboard.press('ControlOrMeta+k');
  const popup = page.locator('#phraise-link-popup');
  await expect(popup).toBeVisible();
  await popup.getByRole('button', { name: 'Remove link' }).click();
  await expect(popup).toBeHidden();

  const banner = page.locator('.phraise-source-block[data-raw-block-kind="unverified"]');
  await expect(banner).toBeVisible({ timeout: 5000 });
  await screenshotAndCheck(page, 'unverifiable-block-banner.png');
});

test('[J] screenshot: the offline status', async ({ page, phraiseServer, context }) => {
  const doc = 'shot-offline.md';
  seedDoc(phraiseServer, doc, TYPING_FIXTURE);
  await openAndWait(page, phraiseServer, doc, 'Alice');
  await page.evaluate(() => (window as unknown as { phraise: { offlineReady: Promise<void> } }).phraise.offlineReady);

  await context.setOffline(true);
  await expect(page.locator('#status-indicator')).toHaveText(/Offline/, { timeout: 10_000 });
  await screenshotAndCheck(page, 'offline-status.png');
  await context.setOffline(false);
});

test('[J] screenshot: the Markdown panel open beside the document', async ({ page, phraiseServer }) => {
  const doc = 'shot-panel.md';
  seedDoc(phraiseServer, doc, README_FIXTURE);
  await openAndWait(page, phraiseServer, doc, 'Alice');

  await page.click('#markdown-toggle');
  await expect(page.locator('#markdown-panel')).toBeVisible();
  await expect(page.locator('#markdown-output')).toContainText('Fast, unopinionated, minimalist web framework');
  await screenshotAndCheck(page, 'markdown-panel-open.png');
});
