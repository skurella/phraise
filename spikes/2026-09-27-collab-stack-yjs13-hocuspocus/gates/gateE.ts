// Gate E (charter): "For a document edited by two users, list who wrote
// which ranges and when. State where the mapping from client identity to
// user is kept and how it survives reconnects."
//
// Brief 03, task 3. See src/attribution.ts for the design (a Y.Map inside
// the document, not a relay-side table) and its justification, and
// src/relay.ts's onAuthenticate/onLoadDocument/onChange hooks for where it's
// wired in.
import 'global-jsdom/register';
import fs from 'node:fs';
import * as Y from 'yjs';
import { startRelay, type RelayHandle } from '../src/harness.js';
import { createLiveClient, waitUntil, type LiveClient } from '../src/client.js';
import { findPos, insertText } from './lib/edits.js';
import { listAttributedRanges, ATTRIBUTION_CONFLICTS_MAP_NAME, ATTRIBUTION_MAP_NAME, type AttributionEntry, type ConflictEntry } from '../src/attribution.js';

export interface GateEResult {
  pass: boolean;
  checks: { name: string; pass: boolean; detail: string }[];
  sizeMeasurement: { totalBytes: number; withoutAttributionBytes: number; deltaBytes: number; deltaPct: number };
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
  await new Promise((r) => setTimeout(r, 200)); // let the last onChange settle

  const doc1 = await fetchState(relay, DOC_NAME);
  const ranges = listAttributedRanges(doc1);
  const hasSeed = ranges.some((r) => r.user === 'seed' && r.text.includes('Live editing fixture'));
  const hasAlice = ranges.some((r) => r.user === 'alice' && r.text.includes('fromAlice'));
  const hasBob = ranges.some((r) => r.user === 'bob' && r.text.includes('fromBob'));
  checks.push({
    name: 'Listing: seed + alice + bob ranges walked from Yjs items',
    pass: hasSeed && hasAlice && hasBob,
    detail: `seed=${hasSeed} alice=${hasAlice} bob=${hasBob}; ${ranges.length} ranges total`,
  });

  // --- Collision: mallory injects a raw update forged with alice's real clientID ---
  // A second HocuspocusProvider forced to alice's clientID does NOT work as
  // a forgery test: Yjs's own client-side defense (yjs.cjs's
  // transactionCleanup: "Changed the client-id because another client
  // seems to be using it") reassigns a doc's clientID the moment it
  // *receives* a remote update under an ID matching its own -- which
  // happens during that second client's very first sync, before it could
  // ever send anything. A forged ID has to be injected as raw update bytes
  // through an already-synced, already-authenticated connection instead --
  // what a real attacker crafting protocol messages (not a polite client
  // library) would do.
  // Captured *before* the forgery: applying it makes alice's own live doc
  // receive a remote update under her own clientID, which triggers Yjs's
  // client-side self-defense (the "Changed the client-id" reassignment,
  // same mechanism noted above) on alice's copy -- so `alice.ydoc.clientID`
  // itself changes out from under us once the forged update lands. The
  // conflict was recorded against the ID as it stood at forgery time, so
  // the check below must use this captured value too, not a fresh read.
  const aliceClientIdAtForgeryTime = alice.ydoc.clientID;
  const mallory = await createLiveClient({ url: relay.wsUrl, docName: DOC_NAME, token: 'mallory' });
  const fake = new Y.Doc();
  fake.clientID = aliceClientIdAtForgeryTime;
  let forged: Uint8Array | undefined;
  fake.on('update', (u: Uint8Array) => {
    forged = u;
  });
  fake.getText('forged-scratch').insert(0, 'forged-by-mallory');
  Y.applyUpdate(mallory.ydoc, forged!); // mallory's own connection forwards this to the relay as an ordinary local change
  await new Promise((r) => setTimeout(r, 400));

  const doc2 = await fetchState(relay, DOC_NAME);
  const conflicts = doc2.getMap<ConflictEntry[]>(ATTRIBUTION_CONFLICTS_MAP_NAME);
  const conflictLog = conflicts.get(String(aliceClientIdAtForgeryTime)) ?? [];
  const flagged = conflictLog.some((c) => c.existingUser === 'alice' && c.attemptedUser === 'mallory');
  const attrMap = doc2.getMap<AttributionEntry>(ATTRIBUTION_MAP_NAME);
  const notOverwritten = attrMap.get(String(aliceClientIdAtForgeryTime))?.user === 'alice';
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
  const { relay, alice, bob } = await (async () => {
    const relay = await startRelay({ port, db: dbPath, seeds: 'fixtures' });
    const alice = await createLiveClient({ url: relay.wsUrl, docName: DOC_NAME, token: 'alice' });
    const bob = await createLiveClient({ url: relay.wsUrl, docName: DOC_NAME, token: 'bob' });
    return { relay, alice, bob };
  })();

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
  let attrMap = doc.getMap<AttributionEntry>(ATTRIBUTION_MAP_NAME);
  const sameClientId = alice.ydoc.clientID === clientIdBeforeReconnect;
  const entry = attrMap.get(String(clientIdBeforeReconnect));
  const stillOneKeyForAlice = sameClientId && entry?.user === 'alice' && entry.ranges.length >= 2;
  checks.push({
    name: 'Reconnect: same Y.Doc + same clientID, ranges accumulate under it',
    pass: stillOneKeyForAlice,
    detail: `clientID unchanged=${sameClientId}; ranges for that client=${entry?.ranges.length ?? 0}`,
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
  attrMap = doc.getMap<AttributionEntry>(ATTRIBUTION_MAP_NAME);
  const newIdDiffers = newClientId !== clientIdBeforeReconnect;
  const oldEntryStillAlice = attrMap.get(String(clientIdBeforeReconnect))?.user === 'alice';
  const newEntryAlice = attrMap.get(String(newClientId))?.user === 'alice';
  checks.push({
    name: 'Reload: new Y.Doc + new clientID mapped to the same user, no conflict',
    pass: newIdDiffers && oldEntryStillAlice && newEntryAlice,
    detail: `newClientID!=old=${newIdDiffers} oldEntryUser=alice:${oldEntryStillAlice} newEntryUser=alice:${newEntryAlice} (${attrMap.size} distinct client IDs mapped total)`,
  });

  aliceReloaded.destroy();
  bob.destroy();
  await relay.stop();
  return checks;
}

async function runRestartSurvival(port: number, dbPath: string): Promise<GateEResult['checks']> {
  fs.rmSync(dbPath, { force: true }); // only before the FIRST startRelay -- the db must persist across the restart itself, below.
  const checks: GateEResult['checks'] = [];
  let relay = await startRelay({ port, db: dbPath, seeds: 'fixtures', debounce: 200, maxDebounce: 500 });
  const alice = await createLiveClient({ url: relay.wsUrl, docName: DOC_NAME, token: 'alice' });
  const pos = paraPos(alice.view, 'A closing paragraph');
  insertText(alice.view, pos + alice.view.state.doc.nodeAt(pos)!.nodeSize - 1, ' beforeRestart');
  const clientId = alice.ydoc.clientID;
  await new Promise((r) => setTimeout(r, 700)); // past the shortened debounce
  alice.destroy();
  await relay.stop(); // graceful (SIGTERM): src/harness.ts's stop() sends SIGTERM first

  relay = await startRelay({ port, db: dbPath, seeds: 'fixtures', debounce: 200, maxDebounce: 500 });
  // The relay's /state endpoint only reflects documents already resident in
  // its in-process map (see src/relay.ts's onRequest); right after a fresh
  // restart nothing is loaded yet, so a bare fetchState reads back 0 bytes
  // even though SQLite has the row (confirmed directly with
  // scripts/smoke-restart.ts). Reconnecting a client is what actually
  // triggers onLoadDocument (-> SQLite restore) for this docName, same as
  // any real client would; only then does /state reflect it.
  const reconnected = await createLiveClient({ url: relay.wsUrl, docName: DOC_NAME, token: 'alice' });
  const doc = await fetchState(relay, DOC_NAME);
  reconnected.destroy();
  const attrMap = doc.getMap<AttributionEntry>(ATTRIBUTION_MAP_NAME);
  const entry = attrMap.get(String(clientId));
  const survived = entry?.user === 'alice' && entry.ranges.length > 0;
  checks.push({
    name: 'Restart: attribution Y.Map survives a relay restart (same persistence as the document)',
    pass: !!survived,
    detail: survived ? `alice's mapping (client ${clientId}) intact after restart` : `mapping missing after restart (entry=${JSON.stringify(entry)})`,
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
      let at = posA + alice.view.state.doc.nodeAt(posA)!.nodeSize - 1;
      at = insertText(alice.view, at, 'the quick brown fox jumps');
      const posB = paraPos(bob.view, 'Some inline HTML');
      let atB = posB + bob.view.state.doc.nodeAt(posB)!.nodeSize - 1;
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

  const { checks: c1, alice, bob, relay } = await runListingAndCollision(opts.ports.listing, `${opts.dbDir}/gateE-listing.sqlite`);
  checks.push(...c1);
  alice.destroy();
  bob.destroy();
  await relay.stop();

  // gates:quick's "short version": the listing + collision check above is
  // this gate's headline demonstration (where the mapping lives, how a
  // forged ID is caught); reconnect/reload/restart/size are its own
  // separate, slower relay rounds, skipped here for speed.
  let sizeMeasurement: GateEResult['sizeMeasurement'] = { totalBytes: 0, withoutAttributionBytes: 0, deltaBytes: 0, deltaPct: 0 };
  if (!opts.quick) {
    checks.push(...(await runReconnectAndReload(opts.ports.reconnect, `${opts.dbDir}/gateE-reconnect.sqlite`)));
    checks.push(...(await runRestartSurvival(opts.ports.restart, `${opts.dbDir}/gateE-restart.sqlite`)));
    sizeMeasurement = await measureSize(
      opts.ports.sizeWith,
      opts.ports.sizeWithout,
      `${opts.dbDir}/gateE-size-with.sqlite`,
      `${opts.dbDir}/gateE-size-without.sqlite`,
    );
  }

  const pass = checks.every((c) => c.pass);
  return {
    pass,
    checks,
    sizeMeasurement,
    detail: pass
      ? `all ${checks.length} checks passed${opts.quick ? ' (quick: listing + collision only)' : `; attribution overhead ${sizeMeasurement.deltaBytes}B (${sizeMeasurement.deltaPct.toFixed(1)}%) of ${sizeMeasurement.withoutAttributionBytes}B`}`
      : checks.filter((c) => !c.pass).map((c) => `${c.name}: ${c.detail}`).join('; '),
  };
}
