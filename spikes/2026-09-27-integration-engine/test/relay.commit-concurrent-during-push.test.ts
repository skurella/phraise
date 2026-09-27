// Brief 09 defect 1, relay-level test: `testHooks.afterPrepareCommit` (a
// callback awaited between `engine.prepareCommit` and the real git push,
// `src/relay/commit.ts`) lets this test make bob's live editor edit land on
// the relay's shared document during exactly that window -- reproducing,
// through the real WebSocket/Hocuspocus/git stack, the same defect
// test/engine.commit-concurrent-during-push.test.ts exercises directly at
// the engine level.
import 'global-jsdom/register';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { startRelayHarness, type RelayHarnessHandle } from '../src/testkit/relayHarness.js';
import { createLiveEditor, waitUntil, type LiveEditor } from '../src/testkit/editor.js';
import { insertText, findPos } from '../src/testkit/edits.js';
import { makeRemote, makeClone, type Remote } from '../src/testkit/remote.js';
import { makeTempDir } from '../src/testkit/tmp.js';
import { GitStore } from '../src/git/index.js';
import { makeDocName } from '../src/relay/index.js';
import { read } from '../src/crdt/index.js';
import { editorsSinceCommit, listReview } from '../src/engine/index.js';
import { makeToken, tokensIn } from '../src/testkit/tokens.js';

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
});

afterEach(async () => {
  for (const e of editors.splice(0)) e.destroy();
  await relay.stop();
  await remote.cleanup();
});

test('an edit landing during a commit`s push is excluded from that commit but survives a later external-commit rebase, is flagged, and credits its author on the next commit', async () => {
  const bobToken = makeToken('bob-during-push');
  let bobEditApplied = false;

  relay = await startRelayHarness({
    remote: remote.url,
    dataDir: (await makeTempDir('phraise-t-commit-race-')).path,
    testHooks: {
      afterPrepareCommit: async () => {
        // Bob's edit lands on the relay's shared doc in the window between
        // prepareCommit (which already rendered/snapshotted the OLD
        // content) and the git push -- exactly the race defect 1 fixes.
        const posB = findPos(bob.view, (n) => n.type.name === 'paragraph' && n.textContent.includes('Beta'));
        const nodeB = bob.view.state.doc.nodeAt(posB)!;
        insertText(bob.view, posB + nodeB.nodeSize - 1, ` ${bobToken}`);
        bobEditApplied = true;
        await waitUntil(() => {
          const openEntry = relay.state?.branchState(BRANCH).open.get(PATH_MD);
          return !!openEntry && read(openEntry.doc).textContent.includes(bobToken);
        }, 5000);
      },
    },
  });

  const docName = makeDocName(BRANCH, PATH_MD, 0);
  const alice = await createLiveEditor({ url: relay.wsUrl, docName, token: 'alice' });
  const bob = await createLiveEditor({ url: relay.wsUrl, docName, token: 'bob' });
  editors.push(alice, bob);
  await waitUntil(() => bob.view.state.doc.textContent.includes('Beta'), 5000);

  // Alice triggers the commit; the testHooks above make bob's edit land
  // mid-flight.
  const commitResult = await postJSON(relay.baseUrl, '/commit', { branch: BRANCH, path: PATH_MD, user: 'alice', message: 'Edit the document' });
  expect(commitResult.status).toBe(200);
  expect(commitResult.body.ok).toBe(true);
  expect(bobEditApplied).toBe(true);

  // The commit's own blob does not contain bob's edit (it was rendered
  // before bob's edit landed).
  const cache = new GitStore({ cacheDir: (await makeTempDir('phraise-t-commit-race-verify-')).path, remoteUrl: remote.url });
  await cache.init();
  await cache.fetch(BRANCH);
  const firstCommit = commitResult.body.commit as string;
  const firstText = await cache.readFile(firstCommit, PATH_MD);
  expect(firstText).not.toContain(bobToken);

  // Bob is still marked as having edited since the (just-recorded) commit --
  // his edit was never actually part of it, so he must not lose credit.
  const openEntry = relay.state!.branchState(BRANCH).open.get(PATH_MD)!;
  expect(editorsSinceCommit(openEntry.doc)).toEqual(['bob']);

  // Someone else pushes a commit that changes the SAME paragraph (Beta)
  // bob concurrently edited.
  const clone = await makeClone(remote.url, { branch: BRANCH });
  await clone.write(PATH_MD, FIXTURE.replace('Paragraph Beta ends here.', 'Paragraph Beta was rewritten by someone else.'));
  await clone.commitAndPush('External rewrite of Beta');

  // Force the relay to notice and rebase now.
  const pollResult = await postJSON(relay.baseUrl, '/poll', {});
  expect(pollResult.status).toBe(200);

  // Bob's edit survives the rebase (visible on the relay's own doc
  // immediately -- the rebase's merge-back is a direct local write there).
  await waitUntil(() => read(openEntry.doc).textContent.includes(bobToken), 5000);
  const rebasedText = read(openEntry.doc).textContent;
  expect(tokensIn(rebasedText)).toContain(bobToken);
  expect(rebasedText).toContain('rewritten by someone else');

  // ...and the block is flagged. The relay's own doc acks its OWN computed
  // rebase immediately (S5-5) and does not scan it itself; the flag is
  // written by alice/bob's live-editor replicas (which treat the relayed
  // rebase batch as remote) and then syncs back to the relay over the real
  // WebSocket connection -- wait for that round trip.
  await waitUntil(() => listReview(openEntry.doc).some((r) => r.reason === 'concurrent-edit'), 5000);

  // The next commit contains bob's edit and credits him.
  const secondCommitResult = await postJSON(relay.baseUrl, '/commit', { branch: BRANCH, path: PATH_MD, user: 'alice', message: 'Second edit' });
  expect(secondCommitResult.status).toBe(200);
  expect(secondCommitResult.body.ok).toBe(true);
  expect(secondCommitResult.body.coAuthors).toContain('bob');

  await cache.fetch(BRANCH);
  const secondCommit = secondCommitResult.body.commit as string;
  const info = await cache.commitInfo(secondCommit);
  expect(info.message).toContain('Co-authored-by: bob <bob@users.phraise.test>');
  const secondText = await cache.readFile(secondCommit, PATH_MD);
  expect(secondText).toContain(bobToken);
});
