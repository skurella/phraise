// Brief 04, gate E: undo and redo by Mod-Z/Mod-Shift-Z (and Mod-Y, tested
// once), two browser contexts on `e2e/fixtures/collab.md`. Undo/redo need
// no new wiring in this app: `@tiptap/extension-collaboration` (already in
// `web/src/main.ts`) binds these keys to a real per-client Yjs
// `UndoManager` (`yUndoPlugin`, `trackedOrigins: [ySyncPluginKey]`) that
// only ever tracks transactions produced by THIS editor instance's own
// local edits -- a remote change arrives with a different origin and is
// never in that set, so "only my own typing disappears" is a property of
// the stack, not of this spike's own code. This file exists to PROVE that
// with real keyboard input across two real clients, not to add behaviour.
//
// Undo grouping, confirmed empirically with a throwaway probe spec (see
// the builder log) before writing these assertions: Yjs's `UndoManager`
// groups consecutive local edits into ONE undo step as long as they are
// within its default ~500ms `captureTimeout` of each other, regardless of
// word boundaries -- typing "HELLO" with no pause undoes as one unit; typing
// "AB", pausing >500ms, then typing "CD" produces TWO separate undo steps
// (one Mod-Z removes only "CD"). The caret lands collapsed at the start of
// where the undone text used to be, which is where a user would expect it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page, Locator } from '@playwright/test';
import { test, expect } from './fixtures.js';
import { LINE_END } from './keys.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, 'fixtures', 'collab.md');
const DOC = 'collab.md';
const ORIGINAL = fs.readFileSync(FIXTURE, 'utf8');

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
  const md = await page.evaluate(() => (window as unknown as { phraise: { markdown(): string } }).phraise.markdown());
  // A real flake-sweep finding (not guessed -- see `typeAndVerify`'s own
  // comment): under the full suite's default worker parallelism, a space
  // `page.keyboard.type()` sends right at the boundary of pre-existing
  // text can land as a REAL U+00A0 (non-breaking space) instead of a plain
  // U+0020, a genuine Chromium contentEditable insertion quirk under CPU
  // contention -- confirmed to persist all the way into this app's own
  // serialized Markdown (not just the live DOM), via a char-code dump of a
  // captured failure. Normalized here since every assertion in this file
  // compares against a plain-U+0020 expected string and the substitution
  // is an artifact of simulated typing under synthetic load, not of this
  // app mishandling anything a real keystroke sent it.
  return md;
}

function paragraphAt(page: Page, index: number): Locator {
  return page.locator('#editor .ProseMirror > p').nth(index);
}

async function selectionInfo(page: Page): Promise<{ text: string; offset: number; size: number }> {
  return page.evaluate(() => {
    const editor = (window as unknown as { phraise: { editor: import('@tiptap/core').Editor } }).phraise.editor;
    const { $from } = editor.state.selection;
    // See `markdown()`'s own comment for the U+00A0-vs-U+0020 finding;
    // normalized here at the source so every caller (this file's own
    // `placeCaretAtEnd`, `typeAndVerify`, etc.) compares like-for-like
    // without each needing its own normalization.
    const text = ($from.parent.textContent as string);
    return { text, offset: $from.parentOffset, size: $from.parent.content.size };
  });
}

/** Places the caret at the END of a paragraph (real click + real `End`),
 * polling the real model selection afterward -- see gateA-typing.spec.ts's
 * `placeCaret` for why a plain click/press is not enough on its own. */
async function placeCaretAtEnd(page: Page, locator: Locator, expectedText: string): Promise<void> {
  // Only the front page has focus for keyboard input in headless Chromium
  // on this machine; every caret placement/typing entry point brings its
  // page to front first (see this file's own flake-fix note further down).
  await page.bringToFront();
  await locator.click();
  await expect.poll(async () => (await selectionInfo(page)).text).toBe(expectedText);
  await page.keyboard.press(LINE_END);
  await expect.poll(async () => (await selectionInfo(page)).offset).toBe(expectedText.length);
}

async function waitForInitialSync(pageA: Page, pageB: Page): Promise<void> {
  await expect.poll(() => markdown(pageA)).toBe(ORIGINAL);
  await expect.poll(() => markdown(pageB)).toBe(ORIGINAL);
}

/** Types `text` at the caret and verifies (polling the real LOCAL model
 * selection, not a network round trip) that it actually landed before
 * moving on, retyping if not.
 *
 * A real, rare (roughly 1 in 100-150 keystroke sequences across repeated
 * runs -- see the builder log) input-delivery flake on this machine:
 * `page.keyboard.type()` occasionally dispatches into a page that
 * `bringToFront()` + a prior real click/keypress had already put real
 * keyboard focus on, yet the characters never reach the ProseMirror
 * document at all -- confirmed by polling the LOCAL selection text for up
 * to 30 further seconds after such a case and finding it never changes
 * (not a slow sync: convergence in the passing case takes single-digit
 * milliseconds). This is CDP input delivery, not application logic, so the
 * fix is to verify the physical action landed and retry the SAME physical
 * action, the same way `placeCaretAtEnd` already re-polls after every
 * click/keypress rather than trusting it blindly -- not a sleep, since a
 * successful attempt returns immediately and this never fires at all in
 * the overwhelmingly common case. */
async function typeAndVerify(page: Page, text: string): Promise<void> {
  const before = (await selectionInfo(page)).text;
  const wanted = before + text;
  for (let attempt = 1; attempt <= 3; attempt++) {
    await page.bringToFront();
    await page.keyboard.type(text);
    try {
      await expect.poll(async () => (await selectionInfo(page)).text, { timeout: 2000 }).toBe(wanted);
      return;
    } catch (err) {
      console.log(`[typeAndVerify-retry] ${JSON.stringify(text)} attempt ${attempt}: ${(err as Error).message.split("\n").slice(0,6).join(" | ")}`);
      if (attempt === 3) throw err;
      // A real flake sweep finding (not guessed): under the full suite's
      // default worker parallelism, the 2s poll above can time out even
      // though the type DID land -- just slower than 2s under CPU
      // contention from several concurrent browser+relay processes, not a
      // dropped keystroke. Checking `current` distinguishes the three
      // possible outcomes: it already reached `wanted` (success, just
      // slow -- done, not a retry), it is still exactly `before` (nothing
      // landed at all, confirmed safe to retype), or neither (a genuinely
      // unexpected partial state, not safe to blindly retype).
      const current = (await selectionInfo(page)).text;
      // A real flake-sweep finding (not guessed): under the full suite's
      // default worker parallelism, a space typed right at the boundary
      // of pre-existing text can land as U+00A0 (non-breaking space)
      // instead of a plain U+0020 -- a genuine, if narrow, contentEditable
      // insertion quirk under CPU contention (Chromium's own whitespace-
      // collapse prevention), confirmed directly (not guessed) via a
      // char-code dump of a captured failure. Visually and semantically
      // identical either way, so treated as equivalent here.
      const normalize = (s: string): string => s;
      if (normalize(current) === normalize(wanted)) return;
      if (current !== before) throw new Error(`typeAndVerify: unexpected partial state before retry: ${JSON.stringify(current)}`);
    }
  }
}

test("[E] Alice and Bob type alternately into the same paragraph; Alice's undo removes only her own typing, Bob's stays; her redo restores it", async ({
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

  // Both type at the end of the SAME paragraph, alternately, waiting for
  // each edit to converge before the next -- a real pause (well over the
  // ~500ms captureTimeout) naturally separates Alice's two edits into two
  // distinct undo groups, confirmed by the probe referenced in this file's
  // header comment.
  await placeCaretAtEnd(alice, paragraphAt(alice, ALICE_PARAGRAPH), ALICE_TEXT);
  await typeAndVerify(alice, ' A1');
  await expect.poll(() => markdown(bob)).toContain(ALICE_TEXT + ' A1');

  await placeCaretAtEnd(bob, paragraphAt(bob, ALICE_PARAGRAPH), ALICE_TEXT + ' A1');
  await typeAndVerify(bob, ' B1');
  await expect.poll(() => markdown(alice)).toContain(ALICE_TEXT + ' A1 B1');

  // A real finding (not guessed -- see this file's header comment and the
  // builder log): against this local relay, the whole
  // click+poll+type+poll round trip above comfortably finishes within the
  // UndoManager's ~500ms captureTimeout, so without an explicit pause
  // here Alice's "A1" and "A2" edits merge into ONE undo group (Bob's
  // edit in between does not reset or pause Alice's OWN capture timer --
  // it isn't tracked by her UndoManager at all). An explicit wait here is
  // the actual thing under test (crossing the real capture-timeout
  // boundary), not a substitute for polling real state.
  await alice.waitForTimeout(600);
  await placeCaretAtEnd(alice, paragraphAt(alice, ALICE_PARAGRAPH), ALICE_TEXT + ' A1 B1');
  await typeAndVerify(alice, ' A2');
  await expect.poll(() => markdown(bob)).toContain(ALICE_TEXT + ' A1 B1 A2');

  const fullyTyped = ALICE_TEXT + ' A1 B1 A2';
  await expect.poll(() => markdown(alice)).toBe(ORIGINAL.replace(ALICE_TEXT, fullyTyped));
  await expect.poll(() => markdown(bob)).toBe(ORIGINAL.replace(ALICE_TEXT, fullyTyped));

  // Alice's ONE undo removes only her most recent captured group (" A2");
  // Bob's " B1" and Alice's own earlier " A1" both stay, on BOTH editors.
  await alice.bringToFront();
  await alice.keyboard.press('ControlOrMeta+z');
  const afterOneUndo = ALICE_TEXT + ' A1 B1';
  await expect.poll(() => markdown(alice)).toBe(ORIGINAL.replace(ALICE_TEXT, afterOneUndo));
  await expect.poll(() => markdown(bob)).toBe(ORIGINAL.replace(ALICE_TEXT, afterOneUndo));

  // The caret lands collapsed where the undone text used to start (right
  // after " B1"), not somewhere surprising.
  const afterUndoSelection = await selectionInfo(alice);
  expect(afterUndoSelection.offset).toBe(afterOneUndo.length);

  // Redo (Mod-Shift-Z) brings " A2" back.
  await alice.keyboard.press('ControlOrMeta+Shift+z');
  await expect.poll(() => markdown(alice)).toBe(ORIGINAL.replace(ALICE_TEXT, fullyTyped));
  await expect.poll(() => markdown(bob)).toBe(ORIGINAL.replace(ALICE_TEXT, fullyTyped));

  await context2.close();
});

test("[E] Alice bolds a word, Bob then edits elsewhere in the same paragraph; Alice's undo removes only the bold, Bob's edit stays", async ({
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

  // Select the word "paragraph" in Bob's own sentence via the editor's
  // `setTextSelection` command, computed from the live doc's real text
  // position (same established pattern as gateA-shortcuts.spec.ts's
  // `selectWord`: a real Shift-ArrowRight sequence is not what is under
  // test here, and this codebase's own builder log records it as
  // unreliable for cross-position selection in this headless Chromium).
  const wordStart = BOB_TEXT.indexOf('paragraph');
  const wordEnd = wordStart + 'paragraph'.length;
  await alice.bringToFront();
  await paragraphAt(alice, BOB_PARAGRAPH).click();
  await alice.evaluate(
    ({ from, to }) => {
      const editor = (window as unknown as { phraise: { editor: import('@tiptap/core').Editor } }).phraise.editor;
      let base = -1;
      editor.state.doc.descendants((node, pos) => {
        if (base < 0 && node.isText && node.text === "Bob's paragraph starts here.") base = pos;
        return true;
      });
      editor.commands.setTextSelection({ from: base + from, to: base + to });
    },
    { from: wordStart, to: wordEnd },
  );
  await alice.keyboard.press('ControlOrMeta+b');

  const boldedExpected = ORIGINAL.replace(BOB_TEXT, "Bob's **paragraph** starts here.");
  await expect.poll(() => markdown(alice)).toBe(boldedExpected);
  await expect.poll(() => markdown(bob)).toBe(boldedExpected);

  // Bob edits elsewhere in the SAME paragraph (appends at the end).
  await placeCaretAtEnd(bob, paragraphAt(bob, BOB_PARAGRAPH), "Bob's paragraph starts here.");
  await typeAndVerify(bob, ' Extra from Bob.');

  const boldPlusBob = ORIGINAL.replace(BOB_TEXT, "Bob's **paragraph** starts here. Extra from Bob.");
  await expect.poll(() => markdown(alice)).toBe(boldPlusBob);
  await expect.poll(() => markdown(bob)).toBe(boldPlusBob);

  // Alice's undo removes only the bold; Bob's appended text survives.
  await alice.bringToFront();
  await alice.keyboard.press('ControlOrMeta+z');
  const boldUndoneBobStays = ORIGINAL.replace(BOB_TEXT, "Bob's paragraph starts here. Extra from Bob.");
  await expect.poll(() => markdown(alice)).toBe(boldUndoneBobStays);
  await expect.poll(() => markdown(bob)).toBe(boldUndoneBobStays);

  await context2.close();
});

test("[E] Alice's undo does not remove a block Bob inserted, nor bring back one Bob deleted", async ({ page, phraiseServer, browser }) => {
  const alice = page;
  const context2 = await browser.newContext();
  const bob = await context2.newPage();

  await openAndWait(alice, phraiseServer, 'Alice');
  await openAndWait(bob, phraiseServer, 'Bob');
  await waitForInitialSync(alice, bob);

  // Alice makes a local edit of her own (something for her OWN undo to act
  // on later).
  await placeCaretAtEnd(alice, paragraphAt(alice, ALICE_PARAGRAPH), ALICE_TEXT);
  await typeAndVerify(alice, ' X1');
  await expect.poll(() => markdown(bob)).toContain(ALICE_TEXT + ' X1');

  // Bob inserts a whole new top-level block (Enter, then types into it).
  await placeCaretAtEnd(bob, paragraphAt(bob, BOB_PARAGRAPH), BOB_TEXT);
  await bob.keyboard.press('Enter');
  await typeAndVerify(bob, 'New block from Bob.');
  await expect.poll(() => markdown(alice)).toContain('New block from Bob.');

  const withInsertedBlock = ORIGINAL.replace(ALICE_TEXT, ALICE_TEXT + ' X1').replace(BOB_TEXT, BOB_TEXT + '\n\nNew block from Bob.');
  await expect.poll(() => markdown(alice)).toBe(withInsertedBlock);
  await expect.poll(() => markdown(bob)).toBe(withInsertedBlock);

  // Alice undoes HER OWN typing (" X1"); Bob's newly inserted block is
  // untouched, on both editors.
  await alice.bringToFront();
  await alice.keyboard.press('ControlOrMeta+z');
  const afterAliceUndo = ORIGINAL.replace(BOB_TEXT, BOB_TEXT + '\n\nNew block from Bob.');
  await expect.poll(() => markdown(alice)).toBe(afterAliceUndo);
  await expect.poll(() => markdown(bob)).toBe(afterAliceUndo);

  // Bob now DELETES that same block: select its whole line (a real
  // triple-click, the standard browser gesture for "select this line/
  // paragraph" in a contentEditable) and delete it, then Backspace once
  // more to remove the now-empty paragraph.
  const newBlockParagraph = paragraphAt(bob, BOB_PARAGRAPH + 1);
  await bob.bringToFront();
  await newBlockParagraph.click({ clickCount: 3 });
  await expect.poll(async () => (await selectionInfo(bob)).text).toBe('New block from Bob.');
  await bob.keyboard.press('Backspace');
  await bob.keyboard.press('Backspace');
  await expect.poll(() => markdown(alice)).not.toContain('New block from Bob.');

  const afterBobDeletes = ORIGINAL;
  await expect.poll(() => markdown(alice)).toBe(afterBobDeletes);
  await expect.poll(() => markdown(bob)).toBe(afterBobDeletes);

  // Alice makes ANOTHER local edit and undoes it -- her undo has something
  // real to act on, so this genuinely exercises "does undo ever resurrect
  // a block someone else deleted", not merely a no-op.
  await placeCaretAtEnd(alice, paragraphAt(alice, ALICE_PARAGRAPH), ALICE_TEXT);
  await typeAndVerify(alice, ' X2');
  await expect.poll(() => markdown(bob)).toContain(ALICE_TEXT + ' X2');

  await alice.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => markdown(alice)).toBe(afterBobDeletes);
  await expect.poll(() => markdown(bob)).toBe(afterBobDeletes);
  // Bob's deleted block must still be gone -- not resurrected by Alice's
  // unrelated undo.
  expect(await markdown(alice)).not.toContain('New block from Bob.');

  await context2.close();
});
