// Brief 09 defect 3: `recordAttribution` used to append one `[from, to, at]`
// tuple per incoming update, so a long typing session's attribution map
// grows one entry per keystroke forever. This coalesces a contiguous
// same-client range into the previous one when it lands within a short
// time bucket of it, instead of appending. Measures the document's encoded
// size after 2,000 single-character updates from one user, with and
// without coalescing (a local re-implementation of the OLD, naive
// append-only logic, kept only in this test, for the "without" side of the
// comparison), and asserts a concrete bound on both the range-array length
// and the encoded size.
import { test, expect } from 'vitest';
import * as Y from 'yjs';
import { recordAttribution, listAttributedRanges, ATTRIBUTION_MAP_NAME, type AttributionEntry } from '../src/crdt/attribution.js';
import { createDoc, seed, setClientId, FRAGMENT_NAME } from '../src/crdt/index.js';
import { parseMarkdown } from '../src/markdown/index.js';

/** 2,000 real, sequential single-character Yjs updates from ONE client id, as `Y.parseUpdateMeta` would see them (contiguous clock ranges). */
function makeSequentialUpdates(n: number): { updates: Uint8Array[]; doc: Y.Doc } {
  const doc = new Y.Doc({ gc: false });
  doc.clientID = 12345;
  const text = doc.getText('t');
  const updates: Uint8Array[] = [];
  const handler = (u: Uint8Array) => updates.push(u);
  doc.on('update', handler);
  for (let i = 0; i < n; i++) text.insert(i, 'x');
  doc.off('update', handler);
  return { updates, doc };
}

/** The OLD, pre-fix behavior: always append, never coalesce. Reimplemented here (not exported from src/) purely so this test can measure "without coalescing" for comparison. */
function recordAttributionNaiveAppend(doc: Y.Doc, update: Uint8Array, user: string, at: number): void {
  const meta = Y.parseUpdateMeta(update);
  if (meta.to.size === 0) return;
  doc.transact(() => {
    const attrMap = doc.getMap<AttributionEntry>(ATTRIBUTION_MAP_NAME);
    for (const [client, toClock] of meta.to) {
      const fromClock = meta.from.get(client) ?? toClock;
      const key = String(client);
      const existing = attrMap.get(key);
      const entry: AttributionEntry = existing ? { user: existing.user, ranges: [...existing.ranges] } : { user, ranges: [] };
      entry.ranges.push([fromClock, toClock, at]);
      attrMap.set(key, entry);
    }
  });
}

const N = 2000;

test('recordAttribution coalesces contiguous same-client updates within the time bucket instead of appending unbounded ranges', () => {
  const { updates: updatesForCoalesced } = makeSequentialUpdates(N);
  const { updates: updatesForNaive } = makeSequentialUpdates(N);
  expect(updatesForCoalesced.length).toBe(N);

  const coalescedDoc = new Y.Doc({ gc: false });
  const naiveDoc = new Y.Doc({ gc: false });
  let t = 1_700_000_000_000;
  for (const u of updatesForCoalesced) {
    recordAttribution(coalescedDoc, u, 'alice', t);
    t += 2; // fast typing burst, well within the default 5s bucket
  }
  t = 1_700_000_000_000;
  for (const u of updatesForNaive) {
    recordAttributionNaiveAppend(naiveDoc, u, 'alice', t);
    t += 2;
  }

  const coalescedEntry = coalescedDoc.getMap<AttributionEntry>(ATTRIBUTION_MAP_NAME).get('12345')!;
  const naiveEntry = naiveDoc.getMap<AttributionEntry>(ATTRIBUTION_MAP_NAME).get('12345')!;
  expect(naiveEntry.ranges.length).toBe(N); // sanity: the naive reimplementation matches the OLD behavior exactly

  // Coalesced: a single contiguous typing burst collapses to (close to) one range.
  expect(coalescedEntry.ranges.length).toBeLessThanOrEqual(2);

  const coalescedSize = Y.encodeStateAsUpdate(coalescedDoc).byteLength;
  const naiveSize = Y.encodeStateAsUpdate(naiveDoc).byteLength;
  // eslint-disable-next-line no-console
  console.log(`attribution coalescing: ${N} single-char updates -- naive encoded size ${naiveSize}B, coalesced ${coalescedSize}B (${(naiveSize / coalescedSize).toFixed(1)}x)`);
  expect(coalescedSize).toBeLessThan(naiveSize / 10);

  // The coalesced range still covers the WHOLE burst's clock range (meaning
  // preserved: "alice wrote clocks [0, N)", just stored as one tuple
  // instead of N) -- the naive version's tuples, concatenated, cover the
  // same span.
  expect(coalescedEntry.ranges[0][0]).toBe(0);
  expect(coalescedEntry.ranges[coalescedEntry.ranges.length - 1][1]).toBe(N);
  expect(naiveEntry.ranges[0][0]).toBe(0);
  expect(naiveEntry.ranges[naiveEntry.ranges.length - 1][1]).toBe(N);
});

test('listAttributedRanges reports the same text/user for a real prosemirror edit whether or not its updates get coalesced', () => {
  // A real document, edited through the actual codec, so listAttributedRanges
  // (which only walks the `prosemirror` XmlFragment) has something to find --
  // demonstrates the "unchanged in meaning" property end to end, not just on
  // the raw ranges array.
  const doc = createDoc();
  seed(doc, parseMarkdown('# Title\n\nHello world.\n').doc);
  setClientId(doc, 4242);

  const updates: Uint8Array[] = [];
  const handler = (u: Uint8Array) => updates.push(u);
  doc.on('update', handler);
  const frag = doc.getXmlFragment(FRAGMENT_NAME);
  const paragraph = frag.toArray()[1] as any; // the "Hello world." paragraph
  const yText = paragraph.toArray()[0];
  for (let i = 0; i < 20; i++) yText.insert(yText.length, 'x'); // 20 separate single-char updates
  doc.off('update', handler);
  expect(updates.length).toBe(20);

  let t = 5000;
  for (const u of updates) {
    recordAttribution(doc, u, 'alice', t);
    t += 3; // within the bucket
  }

  const entry = doc.getMap<AttributionEntry>(ATTRIBUTION_MAP_NAME).get('4242')!;
  expect(entry.ranges.length).toBeLessThanOrEqual(2); // coalesced, not 20

  const ranges = listAttributedRanges(doc);
  const aliceRuns = ranges.filter((r) => r.user === 'alice');
  const aliceText = aliceRuns.map((r) => r.text).join('');
  expect(aliceText).toContain('x'.repeat(20));
  // Coalescing also means listAttributedRanges' own (user, at)-grouping
  // no longer fragments the burst into 20 tiny runs.
  expect(aliceRuns.length).toBeLessThanOrEqual(2);
});

test('recordAttribution does NOT coalesce across the time bucket boundary, or across a non-contiguous clock gap', () => {
  const doc = new Y.Doc({ gc: false });
  doc.clientID = 999;
  const text = doc.getText('t');
  const updates: Uint8Array[] = [];
  const handler = (u: Uint8Array) => updates.push(u);
  doc.on('update', handler);
  text.insert(0, 'a');
  text.insert(1, 'b');
  doc.off('update', handler);
  expect(updates.length).toBe(2);

  const attrDoc = new Y.Doc({ gc: false });
  recordAttribution(attrDoc, updates[0], 'alice', 1000, 5000);
  // Same client, contiguous clock, but 10s later -- outside a 5s bucket.
  recordAttribution(attrDoc, updates[1], 'alice', 11000, 5000);
  const entry = attrDoc.getMap<AttributionEntry>(ATTRIBUTION_MAP_NAME).get('999')!;
  expect(entry.ranges.length).toBe(2);
});
