// Brief 04, gate D: two browser contexts (Alice and Bob) on one document
// through the relay, all edits by real keyboard and mouse. Uses
// `e2e/fixtures/collab.md` (verified to round-trip byte for byte before use
// -- see the builder log): two plain paragraphs, one per user, and two
// link-wrapped ("badge") images -- the exact shape spike 1's own
// `src/model/yjs.ts` file comment calls out ("The common case is a linked
// badge image `[![x](img)](href)`") and spike 5's gate B3 (D5) showed
// breaking on Yjs 14: replacing an image's address and its link together in
// one edit.
//
// Locating a paragraph: paragraphs are found by their POSITION among the
// editor's top-level `<p>` elements (`nth(index)`), never by `hasText`. A
// real bug found while writing this file (not guessed -- see the builder
// log): once a REMOTE user's caret lands inside a paragraph, `Collaboration
// Caret` renders that caret+its name label as a real DOM node injected
// mid-text (`<p>Alice's <span class="collaboration-cursor__caret">...
// <span class="collaboration-cursor__label">Bob</span>...</span>paragraph
// starts here.</p>`); the label's text becomes part of the paragraph's own
// `textContent`, so a `hasText` filter for the paragraph's plain text can
// stop matching (or match a different node) the instant the OTHER user's
// caret happens to sit inside it. Positional indexing is immune to this
// (and to the fixture's own doc order never changing across these tests).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page, Locator } from '@playwright/test';
import { test, expect } from './fixtures.js';
import { LINE_START } from './keys.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, 'fixtures', 'collab.md');
const DOC = 'collab.md';
const ORIGINAL = fs.readFileSync(FIXTURE, 'utf8');

// Doc order (after the level-1 heading): 0 = Alice's paragraph, 1 = Bob's
// paragraph, 2/3 = the two badge-image paragraphs.
const ALICE_PARAGRAPH = 0;
const BOB_PARAGRAPH = 1;
const ALICE_TEXT = "Alice's paragraph starts here.";
const BOB_TEXT = "Bob's paragraph starts here.";

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

/** Real inline images only -- ProseMirror also renders invisible
 * `.ProseMirror-separator` `<img>` placeholders around inline atoms for
 * cursor placement, which would otherwise shift `nth()` indices. */
function badgeImages(page: Page): Locator {
  return page.locator('#editor .ProseMirror img:not(.ProseMirror-separator)');
}

async function selectionParentOffset(page: Page): Promise<{ text: string; offset: number }> {
  return page.evaluate(() => {
    const editor = (window as unknown as { phraise: { editor: import('@tiptap/core').Editor } }).phraise.editor;
    const { $from } = editor.state.selection;
    return { text: $from.parent.textContent, offset: $from.parentOffset };
  });
}

/** Same pattern as gateA-typing.spec.ts's `placeCaret`: a plain click/press
 * resolves before ProseMirror's EditorView has necessarily caught up, so
 * every risky step is followed by a poll of the real selection state
 * (`editor.state.selection`, ProseMirror's own model -- unaffected by the
 * DOM-only caret-decoration issue described in this file's header comment). */
async function placeCaret(page: Page, locator: Locator, expectedText: string, offset: number): Promise<void> {
  await locator.click();
  await expect.poll(async () => (await selectionParentOffset(page)).text).toBe(expectedText);
  await page.keyboard.press(LINE_START);
  for (let i = 0; i < offset; i++) await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await selectionParentOffset(page)).offset).toBe(offset);
}

async function waitForInitialSync(pageA: Page, pageB: Page): Promise<void> {
  await expect.poll(() => markdown(pageA)).toBe(ORIGINAL);
  await expect.poll(() => markdown(pageB)).toBe(ORIGINAL);
}

/** A locator's `.boundingBox()` can transiently return null right after
 * `.toBeVisible()` passed (the remote-caret decoration widget can be
 * rebuilt on the next awareness tick) -- poll instead of a single read. */
async function nonZeroSize(locator: Locator): Promise<void> {
  await expect
    .poll(async () => {
      const box = await locator.boundingBox();
      return box ? box.width + box.height : 0;
    })
    .toBeGreaterThan(0);
}

/** Polls a caret's label for a real, non-transparent background colour
 * (see `nonZeroSize`'s comment: the decoration can be transiently rebuilt),
 * and returns the settled value. */
async function pollLabelColor(caret: Locator): Promise<string> {
  await expect
    .poll(() => caret.locator('.collaboration-cursor__label').evaluate((el) => getComputedStyle(el).backgroundColor))
    .not.toBe('rgba(0, 0, 0, 0)');
  return caret.locator('.collaboration-cursor__label').evaluate((el) => getComputedStyle(el).backgroundColor);
}

test("[D] each user types into a different paragraph and both see the other's text, converging on the same Markdown", async ({
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

  await placeCaret(alice, paragraphAt(alice, ALICE_PARAGRAPH), ALICE_TEXT, ALICE_TEXT.length);
  await alice.keyboard.type(' Typed by Alice.');

  await placeCaret(bob, paragraphAt(bob, BOB_PARAGRAPH), BOB_TEXT, BOB_TEXT.length);
  await bob.keyboard.type(' Typed by Bob.');

  const expected = ORIGINAL.replace(ALICE_TEXT, ALICE_TEXT + ' Typed by Alice.').replace(BOB_TEXT, BOB_TEXT + ' Typed by Bob.');

  await expect.poll(() => markdown(alice)).toBe(expected);
  await expect.poll(() => markdown(bob)).toBe(expected);

  await context2.close();
});

test('[D] both users type into the same paragraph at different positions and converge', async ({ page, phraiseServer, browser }) => {
  const alice = page;
  const context2 = await browser.newContext();
  const bob = await context2.newPage();

  await openAndWait(alice, phraiseServer, 'Alice');
  await openAndWait(bob, phraiseServer, 'Bob');
  await waitForInitialSync(alice, bob);

  const target = ALICE_TEXT;
  const nearStart = "Alice's ".length; // right before "paragraph"
  const nearEnd = target.length - 1; // right before the final "."

  // A real, verified finding (not guessed -- see the builder log): this
  // stack does NOT remap an IDLE remote user's own ProseMirror selection
  // through someone else's edit elsewhere in the same paragraph -- Bob's
  // selection stayed frozen at its old absolute offset even after Alice's
  // insertion shifted the surrounding text, which would make his next
  // keystroke land one character early if typed blindly. So Bob places his
  // OWN caret (by real keyboard navigation against the text as it stands
  // FOR HIM at that moment) AFTER Alice's edit has already arrived and
  // converged on his page, not before -- still two users typing into the
  // same paragraph at different positions and converging, just not
  // strictly simultaneously.
  await placeCaret(alice, paragraphAt(alice, ALICE_PARAGRAPH), target, nearStart);
  await alice.keyboard.type('AAA');

  const afterAlice = target.slice(0, nearStart) + 'AAA' + target.slice(nearStart);
  await expect.poll(() => markdown(bob)).toContain(afterAlice);

  const bobOffset = nearEnd + 'AAA'.length; // the same semantic anchor ("right before the final period"), now on the longer text
  await placeCaret(bob, paragraphAt(bob, ALICE_PARAGRAPH), afterAlice, bobOffset);
  await bob.keyboard.type('BBB');

  const expectedParagraph = afterAlice.slice(0, bobOffset) + 'BBB' + afterAlice.slice(bobOffset);
  const expected = ORIGINAL.replace(target, expectedParagraph);

  await expect.poll(() => markdown(alice)).toBe(expected);
  await expect.poll(() => markdown(bob)).toBe(expected);

  await context2.close();
});

test("[D] each user sees the other's caret with the right name label and a colour", async ({ page, phraiseServer, browser }) => {
  const alice = page;
  const context2 = await browser.newContext();
  const bob = await context2.newPage();

  await openAndWait(alice, phraiseServer, 'Alice');
  await openAndWait(bob, phraiseServer, 'Bob');
  await waitForInitialSync(alice, bob);

  // A caret is only broadcast via awareness once a user's selection has
  // actually been set inside the editor (a real mouse click), not merely
  // from the editor mounting -- so both click into their own paragraph
  // first.
  await paragraphAt(alice, ALICE_PARAGRAPH).click();
  await paragraphAt(bob, BOB_PARAGRAPH).click();

  // On Alice's page, Bob's caret+label should appear (and vice versa) --
  // a real caret element (`.collaboration-cursor__caret`) with non-zero
  // size, carrying the right name label, in the DOM.
  const bobCaretOnAlice = alice.locator('.collaboration-cursor__caret', { has: alice.locator('.collaboration-cursor__label', { hasText: 'Bob' }) });
  await expect(bobCaretOnAlice).toBeVisible({ timeout: 5000 });
  await nonZeroSize(bobCaretOnAlice);
  // The label/caret decoration can be transiently rebuilt on the next
  // awareness tick (same shape as the boundingBox race `nonZeroSize`
  // guards against), so poll for a real, non-transparent colour rather
  // than reading `getComputedStyle` once.
  const bobLabelColor = await pollLabelColor(bobCaretOnAlice);

  const aliceCaretOnBob = bob.locator('.collaboration-cursor__caret', { has: bob.locator('.collaboration-cursor__label', { hasText: 'Alice' }) });
  await expect(aliceCaretOnBob).toBeVisible({ timeout: 5000 });
  await nonZeroSize(aliceCaretOnBob);
  const aliceLabelColor = await pollLabelColor(aliceCaretOnBob);

  // Distinct users get distinct colours (colorForName is deterministic and
  // differs across these two names -- also unit-tested headless in
  // test/presence.spec.ts).
  expect(aliceLabelColor).not.toBe(bobLabelColor);

  // Also visible in the top bar's presence badge row (brief's task 1: "A
  // row of small name badges in the top bar shows who is here").
  await expect(alice.locator('#presence-badges .presence-badge', { hasText: 'Alice' })).toBeVisible();
  await expect(alice.locator('#presence-badges .presence-badge', { hasText: 'Bob' })).toBeVisible();
  await expect(bob.locator('#presence-badges .presence-badge', { hasText: 'Alice' })).toBeVisible();
  await expect(bob.locator('#presence-badges .presence-badge', { hasText: 'Bob' })).toBeVisible();

  await context2.close();
});

/** Opens the image popover for the `nth` badge image (0-indexed) via a real
 * mouse click, and applies a new address+link via real keyboard input
 * (click to focus/position the caret, Mod-A to select all, then type --
 * matching this spike's established "real keyboard and mouse" style rather
 * than Playwright's `.fill()`, which does not dispatch a real keystroke
 * sequence). */
async function editImageThroughPopover(page: Page, nth: number, newUrl: string, newHref: string): Promise<void> {
  const image = badgeImages(page).nth(nth);
  await image.click();

  const popover = page.locator('#phraise-image-popover');
  await expect(popover).toBeVisible();

  const addressInput = popover.locator('input[name="address"]');
  await addressInput.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type(newUrl);

  const linkInput = popover.locator('input[name="link"]');
  await linkInput.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type(newHref);

  await popover.getByRole('button', { name: 'Apply' }).click();
  await expect(popover).toBeHidden();
}

test("[D] a linked badge image's address and link, changed together through the popover, propagate to the other user and to a fresh third context", async ({
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

  // Alice changes the FIRST badge image.
  await editImageThroughPopover(alice, 0, 'https://img.shields.io/badge/one-red.svg', 'https://example.com/one-updated');

  const firstImageOnBob = badgeImages(bob).nth(0);
  await expect(firstImageOnBob).toHaveAttribute('src', 'https://img.shields.io/badge/one-red.svg', { timeout: 5000 });
  // The link mark wraps the image: its href shows up on the surrounding <a>.
  await expect(bob.locator('#editor .ProseMirror a[href="https://example.com/one-updated"] img:not(.ProseMirror-separator)')).toBeVisible();

  const expectedAfterAlice = ORIGINAL.replace(
    '[![Badge One](https://img.shields.io/badge/one-blue.svg)](https://example.com/one)',
    '[![Badge One](https://img.shields.io/badge/one-red.svg)](https://example.com/one-updated)',
  );
  await expect.poll(() => markdown(alice)).toBe(expectedAfterAlice);
  await expect.poll(() => markdown(bob)).toBe(expectedAfterAlice);

  // Bob does the same to the SECOND badge image; Alice sees it.
  await editImageThroughPopover(bob, 1, 'https://img.shields.io/badge/two-purple.svg', 'https://example.com/two-updated');

  const secondImageOnAlice = badgeImages(alice).nth(1);
  await expect(secondImageOnAlice).toHaveAttribute('src', 'https://img.shields.io/badge/two-purple.svg', { timeout: 5000 });
  await expect(alice.locator('#editor .ProseMirror a[href="https://example.com/two-updated"] img:not(.ProseMirror-separator)')).toBeVisible();

  const expectedFinal = expectedAfterAlice.replace(
    '[![Badge Two](https://img.shields.io/badge/two-green.svg)](https://example.com/two)',
    '[![Badge Two](https://img.shields.io/badge/two-purple.svg)](https://example.com/two-updated)',
  );
  await expect.poll(() => markdown(alice)).toBe(expectedFinal);
  await expect.poll(() => markdown(bob)).toBe(expectedFinal);

  // A fresh third context reads the relay's OWN stored document (not
  // Alice's/Bob's in-memory state) and agrees.
  const context3 = await browser.newContext();
  const carol = await context3.newPage();
  await openAndWait(carol, phraiseServer, 'Carol');
  await expect.poll(() => markdown(carol)).toBe(expectedFinal);

  await context3.close();
  await context2.close();
});

// Brief 05, finding 1: the local caret does not follow a remote edit made
// EARLIER in the same paragraph while it is idle. Root cause (confirmed by
// reading `node_modules/@tiptap/y-tiptap/dist/y-tiptap.js` 3.0.9, see the
// builder log): `restoreRelativeSelection` resolves the selection correctly
// from the Yjs relative position, then `recoverSelectionEndpoint`'s
// `isMisresolvedAfterStructuralChange` heuristic (added in 3.0.6/3.0.7 for
// drag-and-drop block moves) treats the paragraph's changed `textContent`
// as a sign of misresolution and can "recover" a stale absolute offset from
// the OLD document instead. Fixed by `src/collab/workarounds/
// localCaretFollow.ts` (a third `PhraiseWorkarounds` plugin) without
// touching `node_modules` or the pinned version.
test("[D] the local caret stays in place while the other user types before it in the same paragraph", async ({
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

  const target = ALICE_TEXT;
  const bobOffset = "Alice's ".length; // right before "paragraph"

  // Bob places his caret MID-paragraph and then stays idle -- no re-click,
  // no fresh selection read, before his next keystroke below. This is the
  // exact shape of the bug: an idle local caret whose position must be
  // carried forward by the binding itself, not by anything this test does.
  await bob.bringToFront();
  await placeCaret(bob, paragraphAt(bob, ALICE_PARAGRAPH), target, bobOffset);

  // Alice types before Bob's caret, at the very start of the same paragraph.
  await alice.bringToFront();
  await placeCaret(alice, paragraphAt(alice, ALICE_PARAGRAPH), target, 0);
  await alice.keyboard.type('AAA ');

  const afterAlice = 'AAA ' + target;
  await expect.poll(() => markdown(bob)).toContain(afterAlice);

  // Bob's very next keystroke, typed WITHOUT touching his caret again,
  // must land at the SAME logical point (right before "paragraph"), not
  // four characters early (inside the "AAA " the fix must have already
  // carried his caret past).
  await bob.bringToFront();
  await bob.keyboard.type('XYZ');

  const expectedParagraph = 'AAA ' + target.slice(0, bobOffset) + 'XYZ' + target.slice(bobOffset);
  const expected = ORIGINAL.replace(target, expectedParagraph);

  await expect.poll(() => markdown(alice)).toBe(expected);
  await expect.poll(() => markdown(bob)).toBe(expected);

  await context2.close();
});

test('[D] both users place idle carets in the same paragraph first, then type several words interleaved; each lands contiguously at its own caret', async ({
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

  const target = ALICE_TEXT;

  // BOTH carets placed BEFORE either user types anything -- Alice at the
  // very start, Bob at the very end of the same paragraph (the exact
  // position the orchestrator's own repro used).
  await alice.bringToFront();
  await placeCaret(alice, paragraphAt(alice, ALICE_PARAGRAPH), target, 0);
  await bob.bringToFront();
  await placeCaret(bob, paragraphAt(bob, ALICE_PARAGRAPH), target, target.length);

  const aliceWords = ['one', 'two', 'three'];
  const bobWords = ['uno', 'dos', 'tres'];
  for (let i = 0; i < aliceWords.length; i++) {
    await alice.bringToFront();
    await alice.keyboard.type(aliceWords[i] + ' ');
    await bob.bringToFront();
    await bob.keyboard.type(' ' + bobWords[i]);
  }

  const aliceTyped = aliceWords.map((w) => `${w} `).join('');
  const bobTyped = bobWords.map((w) => ` ${w}`).join('');
  const expectedParagraph = aliceTyped + target + bobTyped;
  const expected = ORIGINAL.replace(target, expectedParagraph);

  await expect.poll(() => markdown(alice)).toBe(expected);
  await expect.poll(() => markdown(bob)).toBe(expected);

  await context2.close();
});
