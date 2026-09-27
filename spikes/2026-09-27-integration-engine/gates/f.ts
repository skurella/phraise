// Gate F (charter milestone 2, brief 06 task 5): "External commit. Someone
// pushes a commit that changes the file. The relay detects it by polling
// the ref and rebases the live document while an editor keeps typing.
// Comments survive or are orphaned. Blocks changed on both sides are
// flagged. A commit attempted after the head moved rebases first and then
// succeeds."
//
// Scenario, on a document with 9 blocks (a heading, 5 plain paragraphs, a
// two-item bullet list, a 1-row GFM table, and a closing paragraph),
// including the list and table the brief asks for:
//   1. alice and bob connect; comments planted on the Untouched paragraph,
//      the Rewritten paragraph (the external commit rewrites it) and the
//      Deleted paragraph (the external commit removes it entirely).
//   2. alice edits BothEdited (concurrently with an external change to the
//      same paragraph, below) -- synced to the relay before the external
//      commit is even pushed, so this is a genuine "both sides changed the
//      same block" case, not a race.
//   3. someone else pushes a commit that rewrites Rewritten, deletes
//      Deleted, and appends to BothEdited (touching several blocks,
//      including the one alice is concurrently editing).
//   4. alice starts a burst of 45 single-character inserts into
//      TypingTarget; partway through, `POST /poll` is fired (not awaited
//      before the typing burst finishes) so the rebase genuinely overlaps
//      live typing, exactly like the reference technique this gate is
//      modeled on (spike 5's gate F "continuous typing" variant).
//   5. convergence, flags and comments are checked on all three replicas
//      (alice, bob, the relay's own raw state, decoded).
//   6. bob also edits Closing, then commits: parent = the external commit,
//      committed text = the relay's own render, diff confined to
//      BothEdited/TypingTarget/Closing (gates/lib's containment check,
//      ported from gate E2).
//   7. a second external commit lands, and alice commits immediately
//      (`pollMs` is set very large for this relay so the background timer
//      cannot have ticked, and no explicit `/poll` is called first): the
//      commit route's own "rebase first if the head moved" (brief 06 task
//      3) must catch it -- `CommitOutcome.rebased` says so directly.
import 'global-jsdom/register';
import * as Y from 'yjs';
import { startRelayHarness, type RelayHarnessHandle } from '../src/testkit/relayHarness.js';
import { createLiveEditor, waitUntil, type LiveEditor } from '../src/testkit/editor.js';
import { insertText, findPos } from '../src/testkit/edits.js';
import { makeRemote, makeClone, type Remote } from '../src/testkit/remote.js';
import { makeTempDir } from '../src/testkit/tmp.js';
import { GitStore } from '../src/git/index.js';
import { makeDocName } from '../src/relay/index.js';
import { createCommentOnQuote, listComments, listReview, type ListedComment, type ReviewListEntry } from '../src/engine/index.js';
import { read } from '../src/crdt/index.js';
import { parseMarkdown } from '../src/markdown/index.js';
import { topLevelSpans } from './lib/topSpans.js';
import { computeLcsHunks, hunksContained, firstHunkExcerpt } from './lib/diffHunks.js';

export interface GateFResult {
  gate: 'F';
  pass: boolean;
  summary: string;
  numbers: Record<string, number>;
}

const BRANCH = 'main';
const PATH_MD = 'doc.md';

// TypingTarget is deliberately the FIRST body paragraph (right after the
// heading): alice's typing loop tracks its insertion position as a plain
// JS number across iterations (not through a ProseMirror step Mapping), so
// it only stays valid across the rebase if nothing BEFORE it in document
// order changes size. Every block the external commit actually resizes or
// removes (Rewritten, Deleted) sits AFTER it for exactly this reason.
const MD_A =
  '# Doc\n\n' +
  'Paragraph TypingTarget holds text alice keeps typing into during the rebase.\n\n' +
  'Paragraph Untouched holds text nobody touches during the whole rebase.\n\n' +
  'Paragraph Rewritten holds text the external commit rewrites completely.\n\n' +
  'Paragraph Deleted holds text the external commit removes entirely.\n\n' +
  'Paragraph BothEdited holds text both sides edit concurrently.\n\n' +
  '- List item one never changes.\n' +
  '- List item two never changes.\n\n' +
  '| Col A | Col B |\n' +
  '| --- | --- |\n' +
  '| cell one | cell two |\n\n' +
  'Paragraph Closing ends the document here.\n';

const MD_B =
  '# Doc\n\n' +
  'Paragraph TypingTarget holds text alice keeps typing into during the rebase.\n\n' +
  'Paragraph Untouched holds text nobody touches during the whole rebase.\n\n' +
  'This paragraph now says something else altogether, replaced by the external commit.\n\n' +
  'Paragraph BothEdited holds text both sides edit concurrently EXTERNAL-CHANGE.\n\n' +
  '- List item one never changes.\n' +
  '- List item two never changes.\n\n' +
  '| Col A | Col B |\n' +
  '| --- | --- |\n' +
  '| cell one | cell two |\n\n' +
  'Paragraph Closing ends the document here.\n';

async function postJSON(baseUrl: string, path: string, body: unknown): Promise<{ status: number; body: any }> {
  const res = await fetch(`${baseUrl}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}

function paraEndPos(view: import('prosemirror-view').EditorView, needle: string): number {
  const pos = findPos(view, (n) => n.type.name === 'paragraph' && n.textContent.includes(needle));
  if (pos === -1) throw new Error(`gate F: no paragraph containing ${JSON.stringify(needle)}`);
  const node = view.state.doc.nodeAt(pos)!;
  return pos + node.nodeSize - 1;
}

async function waitUntilAsync(check: () => Promise<boolean>, timeoutMs = 8000, intervalMs = 20): Promise<void> {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > timeoutMs) throw new Error(`waitUntilAsync: condition not met within ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/** Decodes the relay's raw encoded state (`GET /state/<docName>`) into a scratch `Y.Doc` usable directly as a `CrdtDoc` (gc:false, matching every live replica's own config, per this spike's engine/crdt READMEs). */
async function fetchRelayDoc(baseUrl: string, docName: string): Promise<Y.Doc> {
  const res = await fetch(`${baseUrl}/state/${encodeURIComponent(docName)}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const scratch = new Y.Doc({ gc: false });
  if (bytes.length > 0) Y.applyUpdate(scratch, bytes);
  return scratch;
}

function canonicalReview(entries: ReviewListEntry[]): string {
  return JSON.stringify(
    [...entries].sort((a, b) => a.blockId.localeCompare(b.blockId)).map((e) => ({ reason: e.reason, text: e.text })),
  );
}

function findComment(list: ListedComment[], id: string): ListedComment | undefined {
  return list.find((c) => c.id === id);
}

export async function run(_opts: { quick?: boolean } = {}): Promise<GateFResult> {
  let remote: Remote | undefined;
  let relay: RelayHarnessHandle | undefined;
  let alice: LiveEditor | undefined;
  let bob: LiveEditor | undefined;
  const checks: { name: string; pass: boolean; detail: string }[] = [];
  const numbers: Record<string, number> = {};

  try {
    remote = await makeRemote({ branch: BRANCH, files: { [PATH_MD]: MD_A } });
    const dataDir = (await makeTempDir('phraise-gateF-relay-')).path;
    // pollMs huge: this gate drives every rebase itself, explicitly
    // (`POST /poll` for the mid-typing rebase, the commit route's own
    // rebase-first logic for the final bullet) so its timing is exact, not
    // racing a background timer -- see this file's header comment, task 7.
    relay = await startRelayHarness({ remote: remote.url, dataDir, timings: { pollMs: 600000 } });
    const docName = makeDocName(BRANCH, PATH_MD, 0);

    const verify = new GitStore({ cacheDir: (await makeTempDir('phraise-gateF-verify-')).path, remoteUrl: remote.url });
    await verify.init();
    const originalHead = await verify.remoteHead(BRANCH);
    if (!originalHead) throw new Error('gate F: remote has no head');

    alice = await createLiveEditor({ url: relay.wsUrl, docName, token: 'alice' });
    bob = await createLiveEditor({ url: relay.wsUrl, docName, token: 'bob' });
    await waitUntil(() => bob!.view.state.doc.textContent.includes('Paragraph Untouched'), 5000);

    // --- comments planted (step 1) ---
    const srv = { userId: 'srv', name: 'server' };
    const untouchedComment = createCommentOnQuote(alice.ydoc, 'nobody touches during the whole rebase', { body: 'fine as is', author: srv });
    const rewrittenComment = createCommentOnQuote(alice.ydoc, 'the external commit rewrites completely', { body: 'watch this one', author: srv });
    const deletedComment = createCommentOnQuote(alice.ydoc, 'the external commit removes entirely', { body: 'should be removed', author: srv });
    await waitUntil(() => listComments(bob!.ydoc).length === 3, 5000);

    // --- alice's concurrent edit to BothEdited, synced before the external commit lands (step 2) ---
    const bothPos = paraEndPos(alice.view, 'Paragraph BothEdited');
    insertText(alice.view, bothPos, ' ALICE-CONCURRENT-EDIT');
    await waitUntil(() => bob!.view.state.doc.textContent.includes('ALICE-CONCURRENT-EDIT'), 5000);
    await new Promise((r) => setTimeout(r, 100));

    // --- someone else commits and pushes (step 3) ---
    const t0 = Date.now();
    const other = await makeClone(remote.url, { branch: BRANCH });
    await other.write(PATH_MD, MD_B);
    const externalCommit = await other.commitAndPush('external: rewrite, delete, and touch BothEdited');
    await other.cleanup();

    // --- alice types a burst of 45 characters into TypingTarget, spanning the rebase (step 4) ---
    const typingPos = paraEndPos(alice.view, 'Paragraph TypingTarget');
    const BURST = 45;
    let typingDone = false;
    const typing = (async () => {
      let pos = typingPos;
      for (let i = 0; i < BURST; i++) {
        pos = insertText(alice!.view, pos, 'x');
        await new Promise((r) => setTimeout(r, 4));
      }
      typingDone = true;
    })();
    await new Promise((r) => setTimeout(r, 60)); // let some of the burst land first
    const pollPromise = postJSON(relay.baseUrl, '/poll', {});

    await typing;
    const pollRes = await pollPromise;
    const polledMain = (pollRes.body.polled as Array<{ branch: string; rebasedPaths: string[] }>).find((p) => p.branch === BRANCH);
    checks.push({
      name: 'POST /poll detects the moved head and rebases the open document',
      pass: !!polledMain && polledMain.rebasedPaths.includes(PATH_MD),
      detail: JSON.stringify(pollRes.body),
    });

    // --- converge: all three replicas agree on the rewritten content (step 5) ---
    await waitUntilAsync(async () => {
      const relayDoc = await fetchRelayDoc(relay!.baseUrl, docName);
      return read(relayDoc).textContent.includes('EXTERNAL-CHANGE');
    }, 8000);
    await waitUntil(() => bob!.view.state.doc.textContent.includes('EXTERNAL-CHANGE'), 8000);
    await new Promise((r) => setTimeout(r, 250)); // let trailing acks/attribution settle
    const t1 = Date.now();
    numbers.rebaseLatencyMs = t1 - t0;
    console.log(`gate F: rebase latency (external commit pushed -> all replicas converged) = ${t1 - t0}ms`);

    const relayDoc = await fetchRelayDoc(relay.baseUrl, docName);
    const textAlice = alice.view.state.doc.textContent;
    const textBob = bob.view.state.doc.textContent;
    const textRelay = read(relayDoc).textContent;

    checks.push({
      name: 'alice finished typing all 45 characters',
      pass: typingDone,
      detail: `typingDone=${typingDone}`,
    });
    const intactRun = textAlice.includes('x'.repeat(BURST)) && !textAlice.includes('x'.repeat(BURST + 1));
    checks.push({
      name: "every inserted character of alice's typing burst is present, as one intact run",
      pass: intactRun,
      detail: intactRun ? 'ok' : textAlice.slice(0, 400),
    });

    const pmAlice = JSON.stringify(alice.view.state.doc.toJSON());
    const pmBob = JSON.stringify(bob.view.state.doc.toJSON());
    const pmRelay = JSON.stringify(read(relayDoc).toJSON());
    const pmConverged = pmAlice === pmBob && pmBob === pmRelay;
    checks.push({ name: 'alice, bob and the relay converge to identical ProseMirror JSON', pass: pmConverged, detail: pmConverged ? 'identical' : `alice==bob:${pmAlice === pmBob} bob==relay:${pmBob === pmRelay}` });

    const reviewAlice = canonicalReview(listReview(alice.ydoc));
    const reviewBob = canonicalReview(listReview(bob.ydoc));
    const reviewRelay = canonicalReview(listReview(relayDoc));
    const reviewConverged = reviewAlice === reviewBob && reviewBob === reviewRelay;
    checks.push({ name: 'alice, bob and the relay converge to an identical listReview', pass: reviewConverged, detail: reviewConverged ? 'identical' : `alice=${reviewAlice} bob=${reviewBob} relay=${reviewRelay}` });

    const untouchedText = 'Paragraph Untouched holds text nobody touches during the whole rebase.';
    const listText1 = 'List item one never changes.';
    const listText2 = 'List item two never changes.';
    const tableText = 'cell one';
    const closingText = 'Paragraph Closing ends the document here.';
    const everyoneHas = (needle: string) => [textAlice, textBob, textRelay].every((t) => t.includes(needle));
    const untouchedOk = [untouchedText, listText1, listText2, tableText, closingText].every(everyoneHas);
    checks.push({
      name: "every block nobody touched (Untouched, the list, the table, Closing) equals the new head's block, on all three replicas",
      pass: untouchedOk,
      detail: untouchedOk ? 'all present' : 'one or more missing',
    });

    const typingTargetOk = everyoneHas('Paragraph TypingTarget holds text alice keeps typing into during the rebase.' + 'x'.repeat(BURST));
    checks.push({ name: "TypingTarget's own base text survived the rebase alongside alice's burst", pass: typingTargetOk, detail: typingTargetOk ? 'ok' : textAlice });

    // --- exactly BothEdited is flagged concurrent-edit, nowhere else ---
    const entriesAlice = listReview(alice.ydoc);
    const flaggedOk = entriesAlice.length === 1 && entriesAlice[0].reason === 'concurrent-edit' && entriesAlice[0].text.includes('BothEdited') && entriesAlice[0].text.includes('EXTERNAL-CHANGE') && entriesAlice[0].text.includes('ALICE-CONCURRENT-EDIT');
    checks.push({
      name: 'exactly the BothEdited block is flagged concurrent-edit, and no other block is',
      pass: flaggedOk,
      detail: JSON.stringify(entriesAlice),
    });

    // --- comments (step 5) ---
    const listAlice = listComments(alice.ydoc);
    const listBob = listComments(bob.ydoc);
    const listRelay = listComments(relayDoc);

    const untouchedAnchor = findComment(listAlice, untouchedComment)?.anchor;
    const untouchedCommentOk = untouchedAnchor?.method === 'crdt' && [listAlice, listBob, listRelay].every((l) => findComment(l, untouchedComment)?.anchor.method === 'crdt');
    checks.push({ name: 'the untouched-paragraph comment resolves by CRDT on every replica', pass: untouchedCommentOk, detail: JSON.stringify(untouchedAnchor) });

    const rewrittenAnchor = findComment(listAlice, rewrittenComment)?.anchor;
    const rewrittenOk =
      (rewrittenAnchor?.method === 'fuzzy' || rewrittenAnchor?.method === 'orphaned') &&
      [listAlice, listBob, listRelay].every((l) => {
        const a = findComment(l, rewrittenComment)?.anchor;
        return a?.method === rewrittenAnchor!.method && a.quote.exact === rewrittenAnchor!.quote.exact;
      });
    checks.push({ name: 'the rewritten-paragraph comment is recovered or orphaned (with its quote), consistently across replicas', pass: rewrittenOk, detail: JSON.stringify(rewrittenAnchor) });

    const deletedAnchor = findComment(listAlice, deletedComment)?.anchor;
    const deletedOk = deletedAnchor?.method === 'orphaned' && deletedAnchor.quote.exact === 'the external commit removes entirely' && [listAlice, listBob, listRelay].every((l) => findComment(l, deletedComment)?.anchor.method === 'orphaned');
    checks.push({ name: 'the deleted-paragraph comment is orphaned, with its quote intact, on every replica', pass: deletedOk, detail: JSON.stringify(deletedAnchor) });

    // --- step 6: bob also edits Closing, then commits ---
    const closingPos = paraEndPos(bob.view, 'Paragraph Closing');
    insertText(bob.view, closingPos, ' BOB-COMMIT-EDIT');
    await waitUntil(() => alice!.view.state.doc.textContent.includes('BOB-COMMIT-EDIT'), 5000);
    await new Promise((r) => setTimeout(r, 150));

    const commitRes = await postJSON(relay.baseUrl, '/commit', { branch: BRANCH, path: PATH_MD, user: 'bob', message: 'Bob commits after the rebase' });
    checks.push({ name: "bob's commit succeeds", pass: commitRes.status === 200 && commitRes.body.ok === true, detail: JSON.stringify(commitRes.body) });

    if (commitRes.body.ok) {
      const newCommit: string = commitRes.body.commit;
      await verify.fetch(BRANCH);
      const info = await verify.commitInfo(newCommit);
      checks.push({ name: "the commit's parent is the external commit", pass: info.parents[0] === externalCommit, detail: `${info.parents[0]} vs ${externalCommit}` });

      const committedText = (await verify.readFile(newCommit, PATH_MD)) ?? '';
      const relayMarkdownRes = await fetch(`${relay.baseUrl}/markdown/${encodeURIComponent(docName)}`);
      const relayMarkdown = ((await relayMarkdownRes.json()) as { text: string }).text;
      checks.push({ name: "the committed file equals the relay's own render", pass: committedText === relayMarkdown, detail: committedText === relayMarkdown ? 'equal' : `committed=${committedText.slice(0, 200)} relay=${relayMarkdown.slice(0, 200)}` });

      const { doc: extDoc, positions } = parseMarkdown(MD_B, { positions: true });
      const spans = topLevelSpans({ doc: extDoc, positions: positions ?? [] });
      const editedNeedles = ['Paragraph BothEdited', 'Paragraph TypingTarget', 'Paragraph Closing'];
      const editedSpans = spans.filter((_span, i) => editedNeedles.some((needle) => extDoc.child(i).textContent.includes(needle)));
      const hunks = computeLcsHunks(MD_B, committedText);
      const contained = hunks.every((h) => editedSpans.some((span) => hunksContained([h], span.startLine, span.endLine)));
      checks.push({
        name: "bob's commit's diff against the external commit is confined to the blocks alice and bob edited",
        pass: contained,
        detail: contained ? `${hunks.length} hunks, all contained` : firstHunkExcerpt(MD_B, hunks),
      });
    }

    // --- step 7: a second external commit lands; alice commits immediately, before any poll ---
    const other2 = await makeClone(remote.url, { branch: BRANCH });
    await other2.pull();
    const currentText = await other2.git(['show', `HEAD:${PATH_MD}`]);
    await other2.write(PATH_MD, `${currentText}\nSECOND-EXTERNAL-COMMIT marker.\n`);
    const secondExternalCommit = await other2.commitAndPush('second external commit, landing before alice commits');
    await other2.cleanup();

    insertText(alice.view, alice.view.state.doc.content.size - 1, ' one-more-edit');
    await new Promise((r) => setTimeout(r, 100));
    const aliceCommitRes = await postJSON(relay.baseUrl, '/commit', { branch: BRANCH, path: PATH_MD, user: 'alice', message: 'Alice commits right after a second external commit, before any poll' });
    checks.push({
      name: 'a commit attempted right after the head moved again (no poll yet) rebases first and succeeds',
      pass: aliceCommitRes.status === 200 && aliceCommitRes.body.ok === true && aliceCommitRes.body.rebased === true,
      detail: JSON.stringify(aliceCommitRes.body),
    });
    if (aliceCommitRes.body.ok) {
      await verify.fetch(BRANCH);
      const info2 = await verify.commitInfo(aliceCommitRes.body.commit);
      checks.push({ name: "the final commit's parent is the second external commit", pass: info2.parents[0] === secondExternalCommit, detail: `${info2.parents[0]} vs ${secondExternalCommit}` });
      const finalText = (await verify.readFile(aliceCommitRes.body.commit, PATH_MD)) ?? '';
      checks.push({ name: 'the final commit contains the second external marker and the last edit', pass: finalText.includes('SECOND-EXTERNAL-COMMIT marker') && finalText.includes('one-more-edit'), detail: finalText.slice(0, 300) });
    }

    const pass = checks.every((c) => c.pass);
    return {
      gate: 'F',
      pass,
      summary: pass ? `all ${checks.length} checks passed` : checks.filter((c) => !c.pass).map((c) => `${c.name}: ${c.detail}`).join('; '),
      numbers: { checks: checks.length, ...numbers },
    };
  } finally {
    alice?.destroy();
    bob?.destroy();
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
