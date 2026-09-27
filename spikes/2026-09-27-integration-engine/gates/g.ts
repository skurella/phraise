// Gate G (charter milestone 2, brief 06 task 6): "Offline return. An
// editor that was offline through a rebase and a commit returns and
// converges with nothing lost."
//
// bob disconnects (the editor keeps working locally -- `LiveEditor.disconnect()`
// tears down only the websocket transport, per src/testkit/editor.ts's own
// comment). While he is offline: someone pushes an external commit that
// rewrites one paragraph and deletes another; `POST /poll` rebases the
// relay's (and alice's, still connected) live document; alice edits a
// third paragraph and commits. Bob, still offline throughout, edits (based
// on his own stale view) an untouched paragraph, the rewritten paragraph,
// and the deleted paragraph, each with a distinct token
// (src/testkit/tokens.ts). Bob reconnects: this is deliberately NOT
// special-cased anywhere -- reconnecting is an ordinary Hocuspocus/Yjs
// sync (bidirectional state-vector exchange), and the SAME
// `attachIntegration` hook every live editor already runs (plan section 5)
// processes whatever rebase records bob has not yet acked, on his own
// reconnect batch, using his own pre-reconnect state as the "before"
// snapshot -- so the deleted-but-bob-edited paragraph resurrects through
// exactly the same mechanism gate F's D2 case exercises, not a special
// "offline return" code path.
//
// Two variants: `runVariant(1)` is the scenario above; `runVariant(2)`
// repeats the external-commit-then-alice-commits round twice while bob
// stays offline through both, then bob edits blocks from BOTH rounds
// before reconnecting.
import 'global-jsdom/register';
import * as Y from 'yjs';
import { startRelayHarness, type RelayHarnessHandle } from '../src/testkit/relayHarness.js';
import { createLiveEditor, waitUntil, type LiveEditor } from '../src/testkit/editor.js';
import { insertText, findPos } from '../src/testkit/edits.js';
import { makeRemote, makeClone, type Remote } from '../src/testkit/remote.js';
import { makeTempDir } from '../src/testkit/tmp.js';
import { GitStore } from '../src/git/index.js';
import { makeDocName } from '../src/relay/index.js';
import { listReview } from '../src/engine/index.js';
import { read } from '../src/crdt/index.js';
import { makeToken } from '../src/testkit/tokens.js';

export interface GateGResult {
  gate: 'G';
  pass: boolean;
  summary: string;
  numbers: Record<string, number>;
}

const BRANCH = 'main';
const PATH_MD = 'doc.md';

function paraEndPos(view: import('prosemirror-view').EditorView, needle: string): number {
  const pos = findPos(view, (n) => n.type.name === 'paragraph' && n.textContent.includes(needle));
  if (pos === -1) throw new Error(`gate G: no paragraph containing ${JSON.stringify(needle)}`);
  const node = view.state.doc.nodeAt(pos)!;
  return pos + node.nodeSize - 1;
}

async function postJSON(baseUrl: string, path: string, body: unknown): Promise<{ status: number; body: any }> {
  const res = await fetch(`${baseUrl}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}

async function fetchRelayDoc(baseUrl: string, docName: string): Promise<Y.Doc> {
  const res = await fetch(`${baseUrl}/state/${encodeURIComponent(docName)}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const scratch = new Y.Doc({ gc: false });
  if (bytes.length > 0) Y.applyUpdate(scratch, bytes);
  return scratch;
}

function rewriteNeedle(round: number): string {
  return `Paragraph RewriteRound${round} holds text external commit round ${round} rewrites.`;
}

function deletedParagraph(round: number): string {
  return `Paragraph DeletedRound${round} holds text external commit round ${round} removes entirely.\n\n`;
}

/** The document's initial (seed-commit) text: every round's rewrite/delete target present in its ORIGINAL form. */
function initialDocumentText(rounds: number): string {
  const parts = ['# Doc', '', 'Paragraph BobUntouched holds text bob edits offline with no upstream conflict at all.', ''];
  for (let i = 1; i <= rounds; i++) {
    parts.push(rewriteNeedle(i), '', `Paragraph DeletedRound${i} holds text external commit round ${i} removes entirely.`, '');
  }
  parts.push('Paragraph AliceBlock holds text alice edits online and commits after each round.', '');
  return parts.join('\n');
}

/**
 * Applies round `round`'s external change to `text` (the branch's CURRENT
 * content, as an external committer would actually see it -- including
 * whatever alice has already committed in earlier rounds): a targeted
 * rewrite of one paragraph's text and a targeted removal of another,
 * leaving everything else (crucially, alice's own prior edits) untouched.
 * Deliberately NOT a from-scratch template rebuild: an earlier version of
 * this gate regenerated the whole document from a template every round,
 * which silently discarded alice's previous round's already-committed
 * edit the moment the next external commit "overwrote" the file --
 * exactly the kind of bug this gate exists to catch in the PRODUCT, so the
 * gate itself must not commit it in the harness.
 */
function applyRound(text: string, round: number): string {
  let out = text.replace(rewriteNeedle(round), `Paragraph RewriteRound${round} was rewritten by external commit round ${round}.`);
  out = out.replace(deletedParagraph(round), '');
  return out;
}

interface VariantResult {
  checks: { name: string; pass: boolean; detail: string }[];
  numbers: Record<string, number>;
}

async function runVariant(rounds: number): Promise<VariantResult> {
  const checks: VariantResult['checks'] = [];
  const numbers: Record<string, number> = {};
  let remote: Remote | undefined;
  let relay: RelayHarnessHandle | undefined;
  let alice: LiveEditor | undefined;
  let bob: LiveEditor | undefined;

  try {
    remote = await makeRemote({ branch: BRANCH, files: { [PATH_MD]: initialDocumentText(rounds) } });
    const dataDir = (await makeTempDir(`phraise-gateG${rounds}-relay-`)).path;
    relay = await startRelayHarness({ remote: remote.url, dataDir, timings: { pollMs: 600000 } });
    const docName = makeDocName(BRANCH, PATH_MD, 0);

    const verify = new GitStore({ cacheDir: (await makeTempDir(`phraise-gateG${rounds}-verify-`)).path, remoteUrl: remote.url });
    await verify.init();

    alice = await createLiveEditor({ url: relay.wsUrl, docName, token: 'alice' });
    bob = await createLiveEditor({ url: relay.wsUrl, docName, token: 'bob' });
    await waitUntil(() => bob!.view.state.doc.textContent.includes('BobUntouched'), 5000);

    // --- bob goes offline; the editor keeps working locally ---
    bob.disconnect();

    const bobRewriteTokens: string[] = [];
    const bobDeletedTokens: string[] = [];
    const aliceCommits: string[] = [];

    for (let round = 1; round <= rounds; round++) {
      const other = await makeClone(remote.url, { branch: BRANCH });
      const current = await other.git(['show', `HEAD:${PATH_MD}`]);
      await other.write(PATH_MD, applyRound(current, round));
      await other.commitAndPush(`external commit round ${round}: rewrite and delete`);
      await other.cleanup();

      const pollRes = await postJSON(relay.baseUrl, '/poll', {});
      const polled = (pollRes.body.polled as Array<{ branch: string; rebasedPaths: string[] }>).find((p) => p.branch === BRANCH);
      checks.push({
        name: `round ${round}: POST /poll detects the external commit and rebases`,
        pass: !!polled && polled.rebasedPaths.includes(PATH_MD),
        detail: JSON.stringify(pollRes.body),
      });
      await waitUntil(() => alice!.view.state.doc.textContent.includes(`was rewritten by external commit round ${round}`), 5000);

      const alicePos = paraEndPos(alice.view, 'Paragraph AliceBlock');
      insertText(alice.view, alicePos, ` ALICE-ROUND${round}`);
      await new Promise((r) => setTimeout(r, 100));

      const commitRes = await postJSON(relay.baseUrl, '/commit', { branch: BRANCH, path: PATH_MD, user: 'alice', message: `Alice's commit for round ${round}` });
      checks.push({ name: `round ${round}: alice's commit succeeds`, pass: commitRes.status === 200 && commitRes.body.ok === true, detail: JSON.stringify(commitRes.body) });
      if (commitRes.body.ok) aliceCommits.push(commitRes.body.commit);
    }

    // --- bob, still offline, edits an untouched paragraph, each round's rewritten paragraph, and each round's deleted paragraph -- based on his own stale view ---
    const untouchedToken = makeToken('bobUntouched');
    insertText(bob.view, paraEndPos(bob.view, 'BobUntouched'), ` ${untouchedToken}`);
    for (let round = 1; round <= rounds; round++) {
      const rewriteToken = makeToken(`bobRewrite${round}`);
      const deletedToken = makeToken(`bobDeleted${round}`);
      bobRewriteTokens.push(rewriteToken);
      bobDeletedTokens.push(deletedToken);
      insertText(bob.view, paraEndPos(bob.view, `RewriteRound${round}`), ` ${rewriteToken}`);
      insertText(bob.view, paraEndPos(bob.view, `DeletedRound${round}`), ` ${deletedToken}`);
    }

    // --- bob reconnects ---
    await bob.connect();
    await waitUntil(() => bob!.view.state.doc.textContent.includes(untouchedToken), 8000);
    for (const t of [...bobRewriteTokens, ...bobDeletedTokens]) {
      await waitUntil(() => bob!.view.state.doc.textContent.includes(t), 8000);
    }
    await waitUntil(() => alice!.view.state.doc.textContent.includes(untouchedToken), 8000);
    await new Promise((r) => setTimeout(r, 300)); // trailing acks/attribution settle

    const relayDoc = await fetchRelayDoc(relay.baseUrl, docName);
    const textAlice = alice.view.state.doc.textContent;
    const textBob = bob.view.state.doc.textContent;
    const textRelay = read(relayDoc).textContent;

    // --- convergence ---
    const pmAlice = JSON.stringify(alice.view.state.doc.toJSON());
    const pmBob = JSON.stringify(bob.view.state.doc.toJSON());
    const pmRelay = JSON.stringify(read(relayDoc).toJSON());
    const pmConverged = pmAlice === pmBob && pmBob === pmRelay;
    checks.push({ name: 'alice, bob and the relay converge to identical ProseMirror JSON', pass: pmConverged, detail: pmConverged ? 'identical' : `alice==bob:${pmAlice === pmBob} bob==relay:${pmBob === pmRelay}` });

    // --- every token bob typed offline is present, everywhere ---
    const everyoneHas = (needle: string) => [textAlice, textBob, textRelay].every((t) => t.includes(needle));
    const allBobTokens = [untouchedToken, ...bobRewriteTokens, ...bobDeletedTokens];
    const tokensOk = allBobTokens.every(everyoneHas);
    checks.push({ name: 'every token bob typed offline is present, on all three replicas', pass: tokensOk, detail: tokensOk ? 'ok' : JSON.stringify(allBobTokens.filter((t) => !everyoneHas(t))) });

    // --- each deleted-and-bob-edited block is resurrected exactly once, flagged deleted-upstream-edited-locally ---
    const entries = listReview(relayDoc);
    let resurrectionsOk = true;
    const resurrectionDetail: string[] = [];
    for (const token of bobDeletedTokens) {
      const matches = entries.filter((e) => e.reason === 'deleted-upstream-edited-locally' && e.text.includes(token));
      resurrectionsOk = resurrectionsOk && matches.length === 1;
      resurrectionDetail.push(`${token}: ${matches.length} match(es)`);
    }
    checks.push({ name: 'each deleted-and-bob-edited block is resurrected exactly once, flagged deleted-upstream-edited-locally', pass: resurrectionsOk, detail: resurrectionDetail.join('; ') });

    // --- upstream changes and alice's committed text are present ---
    const upstreamOk = Array.from({ length: rounds }, (_, i) => i + 1).every((round) => everyoneHas(`was rewritten by external commit round ${round}`));
    checks.push({ name: 'every round\'s upstream (external commit) change is present', pass: upstreamOk, detail: upstreamOk ? 'ok' : 'missing' });
    const aliceOk = Array.from({ length: rounds }, (_, i) => i + 1).every((round) => everyoneHas(`ALICE-ROUND${round}`));
    checks.push({ name: "every round's alice edit (already committed) is present", pass: aliceOk, detail: aliceOk ? 'ok' : 'missing' });

    // --- the next commit includes bob's offline text and lists bob as a co-author ---
    const finalCommitRes = await postJSON(relay.baseUrl, '/commit', { branch: BRANCH, path: PATH_MD, user: 'alice', message: 'Final commit including bob\'s offline return' });
    checks.push({ name: 'the next commit succeeds', pass: finalCommitRes.status === 200 && finalCommitRes.body.ok === true, detail: JSON.stringify(finalCommitRes.body) });
    if (finalCommitRes.body.ok) {
      checks.push({ name: 'the next commit lists bob as a co-author', pass: (finalCommitRes.body.coAuthors as string[]).includes('bob'), detail: JSON.stringify(finalCommitRes.body.coAuthors) });
      await verify.fetch(BRANCH);
      const info = await verify.commitInfo(finalCommitRes.body.commit);
      const trailerOk = info.message.includes('Co-authored-by: bob <bob@users.phraise.test>');
      checks.push({ name: "the commit message's trailer names bob", pass: trailerOk, detail: info.message });
      const committedText = (await verify.readFile(finalCommitRes.body.commit, PATH_MD)) ?? '';
      const committedHasAll = allBobTokens.every((t) => committedText.includes(t));
      checks.push({ name: "the committed file includes all of bob's offline text", pass: committedHasAll, detail: committedHasAll ? 'ok' : committedText });
    }

    numbers.rounds = rounds;
    numbers.checks = checks.length;
    return { checks, numbers };
  } finally {
    alice?.destroy();
    bob?.destroy();
    if (relay) await relay.stop();
    if (remote) await remote.cleanup();
  }
}

export async function run(_opts: { quick?: boolean } = {}): Promise<GateGResult> {
  const v1 = await runVariant(1);
  const v2 = await runVariant(2);

  const checks = [...v1.checks.map((c) => ({ ...c, name: `variant 1 (one round): ${c.name}` })), ...v2.checks.map((c) => ({ ...c, name: `variant 2 (two rounds): ${c.name}` }))];
  const pass = checks.every((c) => c.pass);
  return {
    gate: 'G',
    pass,
    summary: pass ? `all ${checks.length} checks passed` : checks.filter((c) => !c.pass).map((c) => `${c.name}: ${c.detail}`).join('; '),
    numbers: { checks: checks.length, variant1Checks: v1.numbers.checks, variant2Checks: v2.numbers.checks },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run({ quick: process.argv.includes('--quick') }).then((r) => {
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.pass ? 0 : 1);
  });
}
