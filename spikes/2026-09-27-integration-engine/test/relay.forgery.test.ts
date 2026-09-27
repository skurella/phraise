// Brief 04 task 3 / brief 06 task 1: "forged update rejected." Short unit
// version of gate B's forgery scenario, now covering both the general case
// (outside a recovery window: rejected, whatever the message type) and the
// documented residual (inside a recovery window: accepted and counted
// separately, never rejected -- see src/relay/forgery.ts's header comment
// and src/relay/README.md).
import 'global-jsdom/register';
import * as Y from 'yjs';
import { afterEach, expect, test } from 'vitest';
import { startRelayHarness, type RelayHarnessHandle } from '../src/testkit/relayHarness.js';
import { createLiveEditor, waitUntil, type LiveEditor } from '../src/testkit/editor.js';
import { insertText, findPos } from '../src/testkit/edits.js';
import { makeRemote, type Remote } from '../src/testkit/remote.js';
import { makeTempDir } from '../src/testkit/tmp.js';
import { makeDocName } from '../src/relay/index.js';

const BRANCH = 'main';
const PATH_MD = 'doc.md';
const FIXTURE = '# Doc\n\nParagraph Alpha ends here.\n';

let remote: Remote | undefined;
let relay: RelayHarnessHandle | undefined;
const editors: LiveEditor[] = [];

afterEach(async () => {
  for (const e of editors.splice(0)) e.destroy();
  if (relay) await relay.stop();
  if (remote) await remote.cleanup();
  relay = undefined;
  remote = undefined;
});

/**
 * Crafts a raw Yjs update that extends `clientId`'s own append-only clock
 * sequence with genuinely new structs, continuing from wherever
 * `knownState` (a full encoded state that already contains `clientId`'s
 * real history, e.g. `Y.encodeStateAsUpdate(mallory.ydoc)` once mallory has
 * synced alice's real edit) leaves off -- gate B's own forgery technique
 * (see gates/b.ts's header comment), the one the milestone-1 review found
 * a bypass for and this brief closes: clone the full state into a scratch
 * doc WITHOUT touching its own clientID first (so the clone's structs keep
 * their real ids/clocks), THEN reassign `clientID`, so the next local edit
 * gets a clock that is a genuine continuation of the victim's own sequence
 * -- not a colliding/duplicate range at clock 0, which is what a brand-new
 * `Y.Doc` reassigned to the victim's id produces, and which Yjs itself
 * silently discards as an already-known duplicate before this file's
 * `checkForgery` (or its escape hatches) ever come into it.
 */
function craftForgedUpdate(knownState: Uint8Array, clientId: number, text: string): Uint8Array {
  const scratch = new Y.Doc({ gc: false });
  Y.applyUpdate(scratch, knownState);
  scratch.clientID = clientId;
  let forged: Uint8Array | undefined;
  scratch.on('update', (u: Uint8Array) => {
    forged = u;
  });
  scratch.getText('forged-scratch').insert(0, text);
  if (!forged) throw new Error('craftForgedUpdate: no update produced');
  return forged;
}

test('outside a recovery window, a raw update forged under another user\'s clientID is rejected, not applied, and counted', async () => {
  // A short recovery window (default is 60s) so this test can wait past it
  // quickly instead of asserting the residual by accident.
  remote = await makeRemote({ branch: BRANCH, files: { [PATH_MD]: FIXTURE } });
  relay = await startRelayHarness({ remote: remote.url, dataDir: (await makeTempDir('phraise-t-forgery-')).path, timings: { recoveryWindowMs: 100 } });

  const docName = makeDocName(BRANCH, PATH_MD, 0);
  const alice = await createLiveEditor({ url: relay.wsUrl, docName, token: 'alice' });
  const mallory = await createLiveEditor({ url: relay.wsUrl, docName, token: 'mallory' });
  editors.push(alice, mallory);

  // alice must have an established mapping (in phraise-attribution) before the forgery attempt.
  const pos = findPos(alice.view, (n) => n.type.name === 'paragraph' && n.textContent.includes('Alpha'));
  const node = alice.view.state.doc.nodeAt(pos)!;
  insertText(alice.view, pos + node.nodeSize - 1, ' fromAlice');
  await waitUntil(() => mallory.view.state.doc.textContent.includes('fromAlice'), 5000);

  // Well past the 100ms recovery window opened when the document was first loaded.
  await new Promise((r) => setTimeout(r, 300));

  const before = (await (await fetch(`${relay.baseUrl}/health`)).json()) as { counters: { forgedRejections: number; relayedDuringRecovery: number } };
  const connectionsBefore = ((await (await fetch(`${relay.baseUrl}/connections?docName=${encodeURIComponent(docName)}`)).json()) as { count: number }).count;

  const forged = craftForgedUpdate(Y.encodeStateAsUpdate(mallory.ydoc), alice.ydoc.clientID, 'forged-by-mallory');
  Y.applyUpdate(mallory.ydoc, forged);
  await new Promise((r) => setTimeout(r, 300));

  const after = (await (await fetch(`${relay.baseUrl}/health`)).json()) as { counters: { forgedRejections: number; relayedDuringRecovery: number } };
  expect(after.counters.forgedRejections).toBe(before.counters.forgedRejections + 1);
  expect(after.counters.relayedDuringRecovery).toBe(before.counters.relayedDuringRecovery);

  const connectionsAfter = ((await (await fetch(`${relay.baseUrl}/connections?docName=${encodeURIComponent(docName)}`)).json()) as { count: number }).count;
  expect(connectionsAfter).toBe(connectionsBefore - 1); // the forger's connection is closed

  expect(alice.view.state.doc.textContent).not.toContain('forged-by-mallory');
});

test('inside a recovery window, a forged range is accepted (not rejected) and counted separately -- the documented residual', async () => {
  remote = await makeRemote({ branch: BRANCH, files: { [PATH_MD]: FIXTURE } });
  // Default recoveryWindowMs (60s): the document is still well inside its
  // window for the whole, fast duration of this test.
  relay = await startRelayHarness({ remote: remote.url, dataDir: (await makeTempDir('phraise-t-forgery-recovery-')).path });

  const docName = makeDocName(BRANCH, PATH_MD, 0);
  const alice = await createLiveEditor({ url: relay.wsUrl, docName, token: 'alice' });
  const mallory = await createLiveEditor({ url: relay.wsUrl, docName, token: 'mallory' });
  editors.push(alice, mallory);

  const pos = findPos(alice.view, (n) => n.type.name === 'paragraph' && n.textContent.includes('Alpha'));
  const node = alice.view.state.doc.nodeAt(pos)!;
  insertText(alice.view, pos + node.nodeSize - 1, ' fromAlice');
  await waitUntil(() => mallory.view.state.doc.textContent.includes('fromAlice'), 5000);
  await new Promise((r) => setTimeout(r, 100));

  const before = (await (await fetch(`${relay.baseUrl}/health`)).json()) as { counters: { forgedRejections: number; relayedDuringRecovery: number } };
  const connectionsBefore = ((await (await fetch(`${relay.baseUrl}/connections?docName=${encodeURIComponent(docName)}`)).json()) as { count: number }).count;

  const forged = craftForgedUpdate(Y.encodeStateAsUpdate(mallory.ydoc), alice.ydoc.clientID, 'forged-during-recovery');
  Y.applyUpdate(mallory.ydoc, forged);
  await new Promise((r) => setTimeout(r, 300));

  const after = (await (await fetch(`${relay.baseUrl}/health`)).json()) as { counters: { forgedRejections: number; relayedDuringRecovery: number } };
  expect(after.counters.forgedRejections).toBe(before.counters.forgedRejections);
  expect(after.counters.relayedDuringRecovery).toBe(before.counters.relayedDuringRecovery + 1);

  // Accepted, not rejected: mallory's connection stays open (contrast with
  // the previous test's "connection closed" outcome outside the window).
  const connectionsAfter = ((await (await fetch(`${relay.baseUrl}/connections?docName=${encodeURIComponent(docName)}`)).json()) as { count: number }).count;
  expect(connectionsAfter).toBe(connectionsBefore);

  // Applied: the relay's raw encoded state now decodes a 'forged-scratch'
  // top-level type with mallory's text in it (the same shared-type name
  // `craftForgedUpdate` inserts into; not part of the 'prosemirror'
  // fragment the live editors render, since a forged update under an
  // unrelated top-level type never touches the document itself -- only
  // the counters and the connection distinguish "accepted" from
  // "rejected" for this specific forging technique).
  const stateRes = await fetch(`${relay.baseUrl}/state/${encodeURIComponent(docName)}`);
  const scratch = new Y.Doc();
  Y.applyUpdate(scratch, new Uint8Array(await stateRes.arrayBuffer()));
  expect(scratch.getText('forged-scratch').toString()).toBe('forged-during-recovery');
});
