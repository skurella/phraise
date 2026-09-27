// Gate E (charter milestone 1): commit. E1: trailers, parent, stale-head
// refusal. E2: at least 50 corpus files (10 with --quick), 1-3 random word
// edits each through an editor transaction, committed; every changed line
// of the commit's diff must lie inside the edited paragraph(s)' original
// line spans (spike 1's `diffHunks`/`topSpans` approach, gates/lib/ ported
// per the brief).
import 'global-jsdom/register';
import { startRelayHarness, type RelayHarnessHandle } from '../src/testkit/relayHarness.js';
import { createLiveEditor, waitUntil, type LiveEditor } from '../src/testkit/editor.js';
import { insertText, replaceWord, findPos } from '../src/testkit/edits.js';
import { makeRemote, makeClone, type Remote } from '../src/testkit/remote.js';
import { makeTempDir } from '../src/testkit/tmp.js';
import { GitStore } from '../src/git/index.js';
import { loadCorpus } from '../src/testkit/corpus.js';
import { mulberry32, stringHashSeed, randInt } from '../src/testkit/prng.js';
import { makeDocName } from '../src/relay/index.js';
import { parseMarkdown } from '../src/markdown/index.js';
import { findEligibleWords, replacementFor } from './lib/words.js';
import { topLevelSpans } from './lib/topSpans.js';
import { computeLcsHunks, hunksContained, firstHunkExcerpt } from './lib/diffHunks.js';

export interface GateEResult {
  gate: 'E';
  pass: boolean;
  summary: string;
  numbers: Record<string, number>;
}

const BRANCH = 'main';

async function postJSON(baseUrl: string, path: string, body: unknown): Promise<{ status: number; body: any }> {
  const res = await fetch(`${baseUrl}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}

// --- E1 ---------------------------------------------------------------------

const E1_PATH = 'doc.md';
const E1_FIXTURE = '# Doc\n\nParagraph Alpha ends here.\n\nParagraph Beta ends here.\n';

async function runE1(): Promise<{ name: string; pass: boolean; detail: string }[]> {
  const checks: { name: string; pass: boolean; detail: string }[] = [];
  let remote: Remote | undefined;
  let relay: RelayHarnessHandle | undefined;
  let alice: LiveEditor | undefined;
  let bob: LiveEditor | undefined;
  try {
    remote = await makeRemote({ branch: BRANCH, files: { [E1_PATH]: E1_FIXTURE } });
    const dataDir = (await makeTempDir('phraise-gateE1-relay-')).path;
    relay = await startRelayHarness({ remote: remote.url, dataDir });
    const docName = makeDocName(BRANCH, E1_PATH, 0);

    const verifyCache = (await makeTempDir('phraise-gateE1-verify-')).path;
    const verifyStore = new GitStore({ cacheDir: verifyCache, remoteUrl: remote.url });
    await verifyStore.init();
    const originalHead = await verifyStore.remoteHead(BRANCH);
    if (!originalHead) throw new Error('gate E1: remote has no head');

    alice = await createLiveEditor({ url: relay.wsUrl, docName, token: 'alice' });
    bob = await createLiveEditor({ url: relay.wsUrl, docName, token: 'bob' });
    const posA = findPos(alice.view, (n) => n.type.name === 'paragraph' && n.textContent.includes('Alpha'));
    const nodeA = alice.view.state.doc.nodeAt(posA)!;
    insertText(alice.view, posA + nodeA.nodeSize - 1, ' fromAlice');
    await waitUntil(() => bob!.view.state.doc.textContent.includes('fromAlice'), 5000);
    const posB = findPos(bob.view, (n) => n.type.name === 'paragraph' && n.textContent.includes('Beta'));
    const nodeB = bob.view.state.doc.nodeAt(posB)!;
    insertText(bob.view, posB + nodeB.nodeSize - 1, ' fromBob');
    await waitUntil(() => alice!.view.state.doc.textContent.includes('fromBob'), 5000);
    await new Promise((r) => setTimeout(r, 150));

    const commitRes = await postJSON(relay.baseUrl, '/commit', { branch: BRANCH, path: E1_PATH, user: 'alice', message: 'Edit the document' });
    checks.push({ name: 'commit succeeds', pass: commitRes.status === 200 && commitRes.body.ok === true, detail: JSON.stringify(commitRes.body) });
    const newCommit: string | undefined = commitRes.body.commit;

    await verifyStore.fetch(BRANCH);
    const newHead = await verifyStore.remoteHead(BRANCH);
    checks.push({ name: 'the branch head is the new commit', pass: newHead === newCommit, detail: `${newHead} vs ${newCommit}` });

    if (newCommit) {
      const info = await verifyStore.commitInfo(newCommit);
      checks.push({ name: 'the commit\'s author is alice', pass: info.author.name === 'alice', detail: JSON.stringify(info.author) });
      checks.push({
        name: 'the message has a Co-authored-by trailer for bob and not for alice',
        pass: info.message.includes('Co-authored-by: bob <bob@users.phraise.test>') && !info.message.includes('Co-authored-by: alice'),
        detail: info.message,
      });
      checks.push({ name: 'the commit\'s parent is the previous head', pass: info.parents[0] === originalHead, detail: `${info.parents[0]} vs ${originalHead}` });
    }

    // --- stale commit: someone else pushes first ---
    const other = await makeClone(remote.url, { branch: BRANCH });
    await other.write(E1_PATH, `${E1_FIXTURE}\n\nPushed by someone else.\n`);
    const othersCommit = await other.commitAndPush('someone else commits first');
    await other.cleanup();

    // alice's document's own base is still `newCommit` (the relay's head
    // poller has not ticked and nobody called POST /poll), so this commit
    // attempt finds its expected head stale. Brief 06 task 3 changed the
    // charter's milestone-1 "refused" outcome to "rebases first, then
    // succeeds" (gate F's own last bullet exercises the live-editor version
    // of exactly this path); this replaces the old
    // "refused/branch-unchanged" pair of checks with "rebases and
    // succeeds, on top of the external commit, with both texts present".
    insertText(alice.view, alice.view.state.doc.content.size - 1, ' more');
    await new Promise((r) => setTimeout(r, 150));
    const secondCommitRes = await postJSON(relay.baseUrl, '/commit', { branch: BRANCH, path: E1_PATH, user: 'alice', message: 'Should rebase over the external commit and succeed' });
    checks.push({
      name: 'a commit after the head moved rebases first (not polled yet) and succeeds',
      pass: secondCommitRes.status === 200 && secondCommitRes.body.ok === true && secondCommitRes.body.rebased === true,
      detail: JSON.stringify(secondCommitRes.body),
    });

    if (secondCommitRes.body.ok) {
      await verifyStore.fetch(BRANCH);
      const secondCommit: string = secondCommitRes.body.commit;
      const info2 = await verifyStore.commitInfo(secondCommit);
      checks.push({ name: "the second commit's parent is the external commit", pass: info2.parents[0] === othersCommit, detail: `${info2.parents[0]} vs ${othersCommit}` });
      const text2 = await verifyStore.readFile(secondCommit, E1_PATH);
      checks.push({
        name: "the committed text contains both the external addition and alice's rebased edit",
        pass: !!text2 && text2.includes('Pushed by someone else') && text2.includes('more'),
        detail: text2 ?? '(missing)',
      });
    }
  } finally {
    alice?.destroy();
    bob?.destroy();
    if (relay) await relay.stop();
    if (remote) await remote.cleanup();
  }
  return checks;
}

// --- E2 ---------------------------------------------------------------------

interface FileEditPlan {
  fileId: string;
  path: string;
  markdown: string;
  edits: { from: number; to: number; original: string; replacement: string; paragraphPmStart: number }[];
  editedSpans: { startLine: number; endLine: number }[];
}

function planEdits(fileId: string, md: string): FileEditPlan | null {
  const { doc, positions } = parseMarkdown(md, { positions: true });
  const eligible = findEligibleWords(doc);
  if (eligible.length === 0) return null;
  const rng = mulberry32(stringHashSeed(fileId));
  const count = Math.min(1 + randInt(rng, 3), eligible.length); // 1 to 3
  const chosenIdx = new Set<number>();
  while (chosenIdx.size < count) chosenIdx.add(randInt(rng, eligible.length));
  const chosen = [...chosenIdx].map((i) => eligible[i]).sort((a, b) => b.from - a.from); // rightmost first, so earlier positions stay valid

  const spans = topLevelSpans({ doc, positions: positions ?? [] });
  const editedSpans: { startLine: number; endLine: number }[] = [];
  const edits = chosen.map((w) => {
    // The word's own paragraph may be nested (list/blockquote); attribute it to the enclosing TOP-LEVEL block's line span.
    let span = spans.find((s) => w.from >= s.pmStart && w.from < s.pmEnd);
    if (!span) span = spans[spans.length - 1];
    editedSpans.push({ startLine: span.startLine, endLine: span.endLine });
    return { from: w.from, to: w.to, original: w.word, replacement: replacementFor(w.word), paragraphPmStart: w.paragraphPmStart };
  });
  return { fileId, path: `real/${fileId.replace(/\//g, '-')}.md`, markdown: md, edits, editedSpans };
}

export async function run(opts: { quick?: boolean } = {}): Promise<GateEResult> {
  const e1Checks = await runE1();

  const targetCount = opts.quick ? 10 : 50;
  const real = loadCorpus(false).real;
  const rng = mulberry32(stringHashSeed('gate-e2-file-selection'));
  const shuffled = [...real];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = randInt(rng, i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const plans: FileEditPlan[] = [];
  for (const f of shuffled) {
    if (plans.length >= targetCount) break;
    const plan = planEdits(f.id, f.md);
    if (plan) plans.push(plan);
  }

  const e2Checks: { name: string; pass: boolean; detail: string }[] = [];
  let violations = 0;
  let totalEdits = 0;
  const violatingFiles: string[] = [];

  if (plans.length < targetCount) {
    e2Checks.push({ name: `at least ${targetCount} eligible corpus files found`, pass: false, detail: `only found ${plans.length} (corpus fetched? npm run fetch)` });
  } else {
    e2Checks.push({ name: `at least ${targetCount} eligible corpus files found`, pass: true, detail: `${plans.length} files: ${plans.map((p) => p.fileId).join(', ')}` });

    let remote: Remote | undefined;
    let relay: RelayHarnessHandle | undefined;
    try {
      const files: Record<string, string> = {};
      for (const p of plans) files[p.path] = p.markdown;
      remote = await makeRemote({ branch: BRANCH, files });
      const dataDir = (await makeTempDir('phraise-gateE2-relay-')).path;
      relay = await startRelayHarness({ remote: remote.url, dataDir });

      const verifyCache = (await makeTempDir('phraise-gateE2-verify-')).path;
      const verifyStore = new GitStore({ cacheDir: verifyCache, remoteUrl: remote.url });
      await verifyStore.init();

      for (const plan of plans) {
        const docName = makeDocName(BRANCH, plan.path, 0);
        const editor = await createLiveEditor({ url: relay.wsUrl, docName, token: 'editor' });
        try {
          for (const edit of plan.edits) {
            replaceWord(editor.view, edit.from, edit.to, edit.replacement);
          }
          await new Promise((r) => setTimeout(r, 80));
          totalEdits += plan.edits.length;

          const originalHead = await verifyStore.remoteHead(BRANCH);
          const commitRes = await postJSON(relay.baseUrl, '/commit', { branch: BRANCH, path: plan.path, user: 'editor', message: `Edit ${plan.fileId}` });
          if (!commitRes.body.ok) {
            violations++;
            violatingFiles.push(`${plan.fileId} (commit failed: ${JSON.stringify(commitRes.body)})`);
            continue;
          }
          await verifyStore.fetch(BRANCH);
          const newText = await verifyStore.readFile(commitRes.body.commit, plan.path);
          if (newText === undefined || originalHead === null) {
            violations++;
            violatingFiles.push(`${plan.fileId} (missing blob after commit)`);
            continue;
          }
          const hunks = computeLcsHunks(plan.markdown, newText);
          const contained = hunks.every((h) => plan.editedSpans.some((span) => hunksContained([h], span.startLine, span.endLine)));
          if (!contained) {
            violations++;
            violatingFiles.push(`${plan.fileId}: ${firstHunkExcerpt(plan.markdown, hunks)}`);
          }
        } finally {
          editor.destroy();
        }
      }
    } finally {
      if (relay) await relay.stop();
      if (remote) await remote.cleanup();
    }

    e2Checks.push({
      name: '0 containment violations across the committed corpus edits',
      pass: violations === 0,
      detail: violations === 0 ? `${plans.length} files, ${totalEdits} edits, 0 violations` : `${violations} violations: ${violatingFiles.slice(0, 5).join(' | ')}`,
    });
  }

  const checks = [...e1Checks, ...e2Checks];
  const pass = checks.every((c) => c.pass);
  return {
    gate: 'E',
    pass,
    summary: pass ? `all ${checks.length} checks passed` : checks.filter((c) => !c.pass).map((c) => `${c.name}: ${c.detail}`).join('; '),
    numbers: { checks: checks.length, e2Files: plans.length, e2Edits: totalEdits, e2Violations: violations },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run({ quick: process.argv.includes('--quick') }).then((r) => {
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.pass ? 0 : 1);
  });
}
