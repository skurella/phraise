// Gate E (charter): "For a document edited by two users, list who wrote
// which ranges and when. State where the mapping from client identity to
// user is kept and how it survives reconnects."
//
// Brief 04, task 4a. See src/attribution.ts for the design (an `@y/y`
// `IdMap` of `ContentAttribute`s, persisted inside the document's own
// `phraise-attribution` Y.Map) and its justification, and
// src/relay-hocuspocus.ts's onAuthenticate/onLoadDocument/onChange hooks
// for where it's wired in. Same listing/reconnect/reload/restart/size
// checks as stack 13's gate E.
import 'global-jsdom/register';
import fs from 'node:fs';
import * as Y from 'yjs';
import { startRelay, type RelayHandle } from '../src/harness.js';
import { createLiveClient, waitUntil, type LiveClient } from '../src/client-hocuspocus.js';
import { findPos, insertText } from './lib/edits.js';
import { listAttributedRanges, conflictsForClient, userForClient } from '../src/attribution.js';
import { runGateESuggestion, type GateESuggestionResult } from './gateE-suggestion.js';

export interface GateEResult {
  pass: boolean;
  checks: { name: string; pass: boolean; detail: string }[];
  sizeMeasurement: { totalBytes: number; withoutAttributionBytes: number; deltaBytes: number; deltaPct: number };
  suggestionMode: GateESuggestionResult;
  detail: string;
}

const DOC_NAME = 'file:live.md';

function paraPos(view: import('prosemirror-view').EditorView, needle: string): number {
  return findPos(view, (n) => n.type.name === 'paragraph' && n.textContent.includes(needle));
}

async function fetchState(relay: RelayHandle, docName: string): Promise<Y.Doc> {
  const bytes = await relay.fetchState(docName);
  const scratch = new Y.Doc();
  if (bytes.length > 0) Y.applyUpdate(scratch, bytes);
  return scratch;
}

async function runListingAndCollision(port: number, dbPath: string): Promise<{ checks: GateEResult['checks']; alice: LiveClient; bob: LiveClient; relay: RelayHandle }> {
  fs.rmSync(dbPath, { force: true });
  const checks: GateEResult['checks'] = [];
  const relay = await startRelay({ port, db: dbPath, seeds: 'fixtures' });
  const alice = await createLiveClient({ url: relay.wsUrl, docName: DOC_NAME, token: 'alice' });
  const bob = await createLiveClient({ url: relay.wsUrl, docName: DOC_NAME, token: 'bob' });

  const posA = paraPos(alice.view, 'A closing paragraph');
  insertText(alice.view, posA + alice.view.state.doc.nodeAt(posA)!.nodeSize - 1, ' fromAlice');
  await waitUntil(() => bob.view.state.doc.textContent.includes('fromAlice'), 5000);

  const posB = paraPos(bob.view, 'Some inline HTML');
  insertText(bob.view, posB + bob.view.state.doc.nodeAt(posB)!.nodeSize - 1, ' fromBob');
  await waitUntil(() => alice.view.state.doc.textContent.includes('fromBob'), 5000);
  await new Promise((r) => setTimeout(r, 200));

  const doc1 = await fetchState(relay, DOC_NAME);
  const ranges = listAttributedRanges(doc1);
  const hasSeed = ranges.some((r) => r.user === 'seed' && r.text.includes('Live editing fixture'));
  const hasAlice = ranges.some((r) => r.user === 'alice' && r.text.includes('fromAlice'));
  const hasBob = ranges.some((r) => r.user === 'bob' && r.text.includes('fromBob'));
  checks.push({
    name: 'Listing: seed + alice + bob ranges walked from Yjs items (IdMap)',
    pass: hasSeed && hasAlice && hasBob,
    detail: `seed=${hasSeed} alice=${hasAlice} bob=${hasBob}; ${ranges.length} ranges total`,
  });

  // --- Collision: mallory injects a raw update forged with alice's real clientID ---
  // Same technique stack 13's gate E uses and the same reason a second
  // provider forced to alice's clientID does NOT work as a forgery test:
  // Yjs's own client-side defense reassigns a doc's clientID the moment it
  // *receives* a remote update under an ID matching its own. A forged ID
  // has to be injected as raw update bytes through an already-synced,
  // already-authenticated connection instead.
  //
  // A first attempt (kept in scratch/probe-collision.ts) built `fake` as a
  // brand-new empty Y.Doc before reassigning its clientID to alice's real
  // one: its own clock for that client then started at 0, which COLLIDES
  // with the clock range alice's real edits already occupy in the actual
  // document (she'd already made an edit before this clientID was
  // captured). An update whose structs are already fully known produces an
  // EMPTY outgoing update (Yjs has nothing new to broadcast), so it never
  // even reaches `recordAttribution` (which returns immediately on `inserts
  // .isEmpty()`) -- the "collision" silently never happened. Fixed by
  // syncing `fake` with alice's CURRENT full state FIRST (a real attacker
  // who can read the synced document, which any peer can, has this too),
  // so its clock bookkeeping for her clientID picks up genuinely NEW clock
  // values -- a real, indistinguishable-from-legitimate forged continuation.
  const aliceClientIdAtForgeryTime = alice.ydoc.clientID;
  const mallory = await createLiveClient({ url: relay.wsUrl, docName: DOC_NAME, token: 'mallory' });
  const fake = new Y.Doc();
  Y.applyUpdate(fake, Y.encodeStateAsUpdate(alice.ydoc));
  fake.clientID = aliceClientIdAtForgeryTime;
  let forged: Uint8Array | undefined;
  fake.on('update', (u: Uint8Array) => {
    forged = u;
  });
  // `@y/y`'s Doc has no more getText/getMap/etc -- every shared type comes
  // from `.get(name)` (a unified Node); `.insert` on it takes an array of
  // content items (same generic list API a plain Y.Array would have).
  (fake.get('forged-scratch') as unknown as { insert(i: number, c: unknown[]): void }).insert(0, ['forged-by-mallory']);
  Y.applyUpdate(mallory.ydoc, forged!);
  await new Promise((r) => setTimeout(r, 400));

  const doc2 = await fetchState(relay, DOC_NAME);
  const conflictLog = conflictsForClient(doc2, aliceClientIdAtForgeryTime);
  const flagged = conflictLog.some((c) => c.existingUser === 'alice' && c.attemptedUser === 'mallory');
  const notOverwritten = userForClient(doc2, aliceClientIdAtForgeryTime) === 'alice';
  const aliceSelfHealed = alice.ydoc.clientID !== aliceClientIdAtForgeryTime;
  checks.push({
    name: 'Collision: forged client ID flagged, not overwritten',
    pass: flagged && notOverwritten,
    detail: `flagged=${flagged} groundTruthKept=${notOverwritten} log=${JSON.stringify(conflictLog)}; note: alice's OWN clientID self-reassigned=${aliceSelfHealed} (Yjs's client-side defense reacting to receiving her own forged ID back)`,
  });

  mallory.destroy();
  return { checks, alice, bob, relay };
}

async function runReconnectAndReload(port: number, dbPath: string): Promise<GateEResult['checks']> {
  fs.rmSync(dbPath, { force: true });
  const checks: GateEResult['checks'] = [];
  const relay = await startRelay({ port, db: dbPath, seeds: 'fixtures' });
  const alice = await createLiveClient({ url: relay.wsUrl, docName: DOC_NAME, token: 'alice' });
  const bob = await createLiveClient({ url: relay.wsUrl, docName: DOC_NAME, token: 'bob' });

  const clientIdBeforeReconnect = alice.ydoc.clientID;
  alice.websocketProvider.disconnect();
  await new Promise((r) => setTimeout(r, 150));
  alice.websocketProvider.connect();
  await alice.waitForSynced();

  const pos = paraPos(alice.view, 'A closing paragraph');
  insertText(alice.view, pos + alice.view.state.doc.nodeAt(pos)!.nodeSize - 1, ' postReconnect');
  await waitUntil(() => bob.view.state.doc.textContent.includes('postReconnect'), 5000);
  await new Promise((r) => setTimeout(r, 200));

  let doc = await fetchState(relay, DOC_NAME);
  const sameClientId = alice.ydoc.clientID === clientIdBeforeReconnect;
  // "ranges accumulate under it": alice's post-reconnect edit is itself
  // attributed to her, under the SAME clientID -- checked via
  // userForClient (the ground truth) plus the merged listing actually
  // containing her new text, rather than counting exact range entries
  // (listAttributedRanges merges adjacent same-(user,timestamp) runs for
  // readability; how many merged entries a multi-character edit produces
  // depends on millisecond-granularity server receive times per character,
  // not a meaningful thing to assert on its own).
  const rangesAfterReconnect = listAttributedRanges(doc).filter((r) => r.user === 'alice');
  const hasPostReconnectText = rangesAfterReconnect.some((r) => r.text.includes('postReconnect'));
  const stillMappedToAlice = sameClientId && userForClient(doc, clientIdBeforeReconnect) === 'alice' && hasPostReconnectText;
  checks.push({
    name: 'Reconnect: same Y.Doc + same clientID, ranges accumulate under it',
    pass: stillMappedToAlice,
    detail: `clientID unchanged=${sameClientId}; still mapped to alice=${userForClient(doc, clientIdBeforeReconnect) === 'alice'}; her post-reconnect edit is visible and attributed=${hasPostReconnectText}; ${rangesAfterReconnect.length} alice-attributed range(s) total`,
  });

  // --- Page reload: a NEW Y.Doc (and so a new clientID) for the same user ---
  alice.destroy();
  const aliceReloaded = await createLiveClient({ url: relay.wsUrl, docName: DOC_NAME, token: 'alice' });
  const newClientId = aliceReloaded.ydoc.clientID;
  const posR = paraPos(aliceReloaded.view, 'A closing paragraph');
  insertText(aliceReloaded.view, posR + aliceReloaded.view.state.doc.nodeAt(posR)!.nodeSize - 1, ' postReload');
  await waitUntil(() => bob.view.state.doc.textContent.includes('postReload'), 5000);
  await new Promise((r) => setTimeout(r, 200));

  doc = await fetchState(relay, DOC_NAME);
  const newIdDiffers = newClientId !== clientIdBeforeReconnect;
  const oldEntryStillAlice = userForClient(doc, clientIdBeforeReconnect) === 'alice';
  const newEntryAlice = userForClient(doc, newClientId) === 'alice';
  checks.push({
    name: 'Reload: new Y.Doc + new clientID mapped to the same user, no conflict',
    pass: newIdDiffers && oldEntryStillAlice && newEntryAlice,
    detail: `newClientID!=old=${newIdDiffers} oldEntryUser=alice:${oldEntryStillAlice} newEntryUser=alice:${newEntryAlice}`,
  });

  aliceReloaded.destroy();
  bob.destroy();
  await relay.stop();
  return checks;
}

async function runRestartSurvival(port: number, dbPath: string): Promise<GateEResult['checks']> {
  fs.rmSync(dbPath, { force: true });
  const checks: GateEResult['checks'] = [];
  let relay = await startRelay({ port, db: dbPath, seeds: 'fixtures', debounce: 200, maxDebounce: 500 });
  const alice = await createLiveClient({ url: relay.wsUrl, docName: DOC_NAME, token: 'alice' });
  const pos = paraPos(alice.view, 'A closing paragraph');
  insertText(alice.view, pos + alice.view.state.doc.nodeAt(pos)!.nodeSize - 1, ' beforeRestart');
  const clientId = alice.ydoc.clientID;
  await new Promise((r) => setTimeout(r, 700));
  alice.destroy();
  await relay.stop();

  relay = await startRelay({ port, db: dbPath, seeds: 'fixtures', debounce: 200, maxDebounce: 500 });
  const reconnected = await createLiveClient({ url: relay.wsUrl, docName: DOC_NAME, token: 'alice' });
  const doc = await fetchState(relay, DOC_NAME);
  reconnected.destroy();
  const stillAlice = userForClient(doc, clientId) === 'alice';
  const hasRanges = listAttributedRanges(doc).some((r) => r.user === 'alice' && r.text.includes('beforeRestart'));
  checks.push({
    name: 'Restart: attribution IdMap survives a relay restart (same persistence as the document)',
    pass: stillAlice && hasRanges,
    detail: stillAlice && hasRanges ? `alice's mapping (client ${clientId}) intact after restart` : `mapping missing after restart (userForClient=${stillAlice}, hasRanges=${hasRanges})`,
  });
  await relay.stop();
  return checks;
}

async function measureSize(portWith: number, portWithout: number, dbWith: string, dbWithout: string): Promise<GateEResult['sizeMeasurement']> {
  async function run(port: number, dbPath: string, noAttribution: boolean): Promise<number> {
    fs.rmSync(dbPath, { force: true });
    const relay = await startRelay({ port, db: dbPath, seeds: 'fixtures', noAttribution });
    try {
      const alice = await createLiveClient({ url: relay.wsUrl, docName: DOC_NAME, token: 'alice' });
      const bob = await createLiveClient({ url: relay.wsUrl, docName: DOC_NAME, token: 'bob' });
      const posA = paraPos(alice.view, 'A closing paragraph');
      const at = posA + alice.view.state.doc.nodeAt(posA)!.nodeSize - 1;
      insertText(alice.view, at, 'the quick brown fox jumps');
      const posB = paraPos(bob.view, 'Some inline HTML');
      const atB = posB + bob.view.state.doc.nodeAt(posB)!.nodeSize - 1;
      insertText(bob.view, atB, 'over the lazy dog and back');
      await waitUntil(() => bob.view.state.doc.textContent.includes('the quick brown fox'), 5000);
      await waitUntil(() => alice.view.state.doc.textContent.includes('over the lazy dog'), 5000);
      await new Promise((r) => setTimeout(r, 200));
      const bytes = await relay.fetchState(DOC_NAME);
      alice.destroy();
      bob.destroy();
      return bytes.length;
    } finally {
      await relay.stop();
    }
  }

  const totalBytes = await run(portWith, dbWith, false);
  const withoutAttributionBytes = await run(portWithout, dbWithout, true);
  const deltaBytes = totalBytes - withoutAttributionBytes;
  const deltaPct = withoutAttributionBytes > 0 ? (deltaBytes / withoutAttributionBytes) * 100 : 0;
  return { totalBytes, withoutAttributionBytes, deltaBytes, deltaPct };
}

export async function runGateE(opts: {
  ports: { listing: number; reconnect: number; restart: number; sizeWith: number; sizeWithout: number };
  dbDir: string;
  quick?: boolean;
}): Promise<GateEResult> {
  const checks: GateEResult['checks'] = [];

  const { checks: c1, alice, bob, relay } = await runListingAndCollision(opts.ports.listing, `${opts.dbDir}/gateE-listing-hp.sqlite`);
  checks.push(...c1);
  alice.destroy();
  bob.destroy();
  await relay.stop();

  let sizeMeasurement: GateEResult['sizeMeasurement'] = { totalBytes: 0, withoutAttributionBytes: 0, deltaBytes: 0, deltaPct: 0 };
  if (!opts.quick) {
    checks.push(...(await runReconnectAndReload(opts.ports.reconnect, `${opts.dbDir}/gateE-reconnect-hp.sqlite`)));
    checks.push(...(await runRestartSurvival(opts.ports.restart, `${opts.dbDir}/gateE-restart-hp.sqlite`)));
    sizeMeasurement = await measureSize(
      opts.ports.sizeWith,
      opts.ports.sizeWithout,
      `${opts.dbDir}/gateE-size-with-hp.sqlite`,
      `${opts.dbDir}/gateE-size-without-hp.sqlite`,
    );
  }

  // Part (b): suggestion mode. Runs headless (no relay needed -- it exercises
  // the DiffRenderer/suggestion mechanism itself, not the relay/attribution
  // persistence path parts (a) above already covers).
  const suggestionMode = await runGateESuggestion();

  const pass = checks.every((c) => c.pass) && suggestionMode.pass;
  return {
    pass,
    checks,
    sizeMeasurement,
    suggestionMode,
    detail: pass
      ? `all ${checks.length} checks passed${opts.quick ? ' (quick: listing + collision only)' : `; attribution overhead ${sizeMeasurement.deltaBytes}B (${sizeMeasurement.deltaPct.toFixed(1)}%) of ${sizeMeasurement.withoutAttributionBytes}B`}; suggestion mode: ${suggestionMode.detail}`
      : [...checks.filter((c) => !c.pass).map((c) => `${c.name}: ${c.detail}`), ...(suggestionMode.pass ? [] : [`suggestion mode: ${suggestionMode.detail}`])].join('; '),
  };
}
