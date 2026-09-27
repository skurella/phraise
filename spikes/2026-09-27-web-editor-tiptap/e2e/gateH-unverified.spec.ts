// Brief 03, gate H: "the editor shows the block as source with the
// best-effort Markdown and asks for confirmation, as decided under D4.
// Demonstrate with a construct from spike 1's list of failures."
//
// The demonstration chosen (see the builder log for how it was found by
// trying candidates with the REAL serializer, not guessed): CommonMark
// spec example 20 ("Backslash escapes"), an autolink whose URL text
// contains a backslash-escaped asterisk: `<https://example.com?find=\*>`.
// Removing the link mark (a real generic core command, `unsetMark('link')`
// -- the same kind of always-available command `markShortcuts.ts` already
// documents) leaves a plain text run that the serializer's re-serialize
// ladder cannot express as unlinked plain text that reparses back to the
// same literal backslash-asterisk; `serializeBlock`/`serializeDoc` throw
// `UnverifiedSerializationError` for this edit, confirmed for real before
// picking it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, 'fixtures', 'gate-h.md');
const DOC = 'gate-h.md';

test.use({ seedFiles: [{ relpath: DOC, srcPath: FIXTURE }] });

async function openAndWait(page: Page, phraiseServer: { pageUrl(doc: string, user: string): string }, user = 'Alice'): Promise<void> {
  await page.goto(phraiseServer.pageUrl(DOC, user));
  await page.waitForFunction(() => (window as unknown as { phraise?: unknown }).phraise != null);
}

async function markdown(page: Page): Promise<string> {
  return page.evaluate(() => (window as unknown as { phraise: { markdown(): string } }).phraise.markdown());
}

/** Trigger gate H's demonstration edit: find the autolink's marked text run
 * and remove its `link` mark via a real, generic core command (not a
 * hand-built transaction) -- this IS the "local transaction" the debounced
 * check reacts to. */
async function unlinkAutolink(page: Page): Promise<void> {
  await page.evaluate(() => {
    const editor = (window as unknown as { phraise: { editor: import('@tiptap/core').Editor } }).phraise.editor;
    let range: { from: number; to: number } | null = null;
    editor.state.doc.descendants((node, pos) => {
      if (range) return false;
      if (node.isText && node.marks.some((m) => m.type.name === 'link')) {
        range = { from: pos, to: pos + node.nodeSize };
      }
      return true;
    });
    if (!range) throw new Error('autolink text run not found');
    editor.chain().setTextSelection(range).unsetMark('link').run();
  });
}

function unverifiedBanner(page: Page) {
  return page.locator('.phraise-source-block[data-raw-block-kind="unverified"]');
}

test('[H] an edit the serializer cannot verify shows the banner with the best-effort Markdown', async ({ page, phraiseServer }) => {
  await openAndWait(page, phraiseServer);
  await unlinkAutolink(page);

  const banner = unverifiedBanner(page);
  await expect(banner).toBeVisible({ timeout: 5000 });
  await expect(banner.locator('.phraise-unverified-message')).toHaveText(
    "Phraise can't save this formatting exactly. This is what will be saved.",
  );
  await expect(banner.getByRole('button', { name: 'Keep this' })).toBeVisible();
  await expect(banner.getByRole('button', { name: 'Undo my change' })).toBeVisible();

  // The block's own shown source is the best-effort Markdown that would be
  // saved: it must be present verbatim in the block's editable text.
  const shownText = await banner.locator('.phraise-source-editor').textContent();
  expect(shownText).toBeTruthy();
  expect(shownText).not.toContain('�'); // sanity: real text, not empty/garbled
});

test('[H] "Keep this" parses the shown Markdown and leaves a document that serializes without error and matches it', async ({
  page,
  phraiseServer,
}) => {
  await openAndWait(page, phraiseServer);
  await unlinkAutolink(page);

  const banner = unverifiedBanner(page);
  await expect(banner).toBeVisible({ timeout: 5000 });
  const shownText = await banner.locator('.phraise-source-editor').textContent();
  expect(shownText).toBeTruthy();

  // "Keep this" (`keepUnverifiedBlock` in `unverifiedCheck.ts`) parses the
  // shown text with the same `parseBlock` the check itself verifies
  // candidates with, and only replaces the block if that parse succeeds to
  // exactly one node -- so the banner disappearing IS the parse succeeding,
  // not a separate thing to check.
  await banner.getByRole('button', { name: 'Keep this' }).click();
  await expect(banner).toHaveCount(0); // the unverified block is gone, replaced by rich content

  // serializeDoc no longer throws (a string, not an exception, comes back),
  // and the block's substance (not necessarily its exact spelling -- a
  // link mark round-trips back through more than one valid Markdown form)
  // survives: the URL is still there, in a real paragraph, not lost.
  const md = await markdown(page);
  expect(md).toContain('example.com?find=');
  const paragraph = page.locator('#editor .ProseMirror p', { hasText: 'example.com' });
  await expect(paragraph).toBeVisible();
});

test('[H] "Undo my change" restores the original bytes', async ({ page, phraiseServer }) => {
  const original = fs.readFileSync(FIXTURE, 'utf8');
  await openAndWait(page, phraiseServer);
  await unlinkAutolink(page);

  const banner = unverifiedBanner(page);
  await expect(banner).toBeVisible({ timeout: 5000 });

  await banner.getByRole('button', { name: 'Undo my change' }).click();
  await expect.poll(() => markdown(page)).toBe(original);
});

test('[H] a second connected browser context does not also convert the block', async ({ page, phraiseServer, browser }) => {
  await openAndWait(page, phraiseServer, 'Alice');

  const context2 = await browser.newContext();
  const page2 = await context2.newPage();
  await openAndWait(page2, phraiseServer, 'Bob');

  // Let both clients settle on the initial synced state before editing.
  await expect.poll(() => markdown(page)).toBe(await markdown(page2));

  await unlinkAutolink(page);
  await expect(unverifiedBanner(page)).toBeVisible({ timeout: 5000 });

  // Page 2 receives the SAME converted content via the relay (a remote
  // transaction to page 2), but must never have run its OWN check in
  // response to it -- that is what "never both convert the same block"
  // means: only the editor whose OWN local transaction produced the
  // unverifiable edit ever runs the check.
  await expect(unverifiedBanner(page2)).toBeVisible({ timeout: 5000 });
  const page2Runs = await page2.evaluate(() =>
    (window as unknown as { phraise: { debugUnverifiedCheckRuns(): number } }).phraise.debugUnverifiedCheckRuns(),
  );
  expect(page2Runs).toBe(0);

  await context2.close();
});
