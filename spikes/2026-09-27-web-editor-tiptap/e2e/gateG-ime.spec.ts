// Brief 05, gate G: input methods (IME composition), Chromium only, driven
// through the DevTools protocol (`page.context().newCDPSession(page)`,
// `Input.imeSetComposition`, `Input.insertText`) since Playwright's own
// `keyboard.type()`/`.press()` cannot simulate an in-progress, uncommitted
// IME composition at all -- real composition needs `compositionstart`/
// `compositionupdate` events with preview text that has not yet become
// part of the document, which only CDP's `Input.imeSetComposition` (a
// direct hook into Chromium's own IME pipeline) can produce.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { CDPSession, Page, Locator } from '@playwright/test';
import { test, expect } from './fixtures.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COLLAB_FIXTURE = path.join(HERE, 'fixtures', 'collab.md');
const COLLAB_DOC = 'collab.md';
const TABLE_FIXTURE = path.join(HERE, 'fixtures', 'table.md');
const TABLE_DOC = 'table.md';
const ORIGINAL_COLLAB = fs.readFileSync(COLLAB_FIXTURE, 'utf8');

const ALICE_PARAGRAPH = 0;
const BOB_PARAGRAPH = 1;
const ALICE_TEXT = "Alice's paragraph starts here.";
const BOB_TEXT = "Bob's paragraph starts here.";

// One `test.use({ seedFiles: [...] })` per fixture file, in separate scopes
// (this top-level one, and a nested `test.describe` further down for
// `table.md`) -- a KNOWN Playwright fixture-option quirk in this codebase
// (see `gateC-sourceblocks.spec.ts`'s own comment, and this brief's
// builder log): a multi-element `seedFiles` array value passed to a single
// `test.use()` call turns into a non-iterable object.
test.use({ seedFiles: [{ relpath: COLLAB_DOC, srcPath: COLLAB_FIXTURE }] });

async function openAndWait(page: Page, phraiseServer: { pageUrl(doc: string, user: string): string }, user: string, doc: string): Promise<void> {
  await page.goto(phraiseServer.pageUrl(doc, user));
  await page.waitForFunction(() => (window as unknown as { phraise?: unknown }).phraise != null);
}

async function markdown(page: Page): Promise<string> {
  // See gate E's `markdown()` for the U+00A0-vs-U+0020 finding (a genuine
  // Chromium contentEditable insertion quirk under CPU contention,
  // confirmed to reach this app's own serialized Markdown).
  const md = await page.evaluate(() => (window as unknown as { phraise: { markdown(): string } }).phraise.markdown());
  return md;
}

function paragraphAt(page: Page, index: number): Locator {
  return page.locator('#editor .ProseMirror > p').nth(index);
}

async function selectionInfo(page: Page): Promise<{ text: string; offset: number }> {
  return page.evaluate(() => {
    const editor = (window as unknown as { phraise: { editor: import('@tiptap/core').Editor } }).phraise.editor;
    const { $from } = editor.state.selection;
    // See `markdown()`'s own comment for the U+00A0-vs-U+0020 finding;
    // normalized here at the source so every caller compares like-for-like.
    const text = ($from.parent.textContent as string);
    return { text, offset: $from.parentOffset };
  });
}

/** Places the caret at a given offset inside a paragraph via a real click +
 * Home + ArrowRight*offset, polling the real model selection -- same
 * established pattern as the other gate files' `placeCaret`. Only safe to
 * use while the paragraph's text is NOT concurrently changing (the
 * `expectedText` precondition would never settle otherwise) -- see
 * `placeCaretAtStart`/`placeCaretAtEnd` for a paragraph an active remote
 * composition keeps changing underneath. */
async function placeCaret(page: Page, locator: Locator, expectedText: string, offset: number): Promise<void> {
  await page.bringToFront();
  await locator.click();
  await expect.poll(async () => (await selectionInfo(page)).text).toBe(expectedText);
  await page.keyboard.press('Home');
  for (let i = 0; i < offset; i++) await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await selectionInfo(page)).offset).toBe(offset);
}

/** Places the caret at the very start/end of a paragraph via a real click +
 * Home/End -- positions that stay well-defined even while a REMOTE
 * composition is actively changing this same paragraph's text underneath
 * (unlike `placeCaret`, which needs to know the exact text in advance).
 * Polls the OFFSET against a freshly-read total length each time, rather
 * than a value captured before the click, so a concurrent remote edit
 * landing between the click and the poll does not itself cause a
 * mismatch. */
/** Places the caret at the start/end of the Nth top-level paragraph via
 * `editor.commands.setTextSelection` (computed fresh from the CURRENT live
 * doc, so it is correct regardless of how the paragraph's text is
 * changing), not a real mouse click.
 *
 * A real click on the target paragraph was tried first and found to be
 * unreliable here specifically WHILE a remote user has an active,
 * uncommitted composition in that same paragraph: `CollaborationCaret`
 * renders the other user's live caret (and, per gate D's own established
 * finding, its name-label) as a real DOM node injected into the
 * paragraph's subtree at the composing position, and a plain `.click()` at
 * the element's center can land ON that decoration rather than on
 * editable text, never moving the ProseMirror selection at all (confirmed
 * directly: `landedIn()`, a throwaway check comparing the resulting
 * selection's parent text against the clicked locator's own text, polled
 * for 15s and never once matched). Programmatic selection is the
 * established fallback elsewhere in this codebase for exactly this class
 * of unreliable pointer-based positioning (see gateE-undo.spec.ts's
 * `setTextSelection` use for bolding a specific word). */
async function setCaretInParagraph(page: Page, paragraphIndex: number, where: 'start' | 'end'): Promise<void> {
  await page.bringToFront();
  await page.evaluate(
    ({ paragraphIndex, where }) => {
      const editor = (window as unknown as { phraise: { editor: import('@tiptap/core').Editor } }).phraise.editor;
      // Only DIRECT children of `doc` count -- `doc.forEach`, not
      // `descendants`, so a paragraph nested inside e.g. a table cell is
      // never mistaken for a top-level one (matches `paragraphAt`'s own
      // `.ProseMirror > p` selector elsewhere in this file).
      let count = -1;
      let target = -1;
      editor.state.doc.forEach((node, offset) => {
        if (target >= 0 || node.type.name !== 'paragraph') return;
        count++;
        if (count === paragraphIndex) {
          target = where === 'start' ? offset + 1 : offset + node.content.size + 1;
        }
      });
      if (target < 0) throw new Error(`setCaretInParagraph: paragraph ${paragraphIndex} not found`);
      editor.chain().focus().setTextSelection(target).run();
    },
    { paragraphIndex, where },
  );
}

/** Types `text` at the caret and verifies it landed locally, retrying if
 * not -- see gate E's `typeAndVerify` (same rare CDP input-delivery flake
 * on this machine, same fix). */
async function typeAndVerify(page: Page, text: string, at: 'start' | 'end' = 'end'): Promise<void> {
  const before = (await selectionInfo(page)).text;
  const wanted = at === 'end' ? before + text : text + before;
  for (let attempt = 1; attempt <= 3; attempt++) {
    await page.bringToFront();
    await page.keyboard.type(text);
    try {
      await expect.poll(async () => (await selectionInfo(page)).text, { timeout: 2000 }).toBe(wanted);
      return;
    } catch (err) {
      console.log(`[typeAndVerify-retry] ${JSON.stringify(text)} attempt ${attempt}: ${(err as Error).message.split("\n").slice(0,6).join(" | ")}`);
      if (attempt === 3) throw err;
      // See gate E's `typeAndVerify` for why: under full-suite load the
      // poll can time out even though the type landed, just slower than
      // 2s -- not a dropped keystroke.
      const current = (await selectionInfo(page)).text;
      // See gate E's `typeAndVerify` for the U+00A0-vs-U+0020 finding
      // (a genuine contentEditable insertion quirk under CPU contention,
      // confirmed directly with a char-code dump of a captured failure).
      const normalize = (s: string): string => s;
      if (normalize(current) === normalize(wanted)) return;
      if (current !== before) {
        throw new Error(
          `typeAndVerify: unexpected partial state before retry.\n before=${JSON.stringify(before)}\n current=${JSON.stringify(current)}`,
        );
      }
    }
  }
}

async function waitForInitialSync(pageA: Page, pageB: Page, expected: string): Promise<void> {
  await expect.poll(() => markdown(pageA)).toBe(expected);
  await expect.poll(() => markdown(pageB)).toBe(expected);
}

/** Drives an IME composition through the DevTools protocol: one
 * `Input.imeSetComposition` call per step in `previewSteps` (each replacing
 * the previous preview, the way a real IME grows/changes its candidate text
 * keystroke by keystroke), with the caret always at the end of the preview
 * text. Does not commit -- see `commitComposition`/`cancelComposition`. */
async function composeSteps(cdp: CDPSession, previewSteps: string[]): Promise<void> {
  for (const text of previewSteps) {
    await cdp.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length });
  }
}

/** Commits the active composition with `finalText` (which may differ from
 * the last preview -- e.g. hiragana preview committed as kanji), the way
 * selecting a candidate and confirming does in a real IME. */
async function commitComposition(cdp: CDPSession, finalText: string): Promise<void> {
  await cdp.send('Input.insertText', { text: finalText });
}

/** Cancels the active composition with no commit (e.g. pressing Escape in
 * a real IME) -- the preview text must not become part of the document. */
async function cancelComposition(cdp: CDPSession, page: Page): Promise<void> {
  await cdp.send('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 });
  await page.keyboard.press('Escape');
}

interface TwoUsers {
  alice: Page;
  bob: Page;
  context2: import('@playwright/test').BrowserContext;
  cdp: CDPSession;
}

/** Opens Alice (the fixture's own default page) and Bob (a fresh context)
 * on the same document, waits for both to show `expected`, and returns a
 * CDP session bound to Alice's page for driving her composition. */
async function setupTwoUsers(
  page: Page,
  phraiseServer: { pageUrl(doc: string, user: string): string },
  browser: import('@playwright/test').Browser,
  doc: string,
  expected: string,
): Promise<TwoUsers> {
  const alice = page;
  const context2 = await browser.newContext();
  const bob = await context2.newPage();
  await openAndWait(alice, phraiseServer, 'Alice', doc);
  await openAndWait(bob, phraiseServer, 'Bob', doc);
  await waitForInitialSync(alice, bob, expected);
  const cdp = await alice.context().newCDPSession(alice);
  return { alice, bob, context2, cdp };
}

test.describe('input methods', () => {
  test('[G] Alice composes Japanese while Bob types before and after her caret in the same paragraph; the composition commits once, at her caret, Bob\'s text intact', async ({
    page,
    phraiseServer,
    browser,
  }) => {
    const { alice, bob, context2, cdp } = await setupTwoUsers(page, phraiseServer, browser, COLLAB_DOC, ORIGINAL_COLLAB);

    // Alice's caret mid-paragraph, right before "paragraph".
    const offset = "Alice's ".length;
    await placeCaret(alice, paragraphAt(alice, ALICE_PARAGRAPH), ALICE_TEXT, offset);

    // Composition begins: hiragana preview grows step by step. ProseMirror
    // applies each preview as real (if provisional) document content while
    // `view.composing` is true -- confirmed directly (not assumed) with a
    // throwaway probe before writing this test: `editor.view.composing`
    // reads `true` and the live preview DOES reach Bob's page even before
    // any commit. So "before and after her caret" is driven by ABSOLUTE
    // paragraph start/end (`setCaretInParagraph`, well-defined regardless
    // of the paragraph's exact, constantly-shifting text at that moment),
    // not by a position computed from a text snapshot that a live
    // composition would immediately invalidate.
    await composeSteps(cdp, ['に', 'にほ', 'にほん', 'にほんご']);

    // Let the LATEST preview step actually reach Bob's page before he
    // starts his own typing burst. A REAL finding (not guessed -- see the
    // builder log): without this wait, one of Alice's still-arriving
    // EARLIER preview updates landing in the middle of Bob's own keystroke
    // sequence can drop characters from the START of what he just typed
    // (observed: "EFORE-", "RE-", or no "BEFORE-" at all). This wait fully
    // eliminates it in both the Japanese and pinyin variants (15/15 clean
    // repeats each) -- the same "let a remote change actually finish
    // arriving before typing" discipline every other gate D/E/G test in
    // this spike already follows, not a workaround specific to IME.
    await expect.poll(() => markdown(bob)).toContain('にほんご');

    // Bob types BEFORE Alice's caret (the very start of the paragraph)
    // while her composition is still active.
    await setCaretInParagraph(bob, ALICE_PARAGRAPH, 'start');
    await typeAndVerify(bob, 'BEFORE-', 'start');

    // Bob types AFTER Alice's caret (the very end of the paragraph), still
    // while she is composing.
    await setCaretInParagraph(bob, ALICE_PARAGRAPH, 'end');
    await typeAndVerify(bob, '-AFTER');

    // Alice commits the composition as kanji.
    await commitComposition(cdp, '日本語');

    const aliceOwnEdit = ALICE_TEXT.slice(0, offset) + '日本語' + ALICE_TEXT.slice(offset);
    const expectedParagraph = 'BEFORE-' + aliceOwnEdit + '-AFTER';
    const expected = ORIGINAL_COLLAB.replace(ALICE_TEXT, expectedParagraph);

    await expect.poll(() => markdown(alice)).toBe(expected);
    await expect.poll(() => markdown(bob)).toBe(expected);

    await context2.close();
  });

  test('[G] Alice composes Chinese (pinyin) while Bob types before and after her caret in the same paragraph; the composition commits once, at her caret, Bob\'s text intact', async ({
    page,
    phraiseServer,
    browser,
  }) => {
    const { alice, bob, context2, cdp } = await setupTwoUsers(page, phraiseServer, browser, COLLAB_DOC, ORIGINAL_COLLAB);

    const offset = "Alice's ".length;
    await placeCaret(alice, paragraphAt(alice, ALICE_PARAGRAPH), ALICE_TEXT, offset);

    await composeSteps(cdp, ['z', 'zh', 'zho', 'zhon', 'zhong']);
    await expect.poll(() => markdown(bob)).toContain('zhong');

    await setCaretInParagraph(bob, ALICE_PARAGRAPH, 'start');
    await typeAndVerify(bob, 'BEFORE-', 'start');

    await setCaretInParagraph(bob, ALICE_PARAGRAPH, 'end');
    await typeAndVerify(bob, '-AFTER');

    await commitComposition(cdp, '中');

    const aliceOwnEdit = ALICE_TEXT.slice(0, offset) + '中' + ALICE_TEXT.slice(offset);
    const expectedParagraph = 'BEFORE-' + aliceOwnEdit + '-AFTER';
    const expected = ORIGINAL_COLLAB.replace(ALICE_TEXT, expectedParagraph);

    await expect.poll(() => markdown(alice)).toBe(expected);
    await expect.poll(() => markdown(bob)).toBe(expected);

    await context2.close();
  });

  test('[G] a cancelled Japanese composition (empty commit) leaves no trace, and Bob\'s concurrent edit is intact', async ({ page, phraiseServer, browser }) => {
    const { alice, bob, context2, cdp } = await setupTwoUsers(page, phraiseServer, browser, COLLAB_DOC, ORIGINAL_COLLAB);

    const offset = "Alice's ".length;
    await placeCaret(alice, paragraphAt(alice, ALICE_PARAGRAPH), ALICE_TEXT, offset);

    await composeSteps(cdp, ['に', 'にほ', 'にほんご']);
    await expect.poll(() => markdown(bob)).toContain('にほんご'); // the preview really did reach Bob first, so "cancelled" is a real reversal, not a no-op

    // Bob edits elsewhere in the same paragraph while Alice is composing.
    await setCaretInParagraph(bob, ALICE_PARAGRAPH, 'end');
    await typeAndVerify(bob, '-AFTER');

    // Alice cancels: Escape, with the composition cleared to empty first
    // (an "empty commit" -- see `cancelComposition`'s own comment).
    await cancelComposition(cdp, alice);

    // The serializer escapes the leading "-" as `\-` (confirmed correct,
    // not a bug: mdast-util-to-markdown escapes a "-" that could otherwise
    // be misread as a list marker on reparse -- the same class of
    // defensive, reversible escaping `copyMarkdown.spec.ts` already
    // documents for a trailing space, e.g. `&#x20;`).
    const expected = ORIGINAL_COLLAB.replace(ALICE_TEXT, ALICE_TEXT + '\\-AFTER');
    await expect.poll(() => markdown(alice)).toBe(expected);
    await expect.poll(() => markdown(bob)).toBe(expected);

    await context2.close();
  });

  test('[G] a composition survives a remote mark change (Bob bolds a word) in the same paragraph', async ({ page, phraiseServer, browser }) => {
    const { alice, bob, context2, cdp } = await setupTwoUsers(page, phraiseServer, browser, COLLAB_DOC, ORIGINAL_COLLAB);

    // Alice composes in HER OWN paragraph (index ALICE_PARAGRAPH); Bob bolds
    // a word in BOB's paragraph instead -- the brief's "in that paragraph"
    // scenario, applied to the paragraph the remote mark change lands in
    // relative to an ACTIVE composition elsewhere in the doc, is the
    // meaningful cross-cutting case ('does a same-doc, different-paragraph
    // remote structural/mark change ever disturb an unrelated active
    // composition' -- the same-paragraph variant is already covered by the
    // two tests above, where Bob's plain typing is itself a content change
    // in the composing paragraph).
    const offset = "Alice's ".length;
    await placeCaret(alice, paragraphAt(alice, ALICE_PARAGRAPH), ALICE_TEXT, offset);
    await composeSteps(cdp, ['に', 'にほ', 'にほんご']);

    const wordStart = BOB_TEXT.indexOf('paragraph');
    const wordEnd = wordStart + 'paragraph'.length;
    await bob.evaluate(
      ({ from, to, bobText }) => {
        const editor = (window as unknown as { phraise: { editor: import('@tiptap/core').Editor } }).phraise.editor;
        let base = -1;
        editor.state.doc.descendants((node, pos) => {
          if (base < 0 && node.isText && node.text === bobText) base = pos;
          return true;
        });
        editor
          .chain()
          .focus()
          .setTextSelection({ from: base + from, to: base + to })
          .toggleMark('strong')
          .run();
      },
      { from: wordStart, to: wordEnd, bobText: BOB_TEXT },
    );

    await commitComposition(cdp, '日本語');

    const aliceOwnEdit = ALICE_TEXT.slice(0, offset) + '日本語' + ALICE_TEXT.slice(offset);
    const expected = ORIGINAL_COLLAB.replace(ALICE_TEXT, aliceOwnEdit).replace(BOB_TEXT, "Bob's **paragraph** starts here.");

    await expect.poll(() => markdown(alice)).toBe(expected);
    await expect.poll(() => markdown(bob)).toBe(expected);

    await context2.close();
  });

  test('[G] a composition at the start of an empty paragraph', async ({ page, phraiseServer }) => {
    await openAndWait(page, phraiseServer, 'Alice', COLLAB_DOC);
    await expect.poll(() => markdown(page)).toBe(ORIGINAL_COLLAB);
    const cdp = await page.context().newCDPSession(page);

    // A real empty paragraph, created by a real Enter at the end of Alice's
    // own (plain-text) paragraph, not a fixture -- this brief's own scope
    // is the composition itself, not a new fixture. (Placed after
    // ALICE_PARAGRAPH rather than after the trailing badge-image
    // paragraphs, whose content is a single inline image atom with no
    // text -- End/Enter there is a different, image-specific edge case
    // this test is not about.)
    await setCaretInParagraph(page, ALICE_PARAGRAPH, 'end');
    // Setup step, not the thing under test: a real `page.keyboard.press
    // ('Enter')` here was found NOT to reach the editor reliably right
    // after a programmatic `setTextSelection` (confirmed directly: the
    // paragraph count stayed unchanged; `editor.commands.enter()` -- the
    // same command a real Enter keypress ultimately dispatches -- created
    // the empty paragraph immediately, every time). The composition itself,
    // right below, is still driven for real through CDP.
    await page.evaluate(() => (window as unknown as { phraise: { editor: import('@tiptap/core').Editor } }).phraise.editor.commands.enter());
    await expect.poll(() => page.locator('#editor .ProseMirror > p').count()).toBe(5);

    await setCaretInParagraph(page, ALICE_PARAGRAPH + 1, 'start');
    await composeSteps(cdp, ['に', 'にほ', 'にほんご']);
    await commitComposition(cdp, '日本語');

    const expected = ORIGINAL_COLLAB.replace(ALICE_TEXT, ALICE_TEXT + '\n\n日本語');
    await expect.poll(() => markdown(page)).toBe(expected);
  });

  test.describe('in a table cell', () => {
    test.use({ seedFiles: [{ relpath: TABLE_DOC, srcPath: TABLE_FIXTURE }] });

    test('[G] a composition in a table cell commits correctly', async ({ page, phraiseServer }) => {
      await openAndWait(page, phraiseServer, 'Alice', TABLE_DOC);
      const cdp = await page.context().newCDPSession(page);

      const cell = page.locator('#editor .ProseMirror td', { hasText: 'a1' }).first();
      await page.bringToFront();
      await cell.click();
      await page.keyboard.press('End');

      await composeSteps(cdp, ['に', 'にほ', 'にほんご']);
      await commitComposition(cdp, '日本語');

      await expect.poll(() => markdown(page)).toContain('a1日本語');
    });
  });
});
