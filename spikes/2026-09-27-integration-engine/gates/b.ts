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
  const checks: { name: string; pass: boolean; detail: string }[] = [];

  try {
    remote = await makeRemote({ branch: BRANCH, files: { [PATH_MD]: FIXTURE } });
    const dataDir = (await makeTempDir('phraise-gateB-relay-')).path;
    relay = await startRelayHarness({ remote: remote.url, dataDir });
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

    const pass = checks.every((c) => c.pass);
    return {
      gate: 'B',
      pass,
      summary: pass ? `all ${checks.length} checks passed` : checks.filter((c) => !c.pass).map((c) => `${c.name}: ${c.detail}`).join('; '),
      numbers: { checks: checks.length, forgedRejections: afterHealth.counters.forgedRejections },
    };
  } finally {
    alice?.destroy();
    bob?.destroy();
    mallory?.destroy();
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
