// Gate C (charter milestone 1): "A comment store in shared state: create,
// reply, resolve, list. Anchors as fixed under D3. Comments survive the
// other user's edits."
import 'global-jsdom/register';
import { startRelayHarness, type RelayHarnessHandle } from '../src/testkit/relayHarness.js';
import { createLiveEditor, waitUntil, type LiveEditor } from '../src/testkit/editor.js';
import { insertText, findPos, deleteRange } from '../src/testkit/edits.js';
import { makeRemote, type Remote } from '../src/testkit/remote.js';
import { makeTempDir } from '../src/testkit/tmp.js';
import { makeDocName } from '../src/relay/index.js';
import { createComment, createCommentOnQuote, reply, setResolved, listComments, getComment } from '../src/engine/index.js';

export interface GateCResult {
  gate: 'C';
  pass: boolean;
  summary: string;
  numbers: Record<string, number>;
}

const BRANCH = 'main';
const PATH_MD = 'doc.md';
const FIXTURE =
  '# Doc\n\n' +
  'The quick brown fox jumps over the lazy dog.\n\n' +
  'A second paragraph holds the deleteorphan marker text for later.\n\n' +
  'A third closing paragraph.\n';

function endOfParagraph(view: import('prosemirror-view').EditorView, needle: string): number {
  const pos = findPos(view, (n) => n.type.name === 'paragraph' && n.textContent.includes(needle));
  if (pos === -1) throw new Error(`gate C: paragraph containing ${JSON.stringify(needle)} not found`);
  const node = view.state.doc.nodeAt(pos)!;
  return pos + node.nodeSize - 1;
}

function startOfParagraph(view: import('prosemirror-view').EditorView, needle: string): number {
  const pos = findPos(view, (n) => n.type.name === 'paragraph' && n.textContent.includes(needle));
  if (pos === -1) throw new Error(`gate C: paragraph containing ${JSON.stringify(needle)} not found`);
  return pos + 1;
}

export async function run(_opts: { quick?: boolean } = {}): Promise<GateCResult> {
  let remote: Remote | undefined;
  let relay: RelayHarnessHandle | undefined;
  let alice: LiveEditor | undefined;
  let bob: LiveEditor | undefined;
  const checks: { name: string; pass: boolean; detail: string }[] = [];

  try {
    remote = await makeRemote({ branch: BRANCH, files: { [PATH_MD]: FIXTURE } });
    const dataDir = (await makeTempDir('phraise-gateC-relay-')).path;
    relay = await startRelayHarness({ remote: remote.url, dataDir });
    const docName = makeDocName(BRANCH, PATH_MD, 0);

    alice = await createLiveEditor({ url: relay.wsUrl, docName, token: 'alice' });
    bob = await createLiveEditor({ url: relay.wsUrl, docName, token: 'bob' });

    // --- create, through alice's live document ---
    const aliceAuthor = { userId: 'alice', name: 'Alice' };
    const bobAuthor = { userId: 'bob', name: 'Bob' };
    const commentId = createCommentOnQuote(alice.ydoc, 'brown fox', { body: 'nice phrase', author: aliceAuthor });
    const orphanCommentId = createCommentOnQuote(alice.ydoc, 'deleteorphan marker', { body: 'flag for removal', author: aliceAuthor });

    await waitUntil(() => getComment(bob!.ydoc, commentId) !== undefined, 5000);
    await waitUntil(() => getComment(bob!.ydoc, orphanCommentId) !== undefined, 5000);

    // --- reply, through bob ---
    reply(bob.ydoc, commentId, { body: 'agreed', author: bobAuthor });
    await waitUntil(() => (getComment(alice!.ydoc, commentId)?.replies.length ?? 0) === 1, 5000);

    // --- resolve, through alice ---
    setResolved(alice.ydoc, commentId, 'alice');
    await waitUntil(() => getComment(bob!.ydoc, commentId)?.resolved === true, 5000);

    checks.push({
      name: 'create/reply/resolve propagate to every replica',
      pass: getComment(bob.ydoc, commentId)?.resolved === true && getComment(bob.ydoc, commentId)?.replies.length === 1,
      detail: JSON.stringify(getComment(bob.ydoc, commentId)),
    });

    // --- bob edits before, inside, and after the quoted range ---
    const beforePos = startOfParagraph(bob.view, 'quick brown fox');
    insertText(bob.view, beforePos, 'Well, ');
    await waitUntil(() => alice!.view.state.doc.textContent.includes('Well, '), 5000);

    // "inside": split the quoted phrase itself ("brown" -> "brown-red"), right after the current paragraph start shifted by "Well, ".
    const insideParaPos = findPos(bob.view, (n) => n.type.name === 'paragraph' && n.textContent.includes('brown fox'));
    const insideParaNode = bob.view.state.doc.nodeAt(insideParaPos)!;
    const insideCharIdx = insideParaNode.textContent.indexOf('brown');
    const insideAnchor = insideParaPos + 1 + insideCharIdx + 'brown'.length;
    insertText(bob.view, insideAnchor, '-red');
    await waitUntil(() => alice!.view.state.doc.textContent.includes('brown-red'), 5000);

    const afterPos = endOfParagraph(bob.view, 'jumps over the lazy dog');
    insertText(bob.view, afterPos, ' Extra.');
    await waitUntil(() => alice!.view.state.doc.textContent.includes(' Extra.'), 5000);
    await new Promise((r) => setTimeout(r, 200));

    // --- delete the second paragraph entirely: its comment should orphan ---
    const delFrom = findPos(bob.view, (n) => n.type.name === 'paragraph' && n.textContent.includes('deleteorphan'));
    const delNode = bob.view.state.doc.nodeAt(delFrom)!;
    deleteRange(bob.view, delFrom, delFrom + delNode.nodeSize);
    await waitUntil(() => !alice!.view.state.doc.textContent.includes('deleteorphan'), 5000);
    await new Promise((r) => setTimeout(r, 200));

    // --- every replica lists the same comments with the anchor resolving to sensible text ---
    const aliceList = listComments(alice.ydoc);
    const bobList = listComments(bob.ydoc);
    const sameIds = new Set(aliceList.map((c) => c.id)).size === new Set(bobList.map((c) => c.id)).size && aliceList.length === bobList.length;
    checks.push({ name: 'every replica lists the same set of comments', pass: sameIds, detail: `alice=${aliceList.length} bob=${bobList.length}` });

    const mainComment = aliceList.find((c) => c.id === commentId);
    const mainSurvived = mainComment !== undefined && mainComment.anchor.method !== 'orphaned';
    checks.push({
      name: 'the comment on edited-around text survives (not orphaned)',
      pass: mainSurvived,
      detail: JSON.stringify(mainComment?.anchor),
    });

    const bobMainComment = bobList.find((c) => c.id === commentId);
    const bothAgree =
      mainComment?.anchor.method === bobMainComment?.anchor.method &&
      mainComment?.anchor.from === bobMainComment?.anchor.from &&
      mainComment?.anchor.to === bobMainComment?.anchor.to;
    checks.push({
      name: 'both replicas resolve the surviving comment to the same anchor',
      pass: bothAgree,
      detail: `alice=${JSON.stringify(mainComment?.anchor)} bob=${JSON.stringify(bobMainComment?.anchor)}`,
    });

    const orphanComment = aliceList.find((c) => c.id === orphanCommentId);
    const orphanedCorrectly = orphanComment?.anchor.method === 'orphaned' && orphanComment.anchor.quote.exact === 'deleteorphan marker';
    checks.push({
      name: 'the comment whose text was deleted is orphaned, with its quote intact',
      pass: orphanedCorrectly,
      detail: JSON.stringify(orphanComment?.anchor),
    });

    const pass = checks.every((c) => c.pass);
    return {
      gate: 'C',
      pass,
      summary: pass ? `all ${checks.length} checks passed` : checks.filter((c) => !c.pass).map((c) => `${c.name}: ${c.detail}`).join('; '),
      numbers: { checks: checks.length, comments: aliceList.length },
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
