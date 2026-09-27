// Brief 07 fix list: "Where other gate A and B tests set selections
// programmatically, switch those that a user would make with the keyboard
// or mouse." Real double-click (word) and click-then-shift-click (phrase,
// or a range spanning more than one paragraph) selection, computed from
// the live DOM via the Range API -- not `editor.commands.setTextSelection`.
// Used by `gateA-shortcuts.spec.ts` (`selectWord`, replacing its own
// programmatic helper), `gateB-copy.spec.ts` (both `selectSubstring`
// call sites), and `gateA-typing.spec.ts`'s "select across two paragraphs"
// test.
import { expect, type Page, type Locator } from '@playwright/test';

/** A viewport-relative {x, y} point at the start or end edge of the first
 * occurrence of `substring` inside `locator`'s element, found by walking
 * its text nodes and using a real DOM `Range` for the pixel position --
 * real coordinates a mouse click can hit, not a scripted PM position. */
async function substringEdge(locator: Locator, substring: string, edge: 'start' | 'end'): Promise<{ x: number; y: number }> {
  const point = await locator.evaluate(
    (el, args) => {
      const { sub, which } = args as { sub: string; which: 'start' | 'end' };
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let node: Text | null;
      while ((node = walker.nextNode() as Text | null)) {
        const text = node.textContent ?? '';
        const idx = text.indexOf(sub);
        if (idx !== -1) {
          const at = which === 'start' ? idx : idx + sub.length;
          const range = document.createRange();
          range.setStart(node, at);
          range.setEnd(node, at);
          const rect = range.getBoundingClientRect();
          return { x: rect.left, y: rect.top + rect.height / 2 };
        }
      }
      return null;
    },
    { sub: substring, which: edge },
  );
  if (!point) throw new Error(`substringEdge: "${substring}" not found in element`);
  return point;
}

/** The viewport-relative center point of the first occurrence of
 * `substring` inside `locator`'s element -- for a double-click, which
 * lands anywhere inside the target word. */
async function substringCenter(locator: Locator, substring: string): Promise<{ x: number; y: number }> {
  const point = await locator.evaluate((el, sub) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
      const text = node.textContent ?? '';
      const idx = text.indexOf(sub);
      if (idx !== -1) {
        const range = document.createRange();
        range.setStart(node, idx);
        range.setEnd(node, idx + sub.length);
        const rect = range.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      }
    }
    return null;
  }, substring);
  if (!point) throw new Error(`substringCenter: "${substring}" not found in element`);
  return point;
}

async function currentSelectedText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const editor = (window as any).phraise.editor;
    const { from, to } = editor.state.selection;
    return editor.state.doc.textBetween(from, to, '\n\n');
  });
}

/** Run `gesture()` (a real mouse selection action), then verify the app's
 * OWN selection settled to `expectedText`; retries the whole gesture up to
 * `attempts` times, logging every retry, if it hasn't. Real, rare flake
 * under full-suite default worker parallelism (confirmed: reliable in
 * isolation and under `--repeat-each=5` at `--workers=1`, but one real
 * `npm run gates` run saw it once) -- the same class of CDP input-delivery
 * miss this suite already documents for `page.keyboard.type()`
 * (`gateE-undo.spec.ts`'s `typeAndVerify`), here for a mouse click/
 * shift-click instead. Mirrors `typeAndVerify`'s own shape: a short poll
 * per attempt, not a sleep, so the common (immediately-correct) case pays
 * nothing extra. */
async function retryGesture(page: Page, label: string, gesture: () => Promise<void>, expectedText: string, attempts = 3): Promise<void> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    await gesture();
    try {
      await expect.poll(() => currentSelectedText(page), { timeout: 2000 }).toBe(expectedText);
      return;
    } catch (err) {
      const got = await currentSelectedText(page);
      console.log(`[${label}-retry] attempt ${attempt}: expected ${JSON.stringify(expectedText)}, got ${JSON.stringify(got)}`);
      if (attempt === attempts) throw err;
    }
  }
}

/** Real double-click on a single word -- the natural mouse gesture for
 * selecting one word, relying on the browser's own native word-selection
 * behaviour inside a contentEditable. */
export async function dblClickWord(page: Page, locator: Locator, word: string): Promise<void> {
  await retryGesture(
    page,
    'dblClickWord',
    async () => {
      const { x, y } = await substringCenter(locator, word);
      await page.mouse.dblclick(x, y);
    },
    word,
  );
}

/** Real "click to place the caret, then shift+click to extend the
 * selection" -- the standard way a user selects an arbitrary phrase (one
 * word, several words, or a range spanning more than one paragraph) with
 * the mouse. `from`/`to` each name the locator+substring whose edge
 * anchors that end of the selection (default: the substring's own start
 * for `from`, end for `to` -- i.e. selecting exactly that substring when
 * `from`/`to` share the same locator). `expectedText` is what the app's
 * own selection (`doc.textBetween(from, to, '\n\n')`) should read once the
 * gesture has landed -- required so a flake (see `retryGesture`) can be
 * detected and retried, not just hoped away. */
export async function clickThenShiftClick(
  page: Page,
  from: { locator: Locator; substring: string; edge?: 'start' | 'end' },
  to: { locator: Locator; substring: string; edge?: 'start' | 'end' },
  expectedText: string,
): Promise<void> {
  await retryGesture(
    page,
    'clickThenShiftClick',
    async () => {
      const start = await substringEdge(from.locator, from.substring, from.edge ?? 'start');
      await page.mouse.click(start.x, start.y);
      const end = await substringEdge(to.locator, to.substring, to.edge ?? 'end');
      await page.keyboard.down('Shift');
      await page.mouse.click(end.x, end.y);
      await page.keyboard.up('Shift');
    },
    expectedText,
  );
}
