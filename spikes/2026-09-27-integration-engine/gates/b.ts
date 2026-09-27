// Gate B (charter milestone 1): "Both edit. Ranges are listed per user. A
// forged client identity is rejected by the relay before the update is
// applied." Forgery technique ported from spike 5
// (collab-stack-yjs13-hocuspocus, branch spike/2026-09-27-collab-stack,
// commit eeb3fe2, `gates/gateE.ts`'s "Collision" section, and that file's
// own comment on why a second real client forced to the victim's clientID
// does NOT work as a forgery test): a forged update has to be injected as
// raw Yjs update bytes through an already-synced, already-authenticated
// connection -- what an attacker crafting protocol messages (not a polite
// client library) would do. A second HocuspocusProvider merely forced to
// alice's clientID does not reach the relay's forgery check at all: Yjs's
// OWN client-side defense reassigns a doc's clientID the moment it
// receives a remote update under an ID matching its own, which happens
// during that second client's very first sync step, before it could ever
// send anything.
//
// This file imports `yjs` directly (only `src/**` is scanned by the
// import-boundary test; gates are allowed to reach for the raw protocol to
// construct an attack, same as spike 5's own gate did).
import 'global-jsdom/register';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import { writeSyncStep2 } from 'y-protocols/sync';
import { MessageType } from '@hocuspocus/provider';
import { startRelayHarness, type RelayHarnessHandle } from '../src/testkit/relayHarness.js';
import { createLiveEditor, waitUntil, type LiveEditor } from '../src/testkit/editor.js';
import { insertText, findPos } from '../src/testkit/edits.js';
import { makeRemote, type Remote } from '../src/testkit/remote.js';
import { makeTempDir } from '../src/testkit/tmp.js';
import { makeDocName } from '../src/relay/index.js';
import { listAttribution } from '../src/engine/index.js';

export interface GateBResult {
  gate: 'B';
  pass: boolean;
  summary: string;
  numbers: Record<string, number>;
}

const BRANCH = 'main';
const PATH_MD = 'doc.md';
const FIXTURE = '# Live document\n\nParagraph Alpha ends here.\n\nParagraph Beta ends here.\n';

function paraPos(view: import('prosemirror-view').EditorView, needle: string): number {
  const pos = findPos(view, (n) => n.type.name === 'paragraph' && n.textContent.includes(needle));
  if (pos === -1) throw new Error(`gate B: paragraph containing ${JSON.stringify(needle)} not found`);
  const node = view.state.doc.nodeAt(pos)!;
  return pos + node.nodeSize - 1;
}

export async function run(_opts: { quick?: boolean } = {}): Promise<GateBResult> {
  let remote: Remote | undefined;
  let relay: RelayHarnessHandle | undefined;
  let alice: LiveEditor | undefined;
  let bob: LiveEditor | undefined;
  let mallory: LiveEditor | undefined;
  let mallory2: LiveEditor | undefined;
  const checks: { name: string; pass: boolean; detail: string }[] = [];

  try {
    remote = await makeRemote({ branch: BRANCH, files: { [PATH_MD]: FIXTURE } });
    const dataDir = (await makeTempDir('phraise-gateB-relay-')).path;
    // A short recovery window (brief 06 task 1's default is 60s), so this
    // gate's forgery attempts -- run well under a second after the
    // document is first seeded -- exercise the general "outside a recovery
    // window" rejection path, not the documented recovery-window residual
    // (see test/relay.forgery.test.ts for that case on its own).
    relay = await startRelayHarness({ remote: remote.url, dataDir, timings: { recoveryWindowMs: 100 } });
    const docName = makeDocName(BRANCH, PATH_MD, 0);

    alice = await createLiveEditor({ url: relay.wsUrl, docName, token: 'alice' });
    bob = await createLiveEditor({ url: relay.wsUrl, docName, token: 'bob' });

    // --- both edit, in different paragraphs ---
    const posA = paraPos(alice.view, 'Paragraph Alpha');
    insertText(alice.view, posA, ' fromAlice');
    await waitUntil(() => bob!.view.state.doc.textContent.includes('fromAlice'), 5000);

    const posB = paraPos(bob.view, 'Paragraph Beta');
    insertText(bob.view, posB, ' fromBob');
    await waitUntil(() => alice!.view.state.doc.textContent.includes('fromBob'), 5000);
    await new Promise((r) => setTimeout(r, 200)); // let the last onChange (attribution recording) settle

    const converged = alice.view.state.doc.textContent === bob.view.state.doc.textContent;
    checks.push({ name: 'both editors converge on each other\'s edit', pass: converged, detail: alice.view.state.doc.textContent });

    // --- listAttribution lists each user's typed text under that user ---
    const ranges = listAttribution(alice.ydoc);
    const aliceRanges = ranges.filter((r) => r.user === 'alice').map((r) => r.text).join('');
    const bobRanges = ranges.filter((r) => r.user === 'bob').map((r) => r.text).join('');
    const attributionOk = aliceRanges.includes('fromAlice') && bobRanges.includes('fromBob');
    checks.push({
      name: 'listAttribution lists each user\'s typed text under that user',
      pass: attributionOk,
      detail: `alice="${aliceRanges}" bob="${bobRanges}"`,
    });

    // Past the 100ms recovery window opened when the document was first seeded.
    await new Promise((r) => setTimeout(r, 200));

    // --- forged update: mallory crafts a raw update under alice's real clientID ---
    const aliceClientIdAtForgeryTime = alice.ydoc.clientID;
    mallory = await createLiveEditor({ url: relay.wsUrl, docName, token: 'mallory' });
    const fake = new Y.Doc();
    fake.clientID = aliceClientIdAtForgeryTime;
    let forged: Uint8Array | undefined;
    fake.on('update', (u: Uint8Array) => {
      forged = u;
    });
    fake.getText('forged-scratch').insert(0, 'forged-by-mallory');
    const beforeHealthRes = await fetch(`${relay.baseUrl}/health`);
    const beforeHealth = (await beforeHealthRes.json()) as { counters: { forgedRejections: number } };
    const connectionsBeforeRes = await fetch(`${relay.baseUrl}/connections?docName=${encodeURIComponent(docName)}`);
    const connectionsBefore = ((await connectionsBeforeRes.json()) as { count: number }).count;

    // mallory's own connection forwards this to the relay as an ordinary local change.
    Y.applyUpdate(mallory.ydoc, forged!);
    // Checked promptly, before the provider's own reconnect logic has a
    // chance to open a fresh (unblocked) connection for the same client --
    // the server-side removal happens synchronously in the same tick as
    // the rejection, well within this window.
    await new Promise((r) => setTimeout(r, 100));
    const connectionsRightAfterRes = await fetch(`${relay.baseUrl}/connections?docName=${encodeURIComponent(docName)}`);
    const connectionsRightAfter = ((await connectionsRightAfterRes.json()) as { count: number }).count;
    await new Promise((r) => setTimeout(r, 300));

    const afterHealthRes = await fetch(`${relay.baseUrl}/health`);
    const afterHealth = (await afterHealthRes.json()) as { counters: { forgedRejections: number } };
    const rejectionCounterIsOne = afterHealth.counters.forgedRejections - beforeHealth.counters.forgedRejections === 1;
    checks.push({
      name: 'rejection counter increased by exactly 1',
      pass: rejectionCounterIsOne,
      detail: `before=${beforeHealth.counters.forgedRejections} after=${afterHealth.counters.forgedRejections}`,
    });

    const relayStateRes = await fetch(`${relay.baseUrl}/state/${encodeURIComponent(docName)}`);
    const relayBytes = new Uint8Array(await relayStateRes.arrayBuffer());
    const scratch = new Y.Doc();
    Y.applyUpdate(scratch, relayBytes);
    const relayText = scratch.getXmlFragment('prosemirror').toString();
    const forgeryAbsentFromRelay = !relayText.includes('forged-by-mallory');
    checks.push({ name: 'the relay\'s document never contains the forged text', pass: forgeryAbsentFromRelay, detail: relayText.slice(0, 80) });

    const forgeryAbsentFromVictim = !alice.view.state.doc.textContent.includes('forged-by-mallory');
    checks.push({ name: 'the victim\'s document never contains the forged text', pass: forgeryAbsentFromVictim, detail: alice.view.state.doc.textContent });

    // mallory's connection should have been removed from the document by the relay.
    const connectionDropped = connectionsRightAfter === connectionsBefore - 1;
    checks.push({
      name: 'the forger\'s connection is closed',
      pass: connectionDropped,
      detail: `connections before=${connectionsBefore} right after=${connectionsRightAfter}`,
    });

    // --- brief 06 task 1: the reviewer's attack (milestone-1 review,
    // "gate B: the check is real for the attack it tests, but ..."). The
    // OLD version of checkForgery only ran for messages tagged SYNC_UPDATE
    // (type 2); @hocuspocus/server and y-protocols/sync route a
    // SYNC_STEP2-tagged message (type 1) through the exact same
    // Y.applyUpdate + broadcast path, and nothing stops an
    // already-authenticated connection from sending one at any time, not
    // just as a first message. This crafts exactly that: a raw, hand-built
    // SyncStep2 wire message (lib0/encoding + y-protocols/sync's own
    // `writeSyncStep2`, mirroring `@hocuspocus/provider`'s internal
    // `SyncStepTwoMessage`) carrying a genuine clock EXTENSION of alice's
    // real clientID (continuing from a clone of her own current state, not
    // a colliding brand-new-doc range at clock 0 -- see
    // test/relay.forgery.test.ts's `craftForgedUpdate` for why that
    // distinction matters), sent over a fresh, already-authenticated
    // connection's raw websocket. Brief 06 closes this: checkForgery now
    // runs for SYNC_STEP2 too, so this is rejected exactly like the
    // SYNC_UPDATE attack above -- counted, connection closed, victim and
    // relay unaffected.
    mallory2 = await createLiveEditor({ url: relay.wsUrl, docName, token: 'mallory2' });

    const scratch2 = new Y.Doc({ gc: false });
    Y.applyUpdate(scratch2, Y.encodeStateAsUpdate(alice.ydoc)); // clone alice's own current state first, WITHOUT touching scratch2's own clientID yet
    scratch2.clientID = aliceClientIdAtForgeryTime; // now genuinely continue her sequence
    scratch2.getText('forged-scratch-2').insert(0, 'forged-via-syncstep2');

    const beforeHealth2 = (await (await fetch(`${relay.baseUrl}/health`)).json()) as { counters: { forgedRejections: number } };
    const connectionsBefore2 = ((await (await fetch(`${relay.baseUrl}/connections?docName=${encodeURIComponent(docName)}`)).json()) as { count: number }).count;

    const encoder = encoding.createEncoder();
    encoding.writeVarString(encoder, docName);
    encoding.writeVarUint(encoder, MessageType.Sync);
    writeSyncStep2(encoder, scratch2); // messageYjsSyncStep2 (type 1) + scratch2's full state, including the forged extension
    mallory2.websocketProvider.webSocket!.send(encoding.toUint8Array(encoder));

    await new Promise((r) => setTimeout(r, 300));

    const afterHealth2 = (await (await fetch(`${relay.baseUrl}/health`)).json()) as { counters: { forgedRejections: number } };
    checks.push({
      name: "reviewer's attack (raw SyncStep2 message): rejection counter increased by exactly 1",
      pass: afterHealth2.counters.forgedRejections - beforeHealth2.counters.forgedRejections === 1,
      detail: `before=${beforeHealth2.counters.forgedRejections} after=${afterHealth2.counters.forgedRejections}`,
    });

    const connectionsAfter2 = ((await (await fetch(`${relay.baseUrl}/connections?docName=${encodeURIComponent(docName)}`)).json()) as { count: number }).count;
    checks.push({
      name: "reviewer's attack: the forger's connection is closed",
      pass: connectionsAfter2 === connectionsBefore2 - 1,
      detail: `before=${connectionsBefore2} after=${connectionsAfter2}`,
    });

    const relayStateRes2 = await fetch(`${relay.baseUrl}/state/${encodeURIComponent(docName)}`);
    const scratchCheck2 = new Y.Doc();
    Y.applyUpdate(scratchCheck2, new Uint8Array(await relayStateRes2.arrayBuffer()));
    checks.push({
      name: 'reviewer\'s attack: the relay is unaffected (never applied the forged extension)',
      pass: scratchCheck2.getText('forged-scratch-2').toString() === '',
      detail: JSON.stringify(scratchCheck2.getText('forged-scratch-2').toString()),
    });
    checks.push({
      name: "reviewer's attack: the victim (alice) is unaffected",
      pass: !alice.view.state.doc.textContent.includes('forged-via-syncstep2'),
      detail: alice.view.state.doc.textContent,
    });

    const pass = checks.every((c) => c.pass);
    return {
      gate: 'B',
      pass,
      summary: pass ? `all ${checks.length} checks passed` : checks.filter((c) => !c.pass).map((c) => `${c.name}: ${c.detail}`).join('; '),
      numbers: { checks: checks.length, forgedRejections: afterHealth2.counters.forgedRejections },
    };
  } finally {
    alice?.destroy();
    bob?.destroy();
    mallory?.destroy();
    mallory2?.destroy();
    if (relay) await relay.stop();
    if (remote) await remote.cleanup();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run({ quick: process.argv.includes('--quick') }).then((r) => {
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.pass ? 0 : 1);
  });
}
