// Gate G (charter): "The relay persists a document, restarts, and clients
// reconnect without loss. An editor that was offline during edits
// reconnects and converges."
//
// Brief 04, task 3. Four scenarios (G1-G4), same shape as stack 13's gate
// G, against this stack's Hocuspocus relay (src/relay-hocuspocus.ts) and
// client (src/client-hocuspocus.ts). Shortened debounce/maxDebounce
// (Hocuspocus's own defaults: 2000ms/10000ms) so restart/kill scenarios
// don't need multi-second real waits.
//
// Same constraint stack 13 discovered (confirmed here too): the relay's
// own GET /state/<docName> endpoint only reflects documents already
// resident in its in-process map. Right after a fresh restart nothing is
// loaded yet, so a bare fetchState reads back 0 bytes even though SQLite
// has the row -- a client has to connect first to trigger onLoadDocument
// (-> SQLite restore). Every scenario below reconnects at least one live
// client before checking /state for this reason.
import 'global-jsdom/register';
import fs from 'node:fs';
import { startRelay, type RelayHandle } from '../src/harness.js';
import { createLiveClient, waitUntil, type LiveClient } from '../src/client-hocuspocus.js';
import { findPos, insertText } from './lib/edits.js';
import { checkEquality, decodeRelayState } from './lib/equality.js';

export interface GateGCheck {
  name: string;
  pass: boolean;
  detail: string;
}
export interface GateGResult {
  pass: boolean;
  checks: GateGCheck[];
  detail: string;
}

const DOC_NAME = 'file:live.md';
const DEBOUNCE = 200;
const MAX_DEBOUNCE = 500;

function paraEnd(view: import('prosemirror-view').EditorView, needle: string): number {
  const pos = findPos(view, (n) => n.type.name === 'paragraph' && n.textContent.includes(needle));
  const node = view.state.doc.nodeAt(pos)!;
  return pos + node.nodeSize - 1;
}

// --- G1: graceful restart (SIGTERM) ---
async function runG1(port: number, dbPath: string): Promise<GateGCheck> {
  fs.rmSync(dbPath, { force: true });
  let relay = await startRelay({ port, db: dbPath, seeds: 'fixtures', debounce: DEBOUNCE, maxDebounce: MAX_DEBOUNCE });
  const alice = await createLiveClient({ url: relay.wsUrl, docName: DOC_NAME, token: 'alice' });
  const bob = await createLiveClient({ url: relay.wsUrl, docName: DOC_NAME, token: 'bob' });

  insertText(alice.view, paraEnd(alice.view, 'A closing paragraph'), ' g1alice');
  insertText(bob.view, paraEnd(bob.view, 'Some inline HTML'), ' g1bob');
  await waitUntil(() => alice.view.state.doc.textContent.includes('g1bob'), 5000);
  await new Promise((r) => setTimeout(r, MAX_DEBOUNCE + 300));

  alice.destroy();
  bob.destroy();
  await relay.stop(); // SIGTERM; relay-hocuspocus.ts's own SIGTERM handler also flushPendingStores() defensively.

  relay = await startRelay({ port, db: dbPath, seeds: 'fixtures', debounce: DEBOUNCE, maxDebounce: MAX_DEBOUNCE });
  const alice2 = await createLiveClient({ url: relay.wsUrl, docName: DOC_NAME, token: 'alice' });
  const bob2 = await createLiveClient({ url: relay.wsUrl, docName: DOC_NAME, token: 'bob' });
  const contentIntact = alice2.view.state.doc.textContent.includes('g1alice') && alice2.view.state.doc.textContent.includes('g1bob');

  insertText(alice2.view, paraEnd(alice2.view, 'g1alice'), ' newAfterRestart');
  await waitUntil(() => bob2.view.state.doc.textContent.includes('newAfterRestart'), 5000);
  const newEditPropagates = bob2.view.state.doc.textContent.includes('newAfterRestart');

  alice2.destroy();
  bob2.destroy();
  await relay.stop();
  return {
    name: 'G1. Restart (SIGTERM): both providers reconnect, content intact, new edit propagates',
    pass: contentIntact && newEditPropagates,
    detail: `contentIntact=${contentIntact} newEditPropagates=${newEditPropagates}`,
  };
}

// --- G2: hard kill (SIGKILL), before and after the debounce ---
async function runG2Case(port: number, dbPath: string, waitBeforeKillMs: number): Promise<GateGCheck> {
  fs.rmSync(dbPath, { force: true });
  let relay = await startRelay({ port, db: dbPath, seeds: 'fixtures', debounce: DEBOUNCE, maxDebounce: MAX_DEBOUNCE });
  const alice = await createLiveClient({ url: relay.wsUrl, docName: DOC_NAME, token: 'alice' });
  insertText(alice.view, paraEnd(alice.view, 'A closing paragraph'), ' g2payload');
  await new Promise((r) => setTimeout(r, waitBeforeKillMs));

  const preKillBytes = fs.statSync(dbPath).size;
  relay.proc.kill('SIGKILL'); // bypasses the SIGTERM handler entirely -- no flush, no graceful anything.
  await new Promise((r) => setTimeout(r, 200));
  const postKillBytes = fs.statSync(dbPath).size;

  relay = await startRelay({ port, db: dbPath, seeds: 'fixtures', debounce: DEBOUNCE, maxDebounce: MAX_DEBOUNCE });
  await alice.waitForSynced();
  const stillHasItLocally = alice.view.state.doc.textContent.includes('g2payload');

  const bob = await createLiveClient({ url: relay.wsUrl, docName: DOC_NAME, token: 'bob' });
  await waitUntil(() => bob.view.state.doc.textContent.includes('g2payload'), 5000).catch(() => {});
  const relayHasItAfterReconnect = bob.view.state.doc.textContent.includes('g2payload');

  alice.destroy();
  bob.destroy();
  await relay.stop();
  return {
    name: `G2. Hard kill (SIGKILL) ${waitBeforeKillMs < MAX_DEBOUNCE ? 'before' : 'after'} the store debounce`,
    pass: stillHasItLocally && relayHasItAfterReconnect,
    detail: `sqlite bytes: ${preKillBytes} -> ${postKillBytes} (before/after kill); alice's own memory retained it=${stillHasItLocally}; relay has it once alice's reconnect resynced it=${relayHasItAfterReconnect}`,
  };
}

// --- G3: edits made while the relay is down ---
async function runG3(port: number, dbPath: string): Promise<GateGCheck> {
  fs.rmSync(dbPath, { force: true });
  let relay = await startRelay({ port, db: dbPath, seeds: 'fixtures', debounce: DEBOUNCE, maxDebounce: MAX_DEBOUNCE });
  const alice = await createLiveClient({ url: relay.wsUrl, docName: DOC_NAME, token: 'alice' });
  const bob = await createLiveClient({ url: relay.wsUrl, docName: DOC_NAME, token: 'bob' });
  await new Promise((r) => setTimeout(r, MAX_DEBOUNCE + 300));

  await relay.stop(); // relay fully down; ports free.

  insertText(alice.view, paraEnd(alice.view, 'A closing paragraph'), ' g3alice');
  insertText(bob.view, paraEnd(bob.view, 'Some inline HTML'), ' g3bob');

  relay = await startRelay({ port, db: dbPath, seeds: 'fixtures', debounce: DEBOUNCE, maxDebounce: MAX_DEBOUNCE });
  await Promise.all([alice.waitForSynced(), bob.waitForSynced()]);
  await waitUntil(() => alice.view.state.doc.textContent.includes('g3bob') && bob.view.state.doc.textContent.includes('g3alice'), 8000);

  const relayBytes = await relay.fetchState(DOC_NAME);
  const relayDoc = decodeRelayState(relayBytes);
  const eq = checkEquality({ editor1: alice.view.state.doc, editor2: bob.view.state.doc, relay: relayDoc });

  alice.destroy();
  bob.destroy();
  await relay.stop();
  return {
    name: 'G3. Edits made while the relay is down converge once it restarts',
    pass: eq.equal,
    detail: eq.equal ? 'editor1, editor2 and the relay converge (semantic + serializeDoc equality)' : eq.reasons.join('; '),
  };
}

// --- G4: an editor that was offline during edits reconnects and converges ---
async function runG4(port: number, dbPath: string): Promise<GateGCheck> {
  fs.rmSync(dbPath, { force: true });
  const relay = await startRelay({ port, db: dbPath, seeds: 'fixtures', debounce: DEBOUNCE, maxDebounce: MAX_DEBOUNCE });
  const alice = await createLiveClient({ url: relay.wsUrl, docName: DOC_NAME, token: 'alice' });
  const bob = await createLiveClient({ url: relay.wsUrl, docName: DOC_NAME, token: 'bob' });
  await new Promise((r) => setTimeout(r, 300));

  bob.websocketProvider.disconnect();
  await new Promise((r) => setTimeout(r, 150));

  const paraNeedle = 'A closing paragraph';
  insertText(alice.view, paraEnd(alice.view, paraNeedle), ' fromAliceOnline');
  const bobParaStart = findPos(bob.view, (n) => n.type.name === 'paragraph' && n.textContent.includes(paraNeedle)) + 1;
  insertText(bob.view, bobParaStart, 'fromBobOffline ');

  const schema = alice.view.state.schema;
  const badgePosAlice = findPos(alice.view, (n) => n.type.name === 'image' && n.attrs.url === 'badge.svg');
  alice.view.dispatch(
    alice.view.state.tr
      .removeMark(badgePosAlice, badgePosAlice + 1, schema.marks.link)
      .addMark(badgePosAlice, badgePosAlice + 1, schema.marks.link.create({ href: 'https://from-alice.example' })),
  );
  const badgePosBob = findPos(bob.view, (n) => n.type.name === 'image' && n.attrs.url === 'badge.svg');
  bob.view.dispatch(
    bob.view.state.tr
      .removeMark(badgePosBob, badgePosBob + 1, schema.marks.link)
      .addMark(badgePosBob, badgePosBob + 1, schema.marks.link.create({ href: 'https://from-bob.example' })),
  );

  bob.websocketProvider.connect();
  await bob.waitForSynced();
  await waitUntil(
    () => JSON.stringify(alice.view.state.doc.toJSON()) === JSON.stringify(bob.view.state.doc.toJSON()),
    8000,
  );

  const relayBytes = await relay.fetchState(DOC_NAME);
  const relayDoc = decodeRelayState(relayBytes);
  const eq = checkEquality({ editor1: alice.view.state.doc, editor2: bob.view.state.doc, relay: relayDoc });

  const finalText = alice.view.state.doc.textContent;
  const bothInsertsSurvived = finalText.includes('fromAliceOnline') && finalText.includes('fromBobOffline');

  let finalHref = 'missing';
  alice.view.state.doc.descendants((n) => {
    if (n.type.name === 'image' && n.attrs.url === 'badge.svg') {
      finalHref = n.marks.find((m) => m.type.name === 'link')?.attrs.href ?? 'unlinked';
    }
  });
  const hrefIsOneOfTheTwo = finalHref === 'https://from-alice.example' || finalHref === 'https://from-bob.example';

  alice.destroy();
  bob.destroy();
  await relay.stop();
  return {
    name: 'G4. Offline editor reconnects and converges',
    pass: eq.equal && bothInsertsSurvived && hrefIsOneOfTheTwo,
    detail:
      `converge=${eq.equal}${eq.equal ? '' : ` (${eq.reasons.join('; ')})`}; ` +
      `both concurrent text insertions into the same paragraph survived (CRDT interleaves rather than drops): ${bothInsertsSurvived}; ` +
      `same-node link conflict (badge.svg, changed by both sides concurrently) resolved deterministically to one value, not corrupted or duplicated: ${finalHref} (${hrefIsOneOfTheTwo ? 'one of the two concurrent writes, as CRDT last-write-wins on a single attribute defines' : 'UNEXPECTED value'})`,
  };
}

export async function runGateG(opts: {
  ports: { g1: number; g2a: number; g2b: number; g3: number; g4: number };
  dbDir: string;
  quick?: boolean;
}): Promise<GateGResult> {
  const checks: GateGCheck[] = [];
  checks.push(await runG1(opts.ports.g1, `${opts.dbDir}/gateG1-hp.sqlite`));
  if (!opts.quick) {
    checks.push(await runG2Case(opts.ports.g2a, `${opts.dbDir}/gateG2a-hp.sqlite`, 50));
    checks.push(await runG2Case(opts.ports.g2b, `${opts.dbDir}/gateG2b-hp.sqlite`, MAX_DEBOUNCE + 300));
    checks.push(await runG3(opts.ports.g3, `${opts.dbDir}/gateG3-hp.sqlite`));
    checks.push(await runG4(opts.ports.g4, `${opts.dbDir}/gateG4-hp.sqlite`));
  }

  const pass = checks.every((c) => c.pass);
  return {
    pass,
    checks,
    detail: pass ? `all ${checks.length} scenario(s) passed${opts.quick ? ' (quick: G1 only)' : ''}` : checks.filter((c) => !c.pass).map((c) => `${c.name}: ${c.detail}`).join('; '),
  };
}
