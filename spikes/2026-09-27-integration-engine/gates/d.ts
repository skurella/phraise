// Gate D (charter milestone 1): "The relay flushes to the draft ref as
// decided. `git diff <branch> refs/phraise/drafts/<branch>` on a plain
// clone shows exactly the uncommitted changes. A relay restarted with its
// local storage deleted restores the document from the draft ref with
// comments and attribution intact. A stale flush is rejected by the
// lease."
import 'global-jsdom/register';
import { rm } from 'node:fs/promises';
import { startRelayHarness, type RelayHarnessHandle } from '../src/testkit/relayHarness.js';
import { createLiveEditor, waitUntil, type LiveEditor } from '../src/testkit/editor.js';
import { insertText, findPos, addCommentOnQuote } from '../src/testkit/edits.js';
import { makeRemote, makeClone, type Remote } from '../src/testkit/remote.js';
import { makeTempDir } from '../src/testkit/tmp.js';
import { GitStore } from '../src/git/index.js';
import { makeDocName } from '../src/relay/index.js';
import { listComments, listAttribution } from '../src/engine/index.js';

export interface GateDResult {
  gate: 'D';
  pass: boolean;
  summary: string;
  numbers: Record<string, number>;
}

const BRANCH = 'main';
const PATH_MD = 'doc.md';
const FIXTURE = '# Doc\n\nParagraph Alpha ends here.\n\nParagraph Beta ends here.\n';

async function postJSON(baseUrl: string, path: string, body: unknown): Promise<{ status: number; body: any }> {
  const res = await fetch(`${baseUrl}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}

async function getJSON(baseUrl: string, path: string): Promise<any> {
  const res = await fetch(`${baseUrl}${path}`);
  return res.json();
}

export async function run(_opts: { quick?: boolean } = {}): Promise<GateDResult> {
  const checks: { name: string; pass: boolean; detail: string }[] = [];
  const docName = makeDocName(BRANCH, PATH_MD, 0);

  // --- part 1: flush, plain-clone diff/show, restart-and-restore ---
  let remote: Remote | undefined;
  let relay: RelayHarnessHandle | undefined;
  let relay2: RelayHarnessHandle | undefined;
  let alice: LiveEditor | undefined;
  let charlie: LiveEditor | undefined;
  let dataDir = '';
  try {
    remote = await makeRemote({ branch: BRANCH, files: { [PATH_MD]: FIXTURE } });
    dataDir = (await makeTempDir('phraise-gateD-relay-')).path;
    relay = await startRelayHarness({ remote: remote.url, dataDir });

    alice = await createLiveEditor({ url: relay.wsUrl, docName, token: 'alice' });
    const pos = findPos(alice.view, (n) => n.type.name === 'paragraph' && n.textContent.includes('Alpha'));
    const node = alice.view.state.doc.nodeAt(pos)!;
    insertText(alice.view, pos + node.nodeSize - 1, ' edited by alice.');
    addCommentOnQuote(alice.ydoc, 'Beta ends here', 'a comment', { userId: 'alice', name: 'Alice' });
    await waitUntil(() => alice!.view.state.doc.textContent.includes('edited by alice'), 5000);
    await new Promise((r) => setTimeout(r, 150));

    const flush1 = await postJSON(relay.baseUrl, '/flush', { branch: BRANCH });
    checks.push({ name: 'flush succeeds', pass: flush1.status === 200 && flush1.body.ok === true, detail: JSON.stringify(flush1.body) });

    const clone = await makeClone(remote.url, { branch: BRANCH });
    await clone.git(['fetch', 'origin', `refs/phraise/drafts/${BRANCH}:refs/d`]);
    const changed = (await clone.git(['diff', '--name-only', BRANCH, 'refs/d'])).trim().split('\n').filter(Boolean);
    checks.push({ name: 'the draft diff touches only the edited Markdown path', pass: changed.length === 1 && changed[0] === PATH_MD, detail: JSON.stringify(changed) });

    const shown = await clone.git(['show', `refs/d:${PATH_MD}`]);
    const relayMarkdown = (await getJSON(relay.baseUrl, `/markdown/${encodeURIComponent(docName)}`)) as { text: string };
    checks.push({ name: 'git show refs/d:<path> equals the relay\'s render', pass: shown === relayMarkdown.text, detail: `${JSON.stringify(shown.slice(0, 80))} vs ${JSON.stringify(relayMarkdown.text.slice(0, 80))}` });

    const mainHead = await clone.head();
    const draftFirstParent = (await clone.git(['rev-parse', 'refs/d^1'])).trim();
    checks.push({ name: 'the draft commit\'s first parent is the branch head', pass: draftFirstParent === mainHead, detail: `${draftFirstParent} vs ${mainHead}` });
    await clone.cleanup();

    const textBefore = alice.view.state.doc.textContent;
    const commentsBefore = listComments(alice.ydoc);
    const attributionBefore = listAttribution(alice.ydoc);

    // --- restart with local storage deleted: restore from the draft ---
    await relay.stop();
    await rm(dataDir, { recursive: true, force: true });
    relay2 = await startRelayHarness({ remote: remote.url, dataDir });
    charlie = await createLiveEditor({ url: relay2.wsUrl, docName, token: 'charlie' });
    await waitUntil(() => charlie!.view.state.doc.textContent.length > 0, 5000);
    await new Promise((r) => setTimeout(r, 100));

    const textAfter = charlie.view.state.doc.textContent;
    const commentsAfter = listComments(charlie.ydoc);
    const attributionAfter = listAttribution(charlie.ydoc);

    checks.push({ name: 'restored text is identical', pass: textAfter === textBefore, detail: `${JSON.stringify(textBefore)} vs ${JSON.stringify(textAfter)}` });
    checks.push({
      name: 'restored listComments is identical',
      pass: JSON.stringify(commentsAfter) === JSON.stringify(commentsBefore),
      detail: `${commentsBefore.length} vs ${commentsAfter.length} comments`,
    });
    checks.push({
      name: 'restored listAttribution is identical',
      pass: JSON.stringify(attributionAfter) === JSON.stringify(attributionBefore),
      detail: `${attributionBefore.length} vs ${attributionAfter.length} ranges`,
    });
  } finally {
    alice?.destroy();
    charlie?.destroy();
    if (relay2) await relay2.stop();
    else if (relay) await relay.stop();
    if (remote) await remote.cleanup();
  }

  // --- part 2: stale flush, rejected by the lease, merge-and-retry reported ---
  let remoteB: Remote | undefined;
  let relayB: RelayHarnessHandle | undefined;
  let carol: LiveEditor | undefined;
  try {
    remoteB = await makeRemote({ branch: BRANCH, files: { [PATH_MD]: FIXTURE } });
    const dataDirB = (await makeTempDir('phraise-gateD-staleflush-')).path;
    relayB = await startRelayHarness({ remote: remoteB.url, dataDir: dataDirB });
    carol = await createLiveEditor({ url: relayB.wsUrl, docName, token: 'carol' });
    const posC = findPos(carol.view, (n) => n.type.name === 'paragraph' && n.textContent.includes('Alpha'));
    const nodeC = carol.view.state.doc.nodeAt(posC)!;
    insertText(carol.view, posC + nodeC.nodeSize - 1, ' carolEdit');
    await waitUntil(() => carol!.view.state.doc.textContent.includes('carolEdit'), 5000);
    await new Promise((r) => setTimeout(r, 150));

    const firstFlush = await postJSON(relayB.baseUrl, '/flush', { branch: BRANCH });
    checks.push({ name: '(stale-flush setup) first flush succeeds', pass: firstFlush.status === 200 && firstFlush.body.ok === true, detail: JSON.stringify(firstFlush.body) });

    // A competing writer (e.g. a second relay instance) rewrites the draft directly with a valid lease, moving the ref out from under relayB's own belief about it.
    const competingCache = (await makeTempDir('phraise-gateD-competing-')).path;
    const competingStore = new GitStore({ cacheDir: competingCache, remoteUrl: remoteB.url });
    await competingStore.init();
    const currentDraft = await competingStore.readDraft(BRANCH);
    if (!currentDraft) throw new Error('gate D: expected a draft to already exist');
    const competingFiles = { ...currentDraft.files, [PATH_MD]: `${currentDraft.files[PATH_MD]}\n\nCompeting addition.\n` };
    const competingWrite = await competingStore.writeDraft({
      branch: BRANCH,
      base: currentDraft.base,
      files: competingFiles,
      sidecar: currentDraft.sidecar, // same docId/generation meta as relayB's own document -- a legitimate "another replica of the same doc" case.
      expected: currentDraft.commit,
    });
    checks.push({ name: '(stale-flush setup) competing writer moves the draft ref', pass: competingWrite.ok === true, detail: JSON.stringify(competingWrite) });

    const healthBefore = (await getJSON(relayB.baseUrl, '/health')) as { counters: { staleFlushes: number; mergedFlushRetries: number; flushConflicts: number } };
    const secondFlush = await postJSON(relayB.baseUrl, '/flush', { branch: BRANCH });
    const healthAfter = (await getJSON(relayB.baseUrl, '/health')) as { counters: { staleFlushes: number; mergedFlushRetries: number; flushConflicts: number } };

    const staleWasCounted = healthAfter.counters.staleFlushes === healthBefore.counters.staleFlushes + 1;
    checks.push({ name: 'the stale push is counted', pass: staleWasCounted, detail: `${healthBefore.counters.staleFlushes} -> ${healthAfter.counters.staleFlushes}` });

    const mergedAndRetried = secondFlush.status === 200 && secondFlush.body.ok === true && secondFlush.body.merged === true;
    checks.push({ name: 'the merge-and-retry outcome is reported', pass: mergedAndRetried, detail: JSON.stringify(secondFlush.body) });

    const notBlindlyOverwritten =
      healthAfter.counters.flushConflicts === healthBefore.counters.flushConflicts || healthAfter.counters.mergedFlushRetries > healthBefore.counters.mergedFlushRetries;
    checks.push({ name: 'the remote draft is not blindly overwritten (merged, not force-clobbered)', pass: notBlindlyOverwritten, detail: JSON.stringify(healthAfter.counters) });
  } finally {
    carol?.destroy();
    if (relayB) await relayB.stop();
    if (remoteB) await remoteB.cleanup();
  }

  const pass = checks.every((c) => c.pass);
  return {
    gate: 'D',
    pass,
    summary: pass ? `all ${checks.length} checks passed` : checks.filter((c) => !c.pass).map((c) => `${c.name}: ${c.detail}`).join('; '),
    numbers: { checks: checks.length },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run({ quick: process.argv.includes('--quick') }).then((r) => {
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.pass ? 0 : 1);
  });
}
