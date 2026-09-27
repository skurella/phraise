// Brief 07, gate K: scale. Measures the editor against
// `corpus/fetched/nodejs-node-docapinapimd.md` (245,936 bytes) and a small
// README for comparison, writes every number to `results/scale.json` (and
// prints it), and enforces only the two pass criteria the brief names:
// load under 5s first visit, p95 key-to-paint under 50ms with the panel
// closed. Every other number is reported, not gated -- "report the numbers
// whatever the outcome; do not tune the test to pass."
//
// Measurement method notes (also in the builder log):
// - "Load" time is wall-clock (Node's `Date.now()`) from just before
//   `page.goto`/`page.reload` to a `page.waitForFunction` confirming the
//   editor's DOM has exactly as many top-level children as the parsed
//   document has top-level blocks -- i.e. the document's LAST block is
//   painted, not just "some content is there". A few ms of Node<->browser
//   IPC overhead is included; immaterial against a 5s budget.
// - "Key press to paint" is measured TWO ways per the brief's own
//   instruction, and BOTH are reported, but the requestAnimationFrame (RAF)
//   measurement is what this file uses for the pass/fail criterion and for
//   p50/p95/max: the Event Timing API's `event` entries are only reported
//   above `durationThreshold` (16ms here, per the brief), so on a healthy
//   page most of the 200 keystrokes are simply never surfaced by
//   PerformanceObserver at all -- there is no percentile to compute from a
//   sample that silently drops its own fast end. RAF (one scheduled from
//   every real `keydown`, measuring keydown-to-next-animation-frame)
//   captures all 200 unconditionally. The Event Timing entries are still
//   recorded and reported as a cross-check: every keystroke RAF measured
//   above 16ms should have a corresponding `event`/`first-input` entry.
// - `parseMarkdown`/`serializeDoc` timings are measured in Node (this
//   file), not inside the browser: both are plain, DOM-free TypeScript run
//   by the same V8 engine either way, and importing the exact module Vite
//   bundles into the page avoids adding a debug hook whose own overhead
//   could skew a microbenchmark. The gate H per-block check and the
//   comment re-anchoring pass genuinely need live editor/Yjs state, so
//   those two ARE measured in-page, via `window.phraise` debug hooks
//   (`debugUnverifiedCheckLastMs`, `debugCommentHighlightLastMs`).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures.js';
import { parseMarkdown } from '../src/model/parse.js';
import { serializeDoc } from '../src/model/serialize.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LARGE_FIXTURE = path.join(HERE, '..', 'corpus', 'fetched', 'nodejs-node-docapinapimd.md');
const SMALL_FIXTURE = path.join(HERE, '..', 'corpus', 'fetched', 'npm-express-readme.md');
const LARGE_SOURCE = fs.readFileSync(LARGE_FIXTURE, 'utf8');
const SMALL_SOURCE = fs.readFileSync(SMALL_FIXTURE, 'utf8');

const RESULTS_DIR = path.join(HERE, '..', 'results');
const RESULTS_FILE = path.join(RESULTS_DIR, 'scale.json');

// Populated by each test below (this file's tests run serially within one
// worker -- see playwright.config.ts's own comment on why this suite isn't
// fullyParallel), written to disk once in `test.afterAll` so a failure in
// one measurement doesn't lose the ones already taken.
const results: Record<string, unknown> = {
  fixture: { path: 'corpus/fetched/nodejs-node-docapinapimd.md', bytes: LARGE_SOURCE.length },
  comparisonFixture: { path: 'corpus/fetched/npm-express-readme.md', bytes: SMALL_SOURCE.length },
};

test.afterAll(() => {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2) + '\n');
  console.log('\n[K] wrote results/scale.json:\n' + JSON.stringify(results, null, 2));
});

function topLevelBlockCount(source: string): number {
  return parseMarkdown(source).doc.childCount;
}

const LARGE_BLOCK_COUNT = topLevelBlockCount(LARGE_SOURCE);
const SMALL_BLOCK_COUNT = topLevelBlockCount(SMALL_SOURCE);

/** Copies a fixture directly into the running server's own seeds
 * directory under `relpath`, rather than declaring it via
 * `test.use({ seedFiles: [...] })` -- this file needs several
 * differently-named copies of the SAME one or two source files (a fresh
 * Yjs document per measurement, so they don't interfere with each other),
 * and a `seedFiles` array with more than one element has a real Playwright
 * fixture-option-merging bug in this project (`TypeError: seedFiles is not
 * iterable`), hit three times before across this spike (see the README's
 * "Notes for the next brief") -- copying into `phraiseServer.seedsDir`
 * directly, as those notes suggest, sidesteps it entirely. */
function seedDoc(phraiseServer: { seedsDir: string }, relpath: string, source: string): void {
  fs.writeFileSync(path.join(phraiseServer.seedsDir, relpath), source);
}

async function waitForFullyPainted(page: Page, expectedChildCount: number): Promise<void> {
  await page.waitForFunction(
    (n) => (document.querySelector('#editor .ProseMirror')?.childElementCount ?? 0) >= n,
    expectedChildCount,
    { timeout: 30_000 },
  );
}

async function waitForPhraise(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as unknown as { phraise?: unknown }).phraise != null);
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx]!;
}

function summarize(values: number[]): { p50: number; p95: number; max: number; n: number } {
  const sorted = [...values].sort((a, b) => a - b);
  return { p50: percentile(sorted, 50), p95: percentile(sorted, 95), max: sorted[sorted.length - 1] ?? 0, n: sorted.length };
}

// ---------------------------------------------------------------------------
// Load: first visit (relay-seeded) and repeat visit (IndexedDB), plus the
// relay's own Yjs state size.
// ---------------------------------------------------------------------------

test('[K] load: first visit (relay-seeded) and repeat visit (IndexedDB), and the relay state size', async ({ page, phraiseServer }) => {
  const doc = 'scale-load.md';
  const url = phraiseServer.pageUrl(doc, 'Alice');

  seedDoc(phraiseServer, doc, LARGE_SOURCE);

  const t0 = Date.now();
  await page.goto(url);
  await waitForFullyPainted(page, LARGE_BLOCK_COUNT);
  const firstVisitMs = Date.now() - t0;
  await waitForPhraise(page);

  const builtFrom = await page.evaluate(() => (window as any).phraise.builtFrom);
  const encodedStateSize = await page.evaluate(() => (window as any).phraise.encodedStateSize());

  // Force a full IndexedDB snapshot before reloading (the same
  // determinism trick gate I's own tests use -- see `window.phraise
  // .flushIndexeddb()`'s own comment in `web/src/main.ts`) so the repeat
  // visit below is genuinely measuring an already-persisted local copy,
  // not racing the write.
  await page.evaluate(() => (window as any).phraise.flushIndexeddb());

  const t1 = Date.now();
  await page.reload();
  await waitForFullyPainted(page, LARGE_BLOCK_COUNT);
  const repeatVisitMs = Date.now() - t1;
  await waitForPhraise(page);
  const repeatBuiltFrom = await page.evaluate(() => (window as any).phraise.builtFrom);

  results.load = {
    firstVisitMs,
    firstVisitBuiltFrom: builtFrom,
    repeatVisitMs,
    repeatVisitBuiltFrom: repeatBuiltFrom,
    relayStateBytes: encodedStateSize,
    blockCount: LARGE_BLOCK_COUNT,
  };
  console.log(`[K] load: first visit ${firstVisitMs}ms (from ${builtFrom}), repeat visit ${repeatVisitMs}ms (from ${repeatBuiltFrom}), relay state ${encodedStateSize} bytes`);

  // The gate's own pass criterion: load under 5s, first visit.
  expect(firstVisitMs, `first-visit load time (${firstVisitMs}ms) should be under 5000ms`).toBeLessThan(5000);
});

// ---------------------------------------------------------------------------
// Key press to paint.
// ---------------------------------------------------------------------------

interface KeyToPaintSample {
  raf: number[];
  events: { name: string; duration: number }[];
  firstInput: number | null;
}

/** Installs the instrumentation (Event Timing + RAF cross-check) in the
 * page, BEFORE any typing starts. See this file's header comment for why
 * both are collected but RAF is what's reported for p50/p95/max. */
async function installKeyToPaintObserver(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __gateK: { raf: number[]; events: { name: string; duration: number }[] } };
    w.__gateK = { raf: [], events: [] };
    try {
      const po = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          w.__gateK.events.push({ name: e.name, duration: e.duration });
        }
      });
      // durationThreshold per the brief; first-input has no threshold of
      // its own and fires at most once per page.
      po.observe({ type: 'event', durationThreshold: 16, buffered: true } as PerformanceObserverInit);
      po.observe({ type: 'first-input', buffered: true } as PerformanceObserverInit);
    } catch (err) {
      console.log('[K] PerformanceObserver(event/first-input) unavailable:', (err as Error).message);
    }
    document.addEventListener(
      'keydown',
      () => {
        const t0 = performance.now();
        requestAnimationFrame(() => {
          w.__gateK.raf.push(performance.now() - t0);
        });
      },
      { capture: true },
    );
  });
}

async function readKeyToPaintSample(page: Page): Promise<KeyToPaintSample> {
  return page.evaluate(() => {
    const w = window as unknown as { __gateK: { raf: number[]; events: { name: string; duration: number }[] } };
    const firstInputEntry = w.__gateK.events.find((e) => e.name === 'first-input');
    return { raf: w.__gateK.raf, events: w.__gateK.events, firstInput: firstInputEntry ? firstInputEntry.duration : null };
  });
}

/** Alice's own typing: real `page.keyboard.press` per character (each one
 * is a real key event the instrumentation above observes), a real word-ish
 * phrase rather than one repeated letter, with a small (10ms) pacing delay
 * between presses -- a fast but plausible typing cadence, not an
 * artificial throttle and not the unrealistic zero-gap case either. */
async function typeCharacters(page: Page, count: number): Promise<void> {
  const phrase = 'the quick brown fox jumps over the lazy dog and then runs back again ';
  await page.bringToFront();
  for (let i = 0; i < count; i++) {
    await page.keyboard.press(phrase[i % phrase.length] === ' ' ? 'Space' : phrase[i % phrase.length]!);
    await page.waitForTimeout(10);
  }
}

/** Finds a top-level paragraph node (real prose, not a heading/list/table/
 * source block) near the given fractional position (0..1) through the
 * document, and returns its top-level index plus a position inside its
 * text good for placing a caret. */
async function findParagraphNear(page: Page, fraction: number): Promise<{ index: number; from: number }> {
  return page.evaluate((frac) => {
    const editor = (window as any).phraise.editor;
    const paragraphs: { index: number; from: number }[] = [];
    let index = 0;
    editor.state.doc.forEach((node: any, offset: number) => {
      if (node.type.name === 'paragraph' && node.textContent.trim().length > 20) {
        paragraphs.push({ index, from: offset + 1 });
      }
      index++;
    });
    const target = Math.min(paragraphs.length - 1, Math.max(0, Math.floor(frac * paragraphs.length)));
    return paragraphs[target]!;
  }, fraction);
}

/** Starts Bob's continuous background load: alternates, on a fixed
 * interval, inserting one character into a paragraph ~50 top-level blocks
 * away from Alice's, and into Alice's OWN paragraph (at its far end, away
 * from wherever Alice's own caret currently is) -- satisfying the brief's
 * "Bob types continuously into another paragraph 50 blocks away and into
 * Alice's paragraph" as concurrent background stress, not literally two
 * simultaneous cursors (Bob has exactly one). Bob's own edits are
 * dispatched as direct transactions (`insertContentAt`), not real OS
 * keyboard events: Bob is background load for this measurement, not the
 * thing being measured, and only one page can hold real OS keyboard focus
 * at a time in this headless setup (see the README's own note) -- Alice's
 * page needs that. Returns a stop function. */
async function startBobBackgroundLoad(bobPage: Page, farParagraphPos: number, aliceParagraphEndPos: number): Promise<() => Promise<void>> {
  await bobPage.evaluate(
    ({ farPos, aliceEndPos }) => {
      const editor = (window as any).phraise.editor;
      let turn = 0;
      const w = window as unknown as { __gateKBobTimer?: ReturnType<typeof setInterval>; __gateKBobFar: number; __gateKBobAlice: number };
      w.__gateKBobFar = farPos;
      w.__gateKBobAlice = aliceEndPos;
      w.__gateKBobTimer = setInterval(() => {
        try {
          const useFar = turn % 2 === 0;
          const pos = useFar ? w.__gateKBobFar : w.__gateKBobAlice;
          editor.commands.insertContentAt(pos, '‡'); // a distinctive marker (DOUBLE DAGGER), not a letter that also occurs in Alice's own typed phrase -- lets a test confirm Bob's edits genuinely landed, not just that the loop ran without throwing.
          if (useFar) w.__gateKBobFar += 1;
          else w.__gateKBobAlice += 1;
          turn++;
        } catch {
          // A position can go stale if Alice's own edits shift the doc
          // structurally right at this instant; skip this tick rather than
          // crash the interval -- the NEXT tick just resumes from wherever
          // the (already-advancing) counters point, still real continuous
          // background edits over the course of the measurement.
        }
      }, 120);
    },
    { farPos: farParagraphPos, aliceEndPos: aliceParagraphEndPos },
  );
  return async () => {
    await bobPage.evaluate(() => {
      const w = window as unknown as { __gateKBobTimer?: ReturnType<typeof setInterval> };
      if (w.__gateKBobTimer) clearInterval(w.__gateKBobTimer);
    });
  };
}

async function measureKeyToPaint(
  page: Page,
  aliceParagraphFrom: number,
  count: number,
): Promise<{ raf: ReturnType<typeof summarize>; events: { name: string; duration: number }[]; firstInput: number | null }> {
  await page.evaluate((pos) => {
    (window as any).phraise.editor.commands.focus();
    (window as any).phraise.editor.commands.setTextSelection(pos);
  }, aliceParagraphFrom);
  await installKeyToPaintObserver(page);
  await typeCharacters(page, count);
  const sample = await readKeyToPaintSample(page);
  return { raf: summarize(sample.raf), events: sample.events, firstInput: sample.firstInput };
}

test('[K] key press to paint: 200 characters with concurrent remote edits, Markdown panel closed', async ({ page, phraiseServer, browser }) => {
  const doc = 'scale-keypress-closed.md';
  seedDoc(phraiseServer, doc, LARGE_SOURCE);
  await page.goto(phraiseServer.pageUrl(doc, 'Alice'));
  await waitForFullyPainted(page, LARGE_BLOCK_COUNT);
  await waitForPhraise(page);

  const alice = await findParagraphNear(page, 0.5);
  const far = await findParagraphNear(page, 0.5 - 50 / LARGE_BLOCK_COUNT);

  const bobContext = await browser.newContext();
  const bobPage = await bobContext.newPage();
  await bobPage.goto(phraiseServer.pageUrl(doc, 'Bob'));
  await waitForFullyPainted(bobPage, LARGE_BLOCK_COUNT);
  await waitForPhraise(bobPage);
  await expect.poll(() => page.evaluate(() => (window as any).phraise.markdown())).toBe(await bobPage.evaluate(() => (window as any).phraise.markdown()));

  const aliceParagraphEnd = await page.evaluate(
    (idx) => {
      let pos = 0;
      const editor = (window as any).phraise.editor;
      editor.state.doc.forEach((node: any) => {
        pos += node.nodeSize;
      });
      let acc = 0;
      let end = -1;
      editor.state.doc.forEach((node: any, offset: number, i: number) => {
        if (i === idx) end = offset + node.nodeSize - 1;
      });
      return end;
    },
    alice.index,
  );

  const stopBob = await startBobBackgroundLoad(bobPage, far.from, aliceParagraphEnd);
  const { raf, events, firstInput } = await measureKeyToPaint(page, alice.from, 200);
  await stopBob();

  // Confirm Bob's background load genuinely reached Alice's page over the
  // relay (not just "the loop ran without throwing") -- his marker
  // character should appear at least a few times once synced.
  const markerCountOf = async (): Promise<number> =>
    (await page.evaluate(() => (window as any).phraise.markdown() as string)).split('‡').length - 1;
  await expect.poll(markerCountOf).toBeGreaterThan(0);
  const markerCount = await markerCountOf();
  await bobContext.close();

  results.keyToPaintPanelClosed = { rafMs: raf, eventTimingAbove16ms: events.length, firstInputMs: firstInput, bobEditsConfirmed: markerCount };
  console.log(`[K] key-to-paint (panel closed): RAF p50=${raf.p50.toFixed(1)}ms p95=${raf.p95.toFixed(1)}ms max=${raf.max.toFixed(1)}ms (n=${raf.n}); Event Timing entries >=16ms: ${events.length}; first-input: ${firstInput ?? 'n/a'}ms; Bob's concurrent edits confirmed synced: ${markerCount}`);

  // The gate's own pass criterion: p95 under 50ms, panel closed.
  expect(raf.p95, `p95 key-to-paint (${raf.p95.toFixed(1)}ms) should be under 50ms with the panel closed`).toBeLessThan(50);
});

test('[K] key press to paint: 200 characters with concurrent remote edits, Markdown panel open', async ({ page, phraiseServer, browser }) => {
  const doc = 'scale-keypress-open.md';
  seedDoc(phraiseServer, doc, LARGE_SOURCE);
  await page.goto(phraiseServer.pageUrl(doc, 'Alice'));
  await waitForFullyPainted(page, LARGE_BLOCK_COUNT);
  await waitForPhraise(page);

  // Open the Markdown panel (it debounce-refreshes on every doc change --
  // see main.ts's `refreshMarkdown` -- so this is genuinely extra ongoing
  // work during the measurement below, not just a static layout change).
  await page.click('#markdown-toggle');
  await expect(page.locator('#markdown-panel')).toBeVisible();

  const alice = await findParagraphNear(page, 0.5);
  const far = await findParagraphNear(page, 0.5 - 50 / LARGE_BLOCK_COUNT);

  const bobContext = await browser.newContext();
  const bobPage = await bobContext.newPage();
  await bobPage.goto(phraiseServer.pageUrl(doc, 'Bob'));
  await waitForFullyPainted(bobPage, LARGE_BLOCK_COUNT);
  await waitForPhraise(bobPage);
  await expect.poll(() => page.evaluate(() => (window as any).phraise.markdown())).toBe(await bobPage.evaluate(() => (window as any).phraise.markdown()));

  const aliceParagraphEnd = await page.evaluate((idx) => {
    let end = -1;
    const editor = (window as any).phraise.editor;
    editor.state.doc.forEach((node: any, offset: number, i: number) => {
      if (i === idx) end = offset + node.nodeSize - 1;
    });
    return end;
  }, alice.index);

  const stopBob = await startBobBackgroundLoad(bobPage, far.from, aliceParagraphEnd);
  const { raf, events, firstInput } = await measureKeyToPaint(page, alice.from, 200);
  await stopBob();

  const markerCountOf = async (): Promise<number> =>
    (await page.evaluate(() => (window as any).phraise.markdown() as string)).split('‡').length - 1;
  await expect.poll(markerCountOf).toBeGreaterThan(0);
  const markerCount = await markerCountOf();
  await bobContext.close();

  results.keyToPaintPanelOpen = { rafMs: raf, eventTimingAbove16ms: events.length, firstInputMs: firstInput, bobEditsConfirmed: markerCount };
  console.log(`[K] key-to-paint (panel open): RAF p50=${raf.p50.toFixed(1)}ms p95=${raf.p95.toFixed(1)}ms max=${raf.max.toFixed(1)}ms (n=${raf.n}); Event Timing entries >=16ms: ${events.length}; first-input: ${firstInput ?? 'n/a'}ms; Bob's concurrent edits confirmed synced: ${markerCount}`);
  // Not gated (only the panel-CLOSED number is the pass criterion), but
  // still reported and printed above.
});

test('[K] key press to paint: 200 characters on a small README, for comparison (solo, no concurrent editor)', async ({ page, phraiseServer }) => {
  // A small README has nowhere near 50 top-level blocks to place a
  // "50 blocks away" concurrent editor, so this comparison measurement is
  // deliberately solo (Alice alone) -- a baseline of the editor's own
  // per-keystroke cost without collaboration overhead, contrasted against
  // the two measurements above.
  const doc = 'scale-keypress-small.md';
  seedDoc(phraiseServer, doc, SMALL_SOURCE);
  await page.goto(phraiseServer.pageUrl(doc, 'Alice'));
  await waitForFullyPainted(page, SMALL_BLOCK_COUNT);
  await waitForPhraise(page);

  const alice = await findParagraphNear(page, 0.5);
  const { raf, events, firstInput } = await measureKeyToPaint(page, alice.from, 200);

  results.keyToPaintSmallReadme = { rafMs: raf, eventTimingAbove16ms: events.length, firstInputMs: firstInput, bytes: SMALL_SOURCE.length };
  console.log(`[K] key-to-paint (small README, solo): RAF p50=${raf.p50.toFixed(1)}ms p95=${raf.p95.toFixed(1)}ms max=${raf.max.toFixed(1)}ms (n=${raf.n})`);
});

// ---------------------------------------------------------------------------
// In-page costs.
// ---------------------------------------------------------------------------

test('[K] in-page costs: parseMarkdown, serializeDoc, gate H check (cold/warm), comment re-anchoring (20 comments)', async ({
  page,
  phraiseServer,
}) => {
  // parseMarkdown / serializeDoc: measured in Node (see this file's header
  // comment for why), on the same 245,936-byte fixture.
  const parseT0 = performance.now();
  const { doc: parsedDoc } = parseMarkdown(LARGE_SOURCE);
  const parseMarkdownMs = performance.now() - parseT0;

  const serializeT0 = performance.now();
  serializeDoc(parsedDoc);
  const serializeDocMs = performance.now() - serializeT0;

  console.log(`[K] parseMarkdown: ${parseMarkdownMs.toFixed(1)}ms; serializeDoc: ${serializeDocMs.toFixed(1)}ms (whole 245,936-byte file, Node/V8, not in-browser -- see header comment)`);

  // Gate H's per-block check, cold then warm, on the live editor.
  const doc = 'scale-inpage.md';
  seedDoc(phraiseServer, doc, LARGE_SOURCE);
  await page.goto(phraiseServer.pageUrl(doc, 'Alice'));
  await waitForFullyPainted(page, LARGE_BLOCK_COUNT);
  await waitForPhraise(page);

  const target = await findParagraphNear(page, 0.5);
  await page.evaluate(
    (pos) => {
      (window as any).phraise.editor.commands.focus();
      (window as any).phraise.editor.commands.insertContentAt(pos, 'X');
    },
    target.from,
  );
  // The check is debounced 400ms (unverifiedCheck.ts); wait past that,
  // then read back the FIRST ever run's timing -- this is "cold" (no
  // per-block cache entry exists yet for ANY block).
  await expect.poll(() => page.evaluate(() => (window as any).phraise.debugUnverifiedCheckRuns())).toBeGreaterThanOrEqual(1);
  const coldMs = await page.evaluate(() => (window as any).phraise.debugUnverifiedCheckLastMs());

  await page.evaluate(
    (pos) => {
      (window as any).phraise.editor.commands.insertContentAt(pos, 'Y');
    },
    target.from,
  );
  await expect.poll(() => page.evaluate(() => (window as any).phraise.debugUnverifiedCheckRuns())).toBeGreaterThanOrEqual(2);
  const warmMs = await page.evaluate(() => (window as any).phraise.debugUnverifiedCheckLastMs());

  console.log(`[K] gate H per-block check: cold ${coldMs.toFixed(1)}ms, warm (after one more edit) ${warmMs.toFixed(1)}ms`);

  // Comment re-anchoring pass with 20 comments: 20 real anchored threads,
  // spread across the document, created via the debug hook (bypasses the
  // composer UI -- gate F's own tests already cover that path with real
  // clicks); the 20th thread's own creation is itself the docChanged-
  // equivalent trigger the highlight plugin reacts to (Y.Map observer),
  // so reading `debugCommentHighlightLastMs()` right after gives exactly
  // "the re-anchoring pass with 20 comments" the brief asks for.
  const ranges = await page.evaluate(() => {
    const editor = (window as any).phraise.editor;
    const paragraphs: { from: number; to: number }[] = [];
    editor.state.doc.forEach((node: any, offset: number) => {
      if (node.type.name === 'paragraph' && node.textContent.trim().length > 20) {
        paragraphs.push({ from: offset + 1, to: offset + 6 });
      }
    });
    const step = Math.max(1, Math.floor(paragraphs.length / 20));
    const chosen: { from: number; to: number }[] = [];
    for (let i = 0; i < 20 && i * step < paragraphs.length; i++) chosen.push(paragraphs[i * step]!);
    return chosen;
  });
  expect(ranges.length).toBeGreaterThanOrEqual(20);
  for (const [i, r] of ranges.entries()) {
    await page.evaluate(({ from, to, i }: { from: number; to: number; i: number }) => (window as any).phraise.debugCreateComment(from, to, `scale test comment ${i}`), { ...r, i });
  }
  await expect.poll(() => page.evaluate(() => (window as any).phraise.debugCommentHighlightLastMs())).toBeGreaterThan(0);
  const reanchor20Ms = await page.evaluate(() => (window as any).phraise.debugCommentHighlightLastMs());
  console.log(`[K] comment re-anchoring pass with 20 comments: ${reanchor20Ms.toFixed(1)}ms`);

  results.inPageCosts = {
    parseMarkdownMs,
    serializeDocMs,
    gateHCheckColdMs: coldMs,
    gateHCheckWarmMs: warmMs,
    commentReanchor20Ms: reanchor20Ms,
  };
});
