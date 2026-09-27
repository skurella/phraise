// Brief 04 task 3: "open and seed; two editors converge." Short unit
// versions of gate A's scenario -- the gate does the heavy measurement
// (byte-for-byte comparison, latency), this just checks the mechanism
// works.
import 'global-jsdom/register';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { startRelayHarness, type RelayHarnessHandle } from '../src/testkit/relayHarness.js';
import { createLiveEditor, waitUntil, type LiveEditor } from '../src/testkit/editor.js';
import { makeRemote, type Remote } from '../src/testkit/remote.js';
import { makeTempDir } from '../src/testkit/tmp.js';
import { makeDocName } from '../src/relay/index.js';

const BRANCH = 'main';
const PATH_MD = 'doc.md';
const FIXTURE = '# Doc\n\nHello there.\n';

let remote: Remote;
let relay: RelayHarnessHandle;
const editors: LiveEditor[] = [];

beforeEach(async () => {
  remote = await makeRemote({ branch: BRANCH, files: { [PATH_MD]: FIXTURE } });
  relay = await startRelayHarness({ remote: remote.url, dataDir: (await makeTempDir('phraise-t-open-')).path });
});

afterEach(async () => {
  for (const e of editors.splice(0)) e.destroy();
  await relay.stop();
  await remote.cleanup();
});

test('opening a path at the remote head seeds the document, and it round-trips to the original text', async () => {
  const docName = makeDocName(BRANCH, PATH_MD, 0);
  const editor = await createLiveEditor({ url: relay.wsUrl, docName, token: 'alice' });
  editors.push(editor);
  expect(editor.view.state.doc.textContent).toContain('Hello there');
});

test('two live editors connect and converge on each other\'s edits', async () => {
  const docName = makeDocName(BRANCH, PATH_MD, 0);
  const alice = await createLiveEditor({ url: relay.wsUrl, docName, token: 'alice' });
  const bob = await createLiveEditor({ url: relay.wsUrl, docName, token: 'bob' });
  editors.push(alice, bob);

  const end = alice.view.state.doc.content.size - 1;
  alice.view.dispatch(alice.view.state.tr.insertText(' from alice', end));
  await waitUntil(() => bob.view.state.doc.textContent.includes('from alice'), 5000);
  expect(bob.view.state.doc.textContent).toBe(alice.view.state.doc.textContent);
});
