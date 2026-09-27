// Brief 06 task 4: "A document restored from a draft whose base is behind
// the branch head is restored and then rebased to the head in the same
// open; the draft is never silently dropped." Unit test for
// src/relay/seeding.ts's `seedOrRestore`, exercised through a real relay
// (not called directly), matching this file's sibling tests' style.
import 'global-jsdom/register';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { startRelayHarness, type RelayHarnessHandle } from '../src/testkit/relayHarness.js';
import { createLiveEditor, waitUntil, type LiveEditor } from '../src/testkit/editor.js';
import { insertText, findPos } from '../src/testkit/edits.js';
import { makeRemote, makeClone, type Remote } from '../src/testkit/remote.js';
import { makeTempDir } from '../src/testkit/tmp.js';
import { GitStore } from '../src/git/index.js';
import { makeDocName } from '../src/relay/index.js';
import { getBase } from '../src/engine/index.js';

async function postJSON(baseUrl: string, path: string, body: unknown) {
  const res = await fetch(`${baseUrl}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}

const BRANCH = 'main';
const PATH_MD = 'doc.md';
const FIXTURE = '# Doc\n\nParagraph Alpha ends here.\n\nParagraph Beta ends here.\n';

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

test('a restore whose draft is behind the head rebases forward in the same open, without dropping the draft', async () => {
  const docName = makeDocName(BRANCH, PATH_MD, 0);

  // 1. relay1: alice edits an untouched-by-the-external-commit paragraph and the relay flushes a draft based on the ORIGINAL head.
  const dataDir1 = (await makeTempDir('phraise-t-restore-behind-1-')).path;
  const relay1 = await startRelayHarness({ remote: remote.url, dataDir: dataDir1 });
  relays.push(relay1);

  const alice = await createLiveEditor({ url: relay1.wsUrl, docName, token: 'alice' });
  editors.push(alice);
  const posA = findPos(alice.view, (n) => n.type.name === 'paragraph' && n.textContent.includes('Alpha'));
  const nodeA = alice.view.state.doc.nodeAt(posA)!;
  insertText(alice.view, posA + nodeA.nodeSize - 1, ' ALICE-DRAFT-EDIT');
  await waitUntil(() => alice.view.state.doc.textContent.includes('ALICE-DRAFT-EDIT'), 5000);
  await new Promise((r) => setTimeout(r, 100));

  const flush = await postJSON(relay1.baseUrl, '/flush', { branch: BRANCH });
  expect((flush.body as { ok: boolean }).ok).toBe(true);

  const verify = new GitStore({ cacheDir: (await makeTempDir('phraise-t-restore-behind-verify-')).path, remoteUrl: remote.url });
  await verify.init();
  const originalHead = await verify.remoteHead(BRANCH);
  const draftBeforeExternalCommit = await verify.readDraft(BRANCH);
  expect(draftBeforeExternalCommit?.base).toBe(originalHead);
  expect(draftBeforeExternalCommit?.files[PATH_MD]).toContain('ALICE-DRAFT-EDIT');

  await relay1.stop(); // this relay's own local (in-process, in-memory + SQLite) state goes away with it

  // 2. Someone else commits and pushes, moving the branch head PAST the draft's base -- the draft (relay1's dataDir1 is gone) is now the only place alice's uncommitted edit lives.
  const other = await makeClone(remote.url, { branch: BRANCH });
  await other.write(PATH_MD, `${FIXTURE}\n\nEXTERNAL-COMMIT-ADDITION.\n`);
  const externalCommit = await other.commitAndPush('external commit while relay1 was down');
  await other.cleanup();
  expect(externalCommit).not.toBe(originalHead);

  // 3. relay2: a FRESH data dir (no SQLite state for this document at all), same remote. Opening the document must restore alice's draft, not silently seed fresh from the new head and drop it.
  const dataDir2 = (await makeTempDir('phraise-t-restore-behind-2-')).path;
  const relay2 = await startRelayHarness({ remote: remote.url, dataDir: dataDir2 });
  relays.push(relay2);

  const carol = await createLiveEditor({ url: relay2.wsUrl, docName, token: 'carol' });
  editors.push(carol);
  await waitUntil(() => carol.view.state.doc.textContent.length > 0, 5000);
  await waitUntil(() => carol.view.state.doc.textContent.includes('ALICE-DRAFT-EDIT'), 5000);
  await waitUntil(() => carol.view.state.doc.textContent.includes('EXTERNAL-COMMIT-ADDITION'), 5000);

  // The draft was never dropped: alice's uncommitted edit is present...
  expect(carol.view.state.doc.textContent).toContain('ALICE-DRAFT-EDIT');
  // ... and rebased forward: the external commit's own change is ALSO present in the same document...
  expect(carol.view.state.doc.textContent).toContain('EXTERNAL-COMMIT-ADDITION');
  // ... and the untouched paragraph (Beta) is unaffected.
  expect(carol.view.state.doc.textContent).toContain('Paragraph Beta ends here.');

  // The restored document's own base pointer now points at the NEW head (rebased "in the same open", not left pointing at the stale draft base).
  const openEntry = relay2.state?.branchState(BRANCH).open.get(PATH_MD);
  expect(openEntry).toBeDefined();
  const base = getBase(openEntry!.doc);
  expect(base?.commit).toBe(externalCommit);
});
