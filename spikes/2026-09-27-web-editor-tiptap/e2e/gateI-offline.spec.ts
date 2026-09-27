// Brief 04, gate I: offline. `e2e/fixtures/collab.md`, two browser contexts.
//
// How offline is simulated (confirmed with a throwaway probe spec before
// writing these tests, deleted before committing -- see the builder log):
// Playwright's `browserContext.setOffline(true)` DOES cut a real, already-
// connected Hocuspocus WebSocket in this headless Chromium -- the status
// indicator flips to "Offline, changes kept on this device" within well
// under a second, and a second browser context genuinely never receives an
// edit typed while the first is offline. The brief's documented fallback
// (stop the relay process, or route around it) was not needed.
//
// `window.phraise.offlineReady` (a promise) is awaited before ever going
// offline, so the service worker is guaranteed active and the app shell
// already primed into the cache -- not a guess at timing.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page, Locator } from '@playwright/test';
import { test, expect } from './fixtures.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, 'fixtures', 'collab.md');
const DOC = 'collab.md';
const ORIGINAL = fs.readFileSync(FIXTURE, 'utf8');

const ALICE_PARAGRAPH = 0;
const BOB_PARAGRAPH = 1;
const ALICE_TEXT = "Alice's paragraph starts here.";
const BOB_TEXT = "Bob's paragraph starts here.";

// The close-at-once measurement test (below) needs a FRESH, independent
// document per repetition -- all ten repetitions run against the same
// `phraiseServer` (one relay per test function, not per repetition), so
// reusing `DOC` across repetitions would have each repetition read back
// (and build on) the previous repetition's edit instead of measuring each
// attempt in isolation. Same source content, ten distinct relpaths, copied
// directly into `phraiseServer.seedsDir` at runtime (the server's own
// `onLoadDocument` reads a document's seed file lazily, on first use, not
// only at startup) rather than declared via `test.use({ seedFiles: [...
// multiple items ...] })`: gateC-sourceblocks.spec.ts's own comment records
// that a multi-element `seedFiles` array value there made Playwright's
// fixture-option merging turn it into a non-iterable object (confirmed
// again here the same way -- a throwaway repro, not guessed); its
// documented workaround (nested `test.describe`s, one `test.use` each) does
// not scale to ten repetitions, so this file sidesteps the fixture option
// entirely for them.
const CLOSE_AT_ONCE_REPS = 10;
const CLOSE_AT_ONCE_DOC = (i: number): string => `close-at-once-${i}.md`;

test.use({ seedFiles: [{ relpath: DOC, srcPath: FIXTURE }] });

async function openAndWait(page: Page, phraiseServer: { pageUrl(doc: string, user: string): string }, user: string, doc: string = DOC): Promise<void> {
  await page.goto(phraiseServer.pageUrl(doc, user));
  await page.waitForFunction(() => (window as unknown as { phraise?: unknown }).phraise != null);
}

async function markdown(page: Page): Promise<string> {
  // See gate E's `markdown()` for the U+00A0-vs-U+0020 finding (a genuine
  // Chromium contentEditable insertion quirk under CPU contention,
  // confirmed to reach this app's own serialized Markdown).
  const md = await page.evaluate(() => (window as unknown as { phraise: { markdown(): string } }).phraise.markdown());
  return md.replace(/\u00a0/g, ' ');
}

async function statusLabel(page: Page): Promise<string> {
  return page.evaluate(() => (window as unknown as { phraise: { statusLabel(): string } }).phraise.statusLabel());
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
    const text = ($from.parent.textContent as string).replace(/ /g, ' ');
    return { text, offset: $from.parentOffset };
  });
}

async function placeCaretAtEnd(page: Page, locator: Locator, expectedText: string): Promise<void> {
  // Brief 05: only the front page has focus for keyboard input in headless
  // Chromium on this machine (see the builder log's gate E finding).
  await page.bringToFront();
  await locator.click();
  await expect.poll(async () => (await selectionInfo(page)).text).toBe(expectedText);
  await page.keyboard.press('End');
  await expect.poll(async () => (await selectionInfo(page)).offset).toBe(expectedText.length);
}

/** Types `text` at the caret and verifies (polling the real local
 * selection) that it actually landed, retrying if not -- see gate E's
 * `typeAndVerify` for why this occasionally matters on this machine. Used
 * here so the close-at-once measurement below measures IndexedDB write
 * timing, not input-delivery flakiness. */
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
      if (attempt === 3) throw err;
      // See gate E's `typeAndVerify` for why: under full-suite load the
      // poll can time out even though the type landed, just slower than
      // 2s -- not a dropped keystroke.
      const current = (await selectionInfo(page)).text;
      // See gate E's `typeAndVerify` for the U+00A0-vs-U+0020 finding
      // (a genuine contentEditable insertion quirk under CPU contention,
      // confirmed directly with a char-code dump of a captured failure).
      const normalize = (s: string): string => s.replace(/\u00a0/g, ' ');
      if (normalize(current) === normalize(wanted)) return;
      if (current !== before) throw new Error(`typeAndVerify: unexpected partial state before retry: ${JSON.stringify(current)}`);
    }
  }
}

/** Waits for the service worker to be active and the app shell primed into
 * the cache -- deterministic, not a guess at timing (see this file's
 * header comment). */
async function waitOfflineReady(page: Page): Promise<void> {
  await page.evaluate(() => (window as unknown as { phraise: { offlineReady: Promise<void> } }).phraise.offlineReady);
}

test('[I] Alice edits offline, reloads while still offline, then reconnects and converges with Bob with no edit lost', async ({
  page,
  phraiseServer,
  browser,
}) => {
  const aliceContext = page.context();
  let alice = page;
  const bobContext = await browser.newContext();
  const bob = await bobContext.newPage();

  await openAndWait(alice, phraiseServer, 'Alice');
  await openAndWait(bob, phraiseServer, 'Bob');
  await expect.poll(() => markdown(alice)).toBe(ORIGINAL);
  await expect.poll(() => markdown(bob)).toBe(ORIGINAL);
  await waitOfflineReady(alice);

  // Alice goes offline.
  await aliceContext.setOffline(true);
  await expect.poll(() => statusLabel(alice)).toBe('Offline, changes kept on this device');

  // Alice types while offline.
  await placeCaretAtEnd(alice, paragraphAt(alice, ALICE_PARAGRAPH), ALICE_TEXT);
  await typeAndVerify(alice, ' EDIT-A');

  // Bob, still online, types elsewhere and must NOT see Alice's offline
  // edit (the relay never received it).
  await placeCaretAtEnd(bob, paragraphAt(bob, BOB_PARAGRAPH), BOB_TEXT);
  await typeAndVerify(bob, ' EDIT-B');
  await alice.waitForTimeout(500); // give any (undesired) propagation a real chance to happen
  expect(await markdown(bob)).not.toContain('EDIT-A');
  expect(await markdown(alice)).not.toContain('EDIT-B');

  // Force a full write of the pending Yjs updates to IndexedDB before
  // reloading, so the reload deterministically picks up "EDIT-A" rather
  // than guessing at y-indexeddb's own write timing (see main.ts's
  // `flushIndexeddb`, backed by y-indexeddb's own exported `storeState`).
  await alice.evaluate(() => (window as unknown as { phraise: { flushIndexeddb(): Promise<void> } }).phraise.flushIndexeddb());

  // Alice reloads the page while STILL offline: the app shell comes from
  // the service worker's cache, and the document's content comes from
  // IndexedDB (the provider can't sync -- there is no network).
  await alice.reload();
  await alice.waitForFunction(() => (window as unknown as { phraise?: unknown }).phraise != null);
  await expect.poll(() => statusLabel(alice)).toBe('Offline, changes kept on this device');
  await expect.poll(() => markdown(alice)).toBe(ORIGINAL.replace(ALICE_TEXT, ALICE_TEXT + ' EDIT-A'));
  const builtFrom = await alice.evaluate(() => (window as unknown as { phraise: { builtFrom: string } }).phraise.builtFrom);
  expect(builtFrom).toBe('indexeddb'); // there is no network; only IndexedDB could have supplied this content

  // Alice types more, still offline.
  await placeCaretAtEnd(alice, paragraphAt(alice, ALICE_PARAGRAPH), ALICE_TEXT + ' EDIT-A');
  await typeAndVerify(alice, ' EDIT-C');
  const aliceOfflineFinal = ORIGINAL.replace(ALICE_TEXT, ALICE_TEXT + ' EDIT-A EDIT-C');
  await expect.poll(() => markdown(alice)).toBe(aliceOfflineFinal);

  // Brief 05, task 4: wait for the status to say the just-typed change is
  // durably kept on this device ("Saving on this device" -> "Offline,
  // changes kept on this device") before closing the page -- what a real
  // user sees and would wait for, and what previously made this exact step
  // flaky (6/24 in the orchestrator's own measurement): closing immediately
  // after typing, with no such wait, races the IndexedDB write the pending-
  // write tracker now reports on. See `[I] measuring...` below for how
  // much is actually lost when a user does NOT wait, which this test does
  // not do since a waiting user is the scenario gate I covers.
  await expect.poll(() => statusLabel(alice)).toBe('Offline, changes kept on this device');

  // Alice's offline edits survive closing the page entirely and opening a
  // NEW one, still offline, in the SAME browser context (same profile /
  // IndexedDB, a real close+reopen, not just a reload).
  await alice.close();
  const alice2 = await aliceContext.newPage();
  await openAndWait(alice2, phraiseServer, 'Alice');
  await expect.poll(() => statusLabel(alice2)).toBe('Offline, changes kept on this device');
  await expect.poll(() => markdown(alice2)).toBe(aliceOfflineFinal);
  alice = alice2;

  // Alice goes back online: both converge to the same Markdown containing
  // all three edits.
  await aliceContext.setOffline(false);
  const finalExpected = ORIGINAL.replace(ALICE_TEXT, ALICE_TEXT + ' EDIT-A EDIT-C').replace(BOB_TEXT, BOB_TEXT + ' EDIT-B');
  await expect.poll(() => statusLabel(alice), { timeout: 10000 }).toBe('Saved');
  await expect.poll(() => markdown(alice), { timeout: 10000 }).toBe(finalExpected);
  await expect.poll(() => markdown(bob), { timeout: 10000 }).toBe(finalExpected);

  // The relay's own stored document (read by a fresh third context) agrees
  // -- no edit was lost.
  const carolContext = await browser.newContext();
  const carol = await carolContext.newPage();
  await openAndWait(carol, phraiseServer, 'Carol');
  await expect.poll(() => markdown(carol)).toBe(finalExpected);

  await carolContext.close();
  await bobContext.close();
  // `aliceContext` is the default `page` fixture's own context; Playwright
  // owns its teardown, so it is not closed here.
});

// Brief 05, task 4: "Add a test that measures the window: type then close
// at once, and report in the log how many characters survive over 10
// repetitions; this is a finding, not a gate." Unlike the test above (which
// waits for "Offline, changes kept on this device" before closing -- what a
// user who watches the status bar would do), this test closes the page the
// INSTANT the last keystroke's model update lands, with no such wait: the
// worst case for `y-indexeddb`'s per-update IndexedDB write and this
// brief's `pagehide` flush to actually finish before the page (and, in
// Playwright, the whole browser context tied to that page) disappears.
// Ten independent repetitions, each its own fresh context/page (so one
// repetition's timing can't be influenced by a previous one's teardown);
// each repetition's own survived-character count is asserted only to be a
// sane number (0..typed.length) so a genuinely-partial write -- the exact
// thing under measurement -- does not itself fail the test. The full
// per-repetition results are printed for the log.
test('[I] measuring: how many characters survive typing then closing the page immediately, offline (a finding, not a gate)', async ({
  phraiseServer,
  browser,
}) => {
  const REPS = CLOSE_AT_ONCE_REPS;
  const TYPED = ' EDIT-C';
  const results: number[] = [];

  for (let i = 0; i < REPS; i++) {
    const doc = CLOSE_AT_ONCE_DOC(i); // own document per repetition -- see this file's header comment
    fs.copyFileSync(FIXTURE, path.join(phraiseServer.seedsDir, doc));
    const context = await browser.newContext();
    const page = await context.newPage();
    await openAndWait(page, phraiseServer, 'Alice', doc);
    await expect.poll(() => markdown(page)).toBe(ORIGINAL);
    await waitOfflineReady(page);
    await context.setOffline(true);
    await expect.poll(() => statusLabel(page)).toBe('Offline, changes kept on this device');

    await placeCaretAtEnd(page, paragraphAt(page, ALICE_PARAGRAPH), ALICE_TEXT);
    await typeAndVerify(page, TYPED); // confirms the LOCAL model has it -- isolates the IndexedDB write's own timing, not input delivery
    await page.close(); // no wait for "changes kept" -- the exact scenario under measurement

    const page2 = await context.newPage();
    await openAndWait(page2, phraiseServer, 'Alice', doc);
    const reopened = await markdown(page2);
    const afterAliceText = reopened.slice(reopened.indexOf(ALICE_TEXT) + ALICE_TEXT.length);
    let survived = 0;
    while (survived < TYPED.length && afterAliceText[survived] === TYPED[survived]) survived++;
    results.push(survived);

    await context.close();
  }

  const full = results.filter((n) => n === TYPED.length).length;
  console.log(
    `[I] close-at-once measurement (offline, ${TYPED.length}-character edit, ${REPS} repetitions): ` +
      `${JSON.stringify(results)} characters survived per repetition; ${full}/${REPS} fully survived.`,
  );

  for (const n of results) {
    expect(n).toBeGreaterThanOrEqual(0);
    expect(n).toBeLessThanOrEqual(TYPED.length);
  }
  expect(results).toHaveLength(REPS);
});
