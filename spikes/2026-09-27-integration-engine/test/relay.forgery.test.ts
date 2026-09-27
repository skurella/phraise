// Brief 04 task 3: "forged update rejected." Short unit version of gate B's
// forgery scenario.
import 'global-jsdom/register';
import * as Y from 'yjs';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { startRelayHarness, type RelayHarnessHandle } from '../src/testkit/relayHarness.js';
import { createLiveEditor, waitUntil, type LiveEditor } from '../src/testkit/editor.js';
import { insertText, findPos } from '../src/testkit/edits.js';
import { makeRemote, type Remote } from '../src/testkit/remote.js';
import { makeTempDir } from '../src/testkit/tmp.js';
import { makeDocName } from '../src/relay/index.js';

const BRANCH = 'main';
const PATH_MD = 'doc.md';
const FIXTURE = '# Doc\n\nParagraph Alpha ends here.\n';

let remote: Remote;
let relay: RelayHarnessHandle;
const editors: LiveEditor[] = [];

beforeEach(async () => {
  remote = await makeRemote({ branch: BRANCH, files: { [PATH_MD]: FIXTURE } });
  relay = await startRelayHarness({ remote: remote.url, dataDir: (await makeTempDir('phraise-t-forgery-')).path });
});

afterEach(async () => {
  for (const e of editors.splice(0)) e.destroy();
  await relay.stop();
  await remote.cleanup();
});

test('a raw update forged under another user\'s clientID is rejected, not applied, and counted', async () => {
  const docName = makeDocName(BRANCH, PATH_MD, 0);
  const alice = await createLiveEditor({ url: relay.wsUrl, docName, token: 'alice' });
  const mallory = await createLiveEditor({ url: relay.wsUrl, docName, token: 'mallory' });
  editors.push(alice, mallory);

  // alice must have an established mapping (in phraise-attribution) before the forgery attempt.
  const pos = findPos(alice.view, (n) => n.type.name === 'paragraph' && n.textContent.includes('Alpha'));
  const node = alice.view.state.doc.nodeAt(pos)!;
  insertText(alice.view, pos + node.nodeSize - 1, ' fromAlice');
  await waitUntil(() => mallory.view.state.doc.textContent.includes('fromAlice'), 5000);
  await new Promise((r) => setTimeout(r, 150));

  const before = (await (await fetch(`${relay.baseUrl}/health`)).json()) as { counters: { forgedRejections: number } };

  const aliceClientId = alice.ydoc.clientID;
  const fake = new Y.Doc();
  fake.clientID = aliceClientId;
  let forged: Uint8Array | undefined;
  fake.on('update', (u: Uint8Array) => {
    forged = u;
  });
  fake.getText('forged-scratch').insert(0, 'forged-by-mallory');
  Y.applyUpdate(mallory.ydoc, forged!);
  await new Promise((r) => setTimeout(r, 300));

  const after = (await (await fetch(`${relay.baseUrl}/health`)).json()) as { counters: { forgedRejections: number } };
  expect(after.counters.forgedRejections).toBe(before.counters.forgedRejections + 1);

  expect(alice.view.state.doc.textContent).not.toContain('forged-by-mallory');

  const stateRes = await fetch(`${relay.baseUrl}/state/${encodeURIComponent(docName)}`);
  const scratch = new Y.Doc();
  Y.applyUpdate(scratch, new Uint8Array(await stateRes.arrayBuffer()));
  expect(scratch.getXmlFragment('prosemirror').toString()).not.toContain('forged-by-mallory');
});
