// Brief 06, gate F: comments. Select text and add a comment (either the
// floating "Comment" button or Mod-Alt-M); a sidebar shows threads in
// document order; reply and resolve; the highlight follows the text
// through the other user's edits; a comment whose text is deleted shows as
// orphaned with its quote. Two contexts (Alice and Bob), keyboard and
// mouse only -- same established patterns as gateD-collab.spec.ts/
// gateE-undo.spec.ts: positional paragraph locators (never `hasText`, since
// a remote caret's own DOM label can appear inside a paragraph's
// `textContent` -- see gateD's own header comment), `bringToFront()`
// before every keyboard action (only the front page has focus in headless
// Chromium on this machine), and polling the real model state
// (`editor.state.selection`) rather than trusting a click/keypress landed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page, Locator } from '@playwright/test';
import { test, expect } from './fixtures.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, 'fixtures', 'comments.md');
const DOC = 'comments.md';
const ORIGINAL = fs.readFileSync(FIXTURE, 'utf8');

const TARGET_PARAGRAPH = 0; // "Alice will point at the golden retriever puppy while explaining the process."
const TARGET_TEXT = 'Alice will point at the golden retriever puppy while explaining the process.';
const PHRASE = 'the golden retriever puppy';

test.use({ seedFiles: [{ relpath: DOC, srcPath: FIXTURE }] });

async function openAndWait(page: Page, phraiseServer: { pageUrl(doc: string, user: string): string }, user: string): Promise<void> {
  await page.goto(phraiseServer.pageUrl(DOC, user));
  await page.waitForFunction(() => (window as unknown as { phraise?: unknown }).phraise != null);
}

async function markdown(page: Page): Promise<string> {
  return page.evaluate(() => (window as unknown as { phraise: { markdown(): string } }).phraise.markdown());
}

function paragraphAt(page: Page, index: number): Locator {
  return page.locator('#editor .ProseMirror > p').nth(index);
}

async function waitForInitialSync(pageA: Page, pageB: Page): Promise<void> {
  await expect.poll(() => markdown(pageA)).toBe(ORIGINAL);
  await expect.poll(() => markdown(pageB)).toBe(ORIGINAL);
}

async function selectionInfo(page: Page): Promise<{ text: string; offset: number }> {
  return page.evaluate(() => {
    const editor = (window as unknown as { phraise: { editor: import('@tiptap/core').Editor } }).phraise.editor;
    const { $from } = editor.state.selection;
    return { text: $from.parent.textContent as string, offset: $from.parentOffset };
  });
}

/** Same pattern as gateD-collab.spec.ts's `placeCaret`: click, then poll the
 * real model selection before navigating by keyboard (a plain click/press
 * resolves before ProseMirror necessarily catches up). */
/** Retries the whole click+Home+ArrowRight-N sequence (up to 3 attempts)
 * if the final poll doesn't converge quickly -- the same discipline
 * `typeAndVerify` established in `gateE-undo.spec.ts`/`gateG-ime.spec.ts`/
 * `gateI-offline.spec.ts` for a real, rare CDP input-delivery miss under
 * this machine's full-suite parallel load (confirmed by a real `npm run
 * gates` run: this exact function timed out once in ~78 tests run at
 * default worker parallelism, never in isolation). Every retry is logged,
 * per the charter ("If you retry a keyboard action, log each retry with
 * `console.log`... so it stays visible"); a successful attempt still
 * returns in single-digit milliseconds, so this never slows the common
 * case. */
async function placeCaret(page: Page, locator: Locator, expectedText: string, offset: number): Promise<void> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    await page.bringToFront();
    await locator.click();
    await expect.poll(async () => (await selectionInfo(page)).text).toBe(expectedText);
    await page.keyboard.press('Home');
    for (let i = 0; i < offset; i++) await page.keyboard.press('ArrowRight');
    try {
      await expect.poll(async () => (await selectionInfo(page)).offset, { timeout: 3000 }).toBe(offset);
      return;
    } catch (err) {
      console.log(`[placeCaret-retry] offset ${offset} attempt ${attempt}: ${(err as Error).message.split('\n').slice(0, 4).join(' | ')}`);
      if (attempt === 3) throw err;
    }
  }
}

async function selectionRange(page: Page): Promise<{ from: number; to: number; text: string }> {
  return page.evaluate(() => {
    const editor = (window as unknown as { phraise: { editor: import('@tiptap/core').Editor } }).phraise.editor;
    const { from, to } = editor.state.selection;
    return { from, to, text: editor.state.doc.textBetween(from, to, '', '') };
  });
}

/** Places the caret right before `phrase` inside `locator` (whose full text
 * is `fullText`), then extends the selection with real `Shift+ArrowRight`
 * keystrokes -- the orchestrator's own confirmed-working technique on this
 * machine, PROVIDED the real model selection is polled until it settles
 * before being read (the DOM's own `selectionchange` is asynchronous). */
async function selectPhrase(page: Page, locator: Locator, fullText: string, phrase: string): Promise<void> {
  const start = fullText.indexOf(phrase);
  if (start < 0) throw new Error(`selectPhrase: ${JSON.stringify(phrase)} not found in ${JSON.stringify(fullText)}`);
  await placeCaret(page, locator, fullText, start);
  // Same retry discipline as `placeCaret` (see its own comment): re-place
  // the caret and redo the whole Shift+ArrowRight sequence if it doesn't
  // converge quickly, rather than trusting every one of `phrase.length`
  // keystrokes landed under full-suite parallel load.
  for (let attempt = 1; attempt <= 3; attempt++) {
    for (let i = 0; i < phrase.length; i++) await page.keyboard.press('Shift+ArrowRight');
    try {
      await expect.poll(async () => (await selectionRange(page)).text, { timeout: 3000 }).toBe(phrase);
      return;
    } catch (err) {
      console.log(`[selectPhrase-retry] ${JSON.stringify(phrase)} attempt ${attempt}: ${(err as Error).message.split('\n').slice(0, 4).join(' | ')}`);
      if (attempt === 3) throw err;
      await placeCaret(page, locator, fullText, start);
    }
  }
}

function commentButton(page: Page): Locator {
  return page.locator('#phraise-comment-button');
}

function sidebar(page: Page): Locator {
  return page.locator('#comments-sidebar');
}

function threadCards(page: Page): Locator {
  return sidebar(page).locator('.phraise-comment-thread');
}

function highlights(page: Page): Locator {
  return page.locator('#editor .ProseMirror .phraise-comment-highlight');
}

/** The highlighted text, joined across however many `<span>`s ProseMirror's
 * decoration renderer happened to split a single `Decoration.inline` range
 * into. A real finding while writing this file (not a bug): typing INSIDE
 * an already-decorated range creates a new, separate inline text node next
 * to the untouched surrounding ones, and ProseMirror renders one wrapper
 * `<span>` per contiguous existing DOM text run rather than merging them --
 * so a single logical highlight can legitimately be >1 element in the DOM.
 * Order matches document order, so joining is safe. */
async function highlightedText(page: Page): Promise<string> {
  return (await highlights(page).allTextContents()).join('');
}

/** Opens the composer via the floating "Comment" button (a real click, not
 * `.fill()`) and posts `text` with a real Enter keystroke. */
async function addCommentViaButton(page: Page, text: string): Promise<void> {
  await expect(commentButton(page)).toBeVisible();
  await commentButton(page).click();
  const input = sidebar(page).locator('.phraise-comment-composer-input');
  await expect(input).toBeFocused();
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(sidebar(page).locator('.phraise-comment-composer')).toHaveCount(0);
}

test('[F] Alice selects a phrase and adds a comment; the highlight and sidebar thread appear for Bob too', async ({ page, phraiseServer, browser }) => {
  const alice = page;
  const context2 = await browser.newContext();
  const bob = await context2.newPage();

  await openAndWait(alice, phraiseServer, 'Alice');
  await openAndWait(bob, phraiseServer, 'Bob');
  await waitForInitialSync(alice, bob);

  await selectPhrase(alice, paragraphAt(alice, TARGET_PARAGRAPH), TARGET_TEXT, PHRASE);
  await addCommentViaButton(alice, 'What breed is this?');

  // The highlight appears on Alice's own page immediately.
  await expect(highlights(alice)).toHaveCount(1);
  await expect(highlights(alice).first()).toHaveText(PHRASE);

  // The sidebar shows the thread with the quote and the message.
  await expect(threadCards(alice)).toHaveCount(1);
  await expect(threadCards(alice).first().locator('.phraise-comment-quote')).toHaveText(PHRASE);
  await expect(threadCards(alice).first().locator('.phraise-comment-message')).toHaveText(/Alice.*What breed is this\?/s);

  // Bob sees the same thread and highlight once it syncs through the relay.
  await expect(highlights(bob)).toHaveCount(1, { timeout: 10000 });
  await expect(highlights(bob).first()).toHaveText(PHRASE);
  await expect(threadCards(bob)).toHaveCount(1);
  await expect(threadCards(bob).first().locator('.phraise-comment-quote')).toHaveText(PHRASE);

  // Clicking inside the highlight activates the thread (both mouse-driven).
  await highlights(bob).first().click();
  await expect(threadCards(bob).first()).toHaveClass(/phraise-comment-thread--active/);

  // Mod-Alt-M also opens the composer (for a second, unrelated selection),
  // and Escape cancels it without creating a thread.
  await selectPhrase(alice, paragraphAt(alice, TARGET_PARAGRAPH), TARGET_TEXT, 'explaining the process');
  await alice.bringToFront();
  // Playwright's platform-aware modifier -- same convention gateD/gateE use
  // for Mod-Z etc -- so this works on macOS (Meta) and Linux/Windows
  // (Control) alike, matching Tiptap's own "Mod" shortcut normalization.
  await alice.keyboard.press('ControlOrMeta+Alt+m');
  await expect(sidebar(alice).locator('.phraise-comment-composer')).toBeVisible();
  await alice.keyboard.press('Escape');
  await expect(sidebar(alice).locator('.phraise-comment-composer')).toHaveCount(0);
  await expect(threadCards(alice)).toHaveCount(1); // still just the one real thread

  await context2.close();
});

test('[F] Bob replies, Alice sees it and resolves; the highlight disappears on both and the thread moves under Show resolved', async ({
  page,
  phraiseServer,
  browser,
}) => {
  const alice = page;
  const context2 = await browser.newContext();
  const bob = await context2.newPage();

  await openAndWait(alice, phraiseServer, 'Alice');
  await openAndWait(bob, phraiseServer, 'Bob');
  await waitForInitialSync(alice, bob);

  await selectPhrase(alice, paragraphAt(alice, TARGET_PARAGRAPH), TARGET_TEXT, PHRASE);
  await addCommentViaButton(alice, 'What breed is this?');
  await expect(threadCards(bob)).toHaveCount(1, { timeout: 10000 });

  // Bob replies.
  await bob.bringToFront();
  const bobReplyInput = threadCards(bob).first().locator('.phraise-comment-reply-input');
  await bobReplyInput.click();
  await bob.keyboard.type('A golden retriever, obviously.');
  await bob.keyboard.press('Enter');

  await expect(threadCards(alice).first().locator('.phraise-comment-message')).toHaveCount(2);
  await expect(threadCards(alice).first().locator('.phraise-comment-message').nth(1)).toHaveText(/Bob.*A golden retriever, obviously\./s);

  // Alice resolves.
  await alice.bringToFront();
  await threadCards(alice).first().locator('.phraise-comment-resolve-btn').click();

  // The highlight disappears on both.
  await expect(highlights(alice)).toHaveCount(0);
  await expect(highlights(bob)).toHaveCount(0, { timeout: 10000 });

  // The thread is gone from the default view on both, and appears once
  // "Show resolved" is toggled.
  await expect(threadCards(alice)).toHaveCount(0);
  await sidebar(alice).locator('.phraise-show-resolved-toggle input').check();
  await expect(threadCards(alice)).toHaveCount(1);
  await expect(threadCards(alice).first().locator('.phraise-comment-resolve-btn')).toHaveCount(0);
  await expect(threadCards(alice).first().locator('.phraise-comment-reopen-btn')).toBeVisible();

  await expect(threadCards(bob)).toHaveCount(0);
  await sidebar(bob).locator('.phraise-show-resolved-toggle input').check();
  await expect(threadCards(bob)).toHaveCount(1, { timeout: 10000 });

  await context2.close();
});

test('[F] the highlight follows the text through edits before, above, and inside the phrase', async ({ page, phraiseServer, browser }) => {
  const alice = page;
  const context2 = await browser.newContext();
  const bob = await context2.newPage();

  await openAndWait(alice, phraiseServer, 'Alice');
  await openAndWait(bob, phraiseServer, 'Bob');
  await waitForInitialSync(alice, bob);

  await selectPhrase(alice, paragraphAt(alice, TARGET_PARAGRAPH), TARGET_TEXT, PHRASE);
  await addCommentViaButton(alice, 'What breed is this?');
  await expect(highlights(bob)).toHaveCount(1, { timeout: 10000 });

  // 1. Bob types BEFORE the phrase, in the same paragraph.
  await placeCaret(bob, paragraphAt(bob, TARGET_PARAGRAPH), TARGET_TEXT, 0);
  await bob.keyboard.type('Hey! ');
  await expect.poll(() => markdown(alice)).toContain('Hey! ' + TARGET_TEXT);
  await expect.poll(() => highlightedText(alice)).toBe(PHRASE);

  // 2. Bob inserts a new, empty paragraph directly above the target
  // paragraph (caret at its very start, then Enter splits it into an
  // empty paragraph followed by the original content), and types into it.
  await placeCaret(bob, paragraphAt(bob, TARGET_PARAGRAPH), 'Hey! ' + TARGET_TEXT, 0);
  await bob.keyboard.press('Enter');
  await bob.keyboard.press('ArrowUp');
  await bob.keyboard.type('Inserted paragraph.');
  await expect.poll(() => markdown(alice)).toContain('Inserted paragraph.\n\nHey! ' + TARGET_TEXT);
  await expect.poll(() => highlightedText(alice)).toBe(PHRASE);

  // 3. Bob types INSIDE the phrase itself -- the highlight must widen to
  // cover his insertion too, per the brief's own wording.
  const currentParagraphIndex = TARGET_PARAGRAPH + 1; // shifted down by the inserted paragraph above
  const currentText = 'Hey! ' + TARGET_TEXT;
  const insideOffset = currentText.indexOf(PHRASE) + 'the golden '.length; // right before "retriever"
  await placeCaret(bob, paragraphAt(bob, currentParagraphIndex), currentText, insideOffset);
  await bob.keyboard.type('very ');
  const widenedPhrase = 'the golden very retriever puppy';
  await expect.poll(() => markdown(alice)).toContain(widenedPhrase);
  await expect.poll(() => highlightedText(alice)).toBe(widenedPhrase);
  await expect.poll(() => highlightedText(bob)).toBe(widenedPhrase);

  await context2.close();
});

test('[F] Bob deletes the paragraph holding the phrase; both see the thread orphaned with its quote', async ({ page, phraiseServer, browser }) => {
  const alice = page;
  const context2 = await browser.newContext();
  const bob = await context2.newPage();

  await openAndWait(alice, phraiseServer, 'Alice');
  await openAndWait(bob, phraiseServer, 'Bob');
  await waitForInitialSync(alice, bob);

  await selectPhrase(alice, paragraphAt(alice, TARGET_PARAGRAPH), TARGET_TEXT, PHRASE);
  await addCommentViaButton(alice, 'What breed is this?');
  await expect(highlights(bob)).toHaveCount(1, { timeout: 10000 });

  // Bob selects the whole paragraph (a real triple-click, the browser's own
  // "select this block" gesture) and deletes it entirely: Backspace clears
  // the selected text, a second Backspace joins the now-empty paragraph
  // into its predecessor, removing the node.
  await bob.bringToFront();
  await paragraphAt(bob, TARGET_PARAGRAPH).click({ clickCount: 3 });
  await expect.poll(async () => (await selectionRange(bob)).text).toBe(TARGET_TEXT);
  await bob.keyboard.press('Backspace');
  await bob.keyboard.press('Backspace');
  await expect.poll(() => markdown(bob)).not.toContain(PHRASE);

  await expect.poll(() => markdown(alice)).not.toContain(PHRASE);

  // No highlight remains (nothing left to paint); both sidebars show the
  // thread under "Orphaned" with its original quote and a note.
  await expect(highlights(alice)).toHaveCount(0);
  await expect(highlights(bob)).toHaveCount(0);

  for (const [label, p] of [
    ['alice', alice],
    ['bob', bob],
  ] as const) {
    await expect(sidebar(p).locator('.phraise-comment-group-heading', { hasText: 'Orphaned' }), label).toBeVisible({ timeout: 10000 });
    const card = threadCards(p).first();
    await expect(card.locator('.phraise-comment-quote')).toHaveText(PHRASE);
    await expect(card.locator('.phraise-comment-orphan-note')).toHaveText('The text this comment referred to was deleted.');
  }

  await context2.close();
});

test('[F] the Markdown is byte-identical before and after adding, replying and resolving a comment', async ({ page, phraiseServer, browser }) => {
  const alice = page;
  const context2 = await browser.newContext();
  const bob = await context2.newPage();

  await openAndWait(alice, phraiseServer, 'Alice');
  await openAndWait(bob, phraiseServer, 'Bob');
  await waitForInitialSync(alice, bob);

  await selectPhrase(alice, paragraphAt(alice, TARGET_PARAGRAPH), TARGET_TEXT, PHRASE);
  await addCommentViaButton(alice, 'What breed is this?');
  await expect.poll(() => markdown(alice)).toBe(ORIGINAL);

  await expect(threadCards(bob)).toHaveCount(1, { timeout: 10000 });
  await bob.bringToFront();
  await threadCards(bob).first().locator('.phraise-comment-reply-input').click();
  await bob.keyboard.type('A golden retriever, obviously.');
  await bob.keyboard.press('Enter');
  await expect(threadCards(alice).first().locator('.phraise-comment-message')).toHaveCount(2);
  await expect.poll(() => markdown(bob)).toBe(ORIGINAL);

  await alice.bringToFront();
  await threadCards(alice).first().locator('.phraise-comment-resolve-btn').click();
  await expect(highlights(alice)).toHaveCount(0);

  await expect.poll(() => markdown(alice)).toBe(ORIGINAL);
  await expect.poll(() => markdown(bob)).toBe(ORIGINAL);

  await context2.close();
});

test('[F] a comment survives a reload and appears for a fresh third context', async ({ page, phraiseServer, browser }) => {
  const alice = page;

  await openAndWait(alice, phraiseServer, 'Alice');
  await expect.poll(() => markdown(alice)).toBe(ORIGINAL);

  await selectPhrase(alice, paragraphAt(alice, TARGET_PARAGRAPH), TARGET_TEXT, PHRASE);
  await addCommentViaButton(alice, 'What breed is this?');
  await expect(threadCards(alice)).toHaveCount(1);

  await alice.reload();
  await alice.waitForFunction(() => (window as unknown as { phraise?: unknown }).phraise != null);
  await expect.poll(() => markdown(alice)).toBe(ORIGINAL);
  await expect(threadCards(alice)).toHaveCount(1);
  await expect(threadCards(alice).first().locator('.phraise-comment-quote')).toHaveText(PHRASE);
  await expect(highlights(alice)).toHaveCount(1);

  const context2 = await page.context().browser()!.newContext();
  const carol = await context2.newPage();
  await openAndWait(carol, phraiseServer, 'Carol');
  await expect.poll(() => markdown(carol)).toBe(ORIGINAL);
  await expect(threadCards(carol)).toHaveCount(1, { timeout: 10000 });
  await expect(threadCards(carol).first().locator('.phraise-comment-quote')).toHaveText(PHRASE);
  await expect(highlights(carol)).toHaveCount(1, { timeout: 10000 });

  await context2.close();
});
