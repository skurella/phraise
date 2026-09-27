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

test.use({ seedFiles: [{ relpath: DOC, srcPath: FIXTURE }] });

async function openAndWait(page: Page, phraiseServer: { pageUrl(doc: string, user: string): string }, user: string): Promise<void> {
  await page.goto(phraiseServer.pageUrl(DOC, user));
  await page.waitForFunction(() => (window as unknown as { phraise?: unknown }).phraise != null);
}

async function markdown(page: Page): Promise<string> {
  return page.evaluate(() => (window as unknown as { phraise: { markdown(): string } }).phraise.markdown());
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
    return { text: $from.parent.textContent, offset: $from.parentOffset };
  });
}

async function placeCaretAtEnd(page: Page, locator: Locator, expectedText: string): Promise<void> {
  await locator.click();
  await expect.poll(async () => (await selectionInfo(page)).text).toBe(expectedText);
  await page.keyboard.press('End');
  await expect.poll(async () => (await selectionInfo(page)).offset).toBe(expectedText.length);
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
  await alice.keyboard.type(' EDIT-A');

  // Bob, still online, types elsewhere and must NOT see Alice's offline
  // edit (the relay never received it).
  await placeCaretAtEnd(bob, paragraphAt(bob, BOB_PARAGRAPH), BOB_TEXT);
  await bob.keyboard.type(' EDIT-B');
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
  await alice.keyboard.type(' EDIT-C');
  const aliceOfflineFinal = ORIGINAL.replace(ALICE_TEXT, ALICE_TEXT + ' EDIT-A EDIT-C');
  await expect.poll(() => markdown(alice)).toBe(aliceOfflineFinal);

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
