// Brief 04 task 3: "commit with trailers." Short unit version of gate E1.
import 'global-jsdom/register';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { startRelayHarness, type RelayHarnessHandle } from '../src/testkit/relayHarness.js';
import { createLiveEditor, waitUntil, type LiveEditor } from '../src/testkit/editor.js';
import { insertText, findPos } from '../src/testkit/edits.js';
import { makeRemote, type Remote } from '../src/testkit/remote.js';
import { makeTempDir } from '../src/testkit/tmp.js';
import { GitStore } from '../src/git/index.js';
import { makeDocName } from '../src/relay/index.js';

const BRANCH = 'main';
const PATH_MD = 'doc.md';
const FIXTURE = '# Doc\n\nParagraph Alpha ends here.\n\nParagraph Beta ends here.\n';

async function postJSON(baseUrl: string, path: string, body: unknown) {
  const res = await fetch(`${baseUrl}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}

let remote: Remote;
let relay: RelayHarnessHandle;
const editors: LiveEditor[] = [];

beforeEach(async () => {
  remote = await makeRemote({ branch: BRANCH, files: { [PATH_MD]: FIXTURE } });
  relay = await startRelayHarness({ remote: remote.url, dataDir: (await makeTempDir('phraise-t-commit-')).path });
});

afterEach(async () => {
  for (const e of editors.splice(0)) e.destroy();
  await relay.stop();
  await remote.cleanup();
});

test('commit writes the serialized text with a Co-authored-by trailer for every other editor since the last commit', async () => {
  const docName = makeDocName(BRANCH, PATH_MD, 0);
  const alice = await createLiveEditor({ url: relay.wsUrl, docName, token: 'alice' });
  const bob = await createLiveEditor({ url: relay.wsUrl, docName, token: 'bob' });
  editors.push(alice, bob);

  const posA = findPos(alice.view, (n) => n.type.name === 'paragraph' && n.textContent.includes('Alpha'));
  const nodeA = alice.view.state.doc.nodeAt(posA)!;
  insertText(alice.view, posA + nodeA.nodeSize - 1, ' fromAlice');
  await waitUntil(() => bob.view.state.doc.textContent.includes('fromAlice'), 5000);
  const posB = findPos(bob.view, (n) => n.type.name === 'paragraph' && n.textContent.includes('Beta'));
  const nodeB = bob.view.state.doc.nodeAt(posB)!;
  insertText(bob.view, posB + nodeB.nodeSize - 1, ' fromBob');
  await waitUntil(() => alice.view.state.doc.textContent.includes('fromBob'), 5000);
  await new Promise((r) => setTimeout(r, 100));

  const result = await postJSON(relay.baseUrl, '/commit', { branch: BRANCH, path: PATH_MD, user: 'alice', message: 'Edit the document' });
  expect(result.status).toBe(200);
  expect(result.body.ok).toBe(true);

  const cache = new GitStore({ cacheDir: (await makeTempDir('phraise-t-commit-verify-')).path, remoteUrl: remote.url });
  await cache.init();
  await cache.fetch(BRANCH);
  const info = await cache.commitInfo(result.body.commit);
  expect(info.author.name).toBe('alice');
  expect(info.message).toContain('Co-authored-by: bob <bob@users.phraise.test>');
  expect(info.message).not.toContain('Co-authored-by: alice');
  const text = await cache.readFile(result.body.commit, PATH_MD);
  expect(text).toContain('fromAlice');
  expect(text).toContain('fromBob');
});
