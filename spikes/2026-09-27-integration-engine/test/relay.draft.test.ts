// Brief 04 task 3: "flush then restore after deleting the relay's data
// dir; lease rejection path." Short unit versions of gate D's scenarios.
import 'global-jsdom/register';
import { rm } from 'node:fs/promises';
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
const FIXTURE = '# Doc\n\nParagraph Alpha ends here.\n';

async function postJSON(baseUrl: string, path: string, body: unknown) {
  const res = await fetch(`${baseUrl}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}

let remote: Remote;
const editors: LiveEditor[] = [];
const relays: RelayHarnessHandle[] = [];

beforeEach(async () => {
  remote = await makeRemote({ branch: BRANCH, files: { [PATH_MD]: FIXTURE } });
});

afterEach(async () => {
  for (const e of editors.splice(0)) e.destroy();
  for (const r of relays.splice(0)) await r.stop();
  await remote.cleanup();
});

test('flush writes the draft ref; a relay restarted with its data dir deleted restores the document from it', async () => {
  const docName = makeDocName(BRANCH, PATH_MD, 0);
  const dataDir = (await makeTempDir('phraise-t-draft-')).path;
  const relay1 = await startRelayHarness({ remote: remote.url, dataDir });
  relays.push(relay1);

  const alice = await createLiveEditor({ url: relay1.wsUrl, docName, token: 'alice' });
  editors.push(alice);
  const pos = findPos(alice.view, (n) => n.type.name === 'paragraph' && n.textContent.includes('Alpha'));
  const node = alice.view.state.doc.nodeAt(pos)!;
  insertText(alice.view, pos + node.nodeSize - 1, ' edited.');
  await waitUntil(() => alice.view.state.doc.textContent.includes('edited.'), 5000);
  await new Promise((r) => setTimeout(r, 100));

  const flush = await postJSON(relay1.baseUrl, '/flush', { branch: BRANCH });
  expect(flush.body.ok).toBe(true);
  expect(typeof flush.body.commit).toBe('string');

  const cache = new GitStore({ cacheDir: (await makeTempDir('phraise-t-draft-verify-')).path, remoteUrl: remote.url });
  await cache.init();
  const draft = await cache.readDraft(BRANCH);
  expect(draft?.files[PATH_MD]).toContain('edited.');

  const textBefore = alice.view.state.doc.textContent;
  await relay1.stop();
  await rm(dataDir, { recursive: true, force: true });

  const relay2 = await startRelayHarness({ remote: remote.url, dataDir });
  relays.push(relay2);
  const bob = await createLiveEditor({ url: relay2.wsUrl, docName, token: 'bob' });
  editors.push(bob);
  await waitUntil(() => bob.view.state.doc.textContent.length > 0, 5000);
  expect(bob.view.state.doc.textContent).toBe(textBefore);
});

test('a stale flush (lease rejection) is counted and does not blindly overwrite', async () => {
  const docName = makeDocName(BRANCH, PATH_MD, 0);
  const dataDir = (await makeTempDir('phraise-t-lease-')).path;
  const relay = await startRelayHarness({ remote: remote.url, dataDir });
  relays.push(relay);

  const alice = await createLiveEditor({ url: relay.wsUrl, docName, token: 'alice' });
  editors.push(alice);
  const pos = findPos(alice.view, (n) => n.type.name === 'paragraph' && n.textContent.includes('Alpha'));
  const node = alice.view.state.doc.nodeAt(pos)!;
  insertText(alice.view, pos + node.nodeSize - 1, ' one.');
  await waitUntil(() => alice.view.state.doc.textContent.includes('one.'), 5000);
  await new Promise((r) => setTimeout(r, 100));
  const first = await postJSON(relay.baseUrl, '/flush', { branch: BRANCH });
  expect(first.body.ok).toBe(true);

  // A competing writer (e.g. a second relay serving the same document) moves the draft ref out from under this relay's own belief about it.
  const competing = new GitStore({ cacheDir: (await makeTempDir('phraise-t-lease-competing-')).path, remoteUrl: remote.url });
  await competing.init();
  const current = await competing.readDraft(BRANCH);
  expect(current).not.toBeNull();
  const write = await competing.writeDraft({
    branch: BRANCH,
    base: current!.base,
    files: { ...current!.files, [PATH_MD]: `${current!.files[PATH_MD]}\n\nCompeting.\n` },
    sidecar: current!.sidecar,
    expected: current!.commit,
  });
  expect(write.ok).toBe(true);

  const before = (await (await fetch(`${relay.baseUrl}/health`)).json()) as { counters: { staleFlushes: number } };
  const second = await postJSON(relay.baseUrl, '/flush', { branch: BRANCH });
  const after = (await (await fetch(`${relay.baseUrl}/health`)).json()) as { counters: { staleFlushes: number } };

  expect(after.counters.staleFlushes).toBe(before.counters.staleFlushes + 1);
  expect(second.body.ok).toBe(true);
  expect(second.body.merged).toBe(true);
});
