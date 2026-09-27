// Gate F (charter): "Spike 2's rebase scenario, its gates A to D, runs on
// the stack with live editors connected during the rebase. For stack 14
// this requires the fork-at-snapshot and deterministic client ID
// techniques to exist there; report what had to change."
//
// Brief 06. Ports spike 2's own scenario (src/rebase/gates/scenario.ts:
// MD_A -> MD_B, alice online, bob offline, two comments planted at commit
// A) from its in-memory Replica harness onto the real stack: this
// package's own Hocuspocus relay (src/relay-hocuspocus.ts's `rebase:`
// documents, `POST /rebase/<docName>`) and two live ProseMirror
// EditorViews (src/rebase/liveClient.ts), with the integration hook
// (src/rebase/liveIntegration.ts) wired the same way a real deployment
// would need it, not spike 2's `Replica.receive()`. Same shape as stack
// 13's own gate F (brief 05); ported onto Yjs 14 primitives.
//
// What had to change from spike 2 AND from stack 13's port (full account;
// also in this package's README and the session log):
//  1. Same as stack 13: the per-replica "P = state just before this batch"
//     step spike 2's `Replica.receive()` did inline is reimplemented with
//     the Y.Doc's own `beforeTransaction`/`afterTransaction` events
//     (src/rebase/liveIntegration.ts) -- confirmed unchanged on `@y/y`'s Doc
//     before relying on it (not assumed from stack 13's port).
//  2. Same as stack 13: the relay is a replica too and needed its own copy
//     of that hook, plus the relay-ack-immediately fix for the exact same
//     root cause stack 13 found by running its own gate F (its brief-05
//     log has the full trace) -- ported here proactively as part of
//     src/relay-hocuspocus.ts's /rebase route rather than rediscovered by
//     reproducing the bug fresh.
//  3. Different from stack 13: task 2's diff emitter is NOT spike 2's
//     hand-rolled word/char/block diff retargeted to a new tree API. It is
//     `lib0/delta`'s own public `diff()` over `@y/prosemirror`'s
//     `docToDelta` snapshots (src/rebase/diff.ts's header has the full
//     account of why, and why this is not a downgrade).
//  4. Different from stack 13: spike 2's schema needed no y-tiptap-style
//     workaround plugins there either, but for a different, stronger
//     reason here -- `@y/prosemirror`'s binding has neither of stack 13's
//     two known losses structurally at all (src/yjs.ts's header), not
//     merely "this particular schema doesn't trigger them".
//  5. Different from stack 13: no `y-prosemirror` import retargeting was
//     needed in seed.ts/diff.ts (this stack's own binding, `@y/prosemirror`,
//     was used directly from the start).
//  6. Same as stack 13: `gc:false` is required on both the relay
//     (Hocuspocus's `yDocOptions`) and every live client's `Y.Doc`.
//  7. Different from stack 13: `Y.Doc`/`Y.Map`/`Y.XmlElement`/`Y.XmlText`
//     become `Y.Doc`/`Y.Node` throughout (unified type), and
//     `Y.isDeleted(ds, id)` has no Yjs14 equivalent -- `isVisibleAt`
//     (src/rebase/integrate.ts) is a verified hand-port of `@y/y`'s own
//     (unexported) `isVisible`, using `IdSet#hasId`.
//
// Delivery model difference from spike 2 (same as stack 13, stated
// plainly): Hocuspocus's real y-protocols sync is bidirectional and
// automatic on (re)connect -- there is no "deliver one update at a time"
// hook here, so this gate does not repeat spike 2's own gate D permutation/
// shuffle sweep (already run headlessly against this port in
// scripts/rebase-baseline.ts); it relies on Hocuspocus's own protocol to
// deliver bob's offline edits and the relay's rebase correctly on
// reconnect, which is exactly the real-world case gate F exists to
// exercise instead.
import 'global-jsdom/register';
import fs from 'node:fs';
import path from 'node:path';
import * as Y from 'yjs';
import { startRelay, type RelayHandle } from '../src/harness.js';
import { createRebaseLiveClient, type RebaseLiveClient } from '../src/rebase/liveClient.js';
import { waitUntil } from '../src/client-hocuspocus.js';
import { findPos, insertText } from './lib/edits.js';
import { addComment, resolveComment, type ResolvedRange } from '../src/rebase/comments.js';
import { docPlainText } from '../src/rebase/text.js';
import { docToPM, PM_FRAGMENT } from '../src/rebase/seed.js';
import { needsReview, REVIEW_MAP, collectBlocks, isVisibleAt } from '../src/rebase/integrate.js';
import { canonicalJSON } from '../src/rebase/gates/convergence.js';
import { DOC_ID, MD_A, MD_B, AUTHOR_B, labelBlocks, type Labels } from '../src/rebase/gates/scenario.js';

export interface GateFCheck {
  name: string;
  pass: boolean;
  detail: string;
}
export interface GateFResult {
  pass: boolean;
  checks: GateFCheck[];
  detail: string;
}

const SEEDS_ROOT = 'fixtures';
const REBASE_SEED_DIR = path.join(SEEDS_ROOT, 'rebase');

function docNameFor(id: string): string {
  return `rebase:${id}`;
}

function writeSeedFile(id: string, markdown: string): void {
  fs.mkdirSync(REBASE_SEED_DIR, { recursive: true });
  fs.writeFileSync(path.join(REBASE_SEED_DIR, `${id}.md`), markdown);
}

function findOffset(text: string, needle: string): number {
  const i = text.indexOf(needle);
  if (i < 0) throw new Error(`gate F: fixture text not found: ${JSON.stringify(needle)}`);
  return i;
}

function paraPos(view: import('prosemirror-view').EditorView, needle: string): number {
  const pos = findPos(view, (n) => (n.type.name === 'paragraph' || n.type.name === 'heading') && n.textContent.includes(needle));
  if (pos === -1) throw new Error(`gate F: no block containing ${JSON.stringify(needle)}`);
  const node = view.state.doc.nodeAt(pos)!;
  return pos + node.nodeSize - 1; // end of the block, before typing more
}

async function waitUntilAsync(check: () => Promise<boolean>, timeoutMs = 5000, intervalMs = 20): Promise<void> {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > timeoutMs) throw new Error(`waitUntilAsync: condition not met within ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

async function fetchRelayDoc(relay: RelayHandle, docName: string): Promise<Y.Doc> {
  const bytes = await relay.fetchState(docName);
  const scratch = new Y.Doc({ gc: false });
  if (bytes.length > 0) Y.applyUpdate(scratch, bytes);
  return scratch;
}

async function postRebase(relay: RelayHandle, docName: string, targetMarkdown: string, targetCommit: string): Promise<{ applied: boolean; rebaseId?: string; reason?: string; error?: string }> {
  const res = await fetch(`${relay.baseUrl}/rebase/${encodeURIComponent(docName)}`, {
    method: 'POST',
    body: JSON.stringify({
      targetMarkdown,
      targetCommit,
      authorName: AUTHOR_B.name,
      authorEmail: AUTHOR_B.email,
    }),
  });
  return (await res.json()) as { applied: boolean; rebaseId?: string; reason?: string; error?: string };
}

interface MainScenario {
  relay: RelayHandle;
  alice: RebaseLiveClient;
  bob: RebaseLiveClient;
  labels: Labels;
  comments: { untouched: string; rewritten: string; deleted: string };
  docName: string;
}

async function buildMainScenario(port: number, dbPath: string): Promise<MainScenario> {
  fs.rmSync(dbPath, { force: true });
  const docName = docNameFor(DOC_ID);
  writeSeedFile(DOC_ID, MD_A);
  const relay = await startRelay({ port, db: dbPath, seeds: SEEDS_ROOT });

  const alice = await createRebaseLiveClient({ url: relay.wsUrl, docName, token: 'alice' });
  const bob = await createRebaseLiveClient({ url: relay.wsUrl, docName, token: 'bob' });

  const labels = labelBlocks(alice.ydoc);

  const textA = docPlainText(alice.ydoc).text;
  const untouchedStart = findOffset(textA, 'never touched by anyone');
  const untouched = addComment(alice.ydoc, untouchedStart, untouchedStart + 'never touched by anyone'.length, 'looks good', { userId: 'srv', name: 'server' });
  const rewrittenQuote = 'plan for the rollout';
  const rewrittenStart = findOffset(textA, rewrittenQuote);
  const rewritten = addComment(alice.ydoc, rewrittenStart, rewrittenStart + rewrittenQuote.length, 'keep this', { userId: 'srv', name: 'server' });
  const deletedStart = findOffset(textA, 'old lighthouse keeper');
  const deleted = addComment(alice.ydoc, deletedStart, deletedStart + 'old lighthouse keeper'.length, 'this needs a source', { userId: 'srv', name: 'server' });

  await waitUntil(() => bob.view.state.doc.textContent.includes('never touched by anyone'), 5000);

  bob.websocketProvider.disconnect();
  const pPosBob = paraPos(bob.view, 'Paragraph P holds');
  insertText(bob.view, pPosBob - "Paragraph P holds bob's offline draft notes before anyone else changes it.".length, 'BOB EDIT: ');
  const p2PosBob = paraPos(bob.view, 'Paragraph P2 holds');
  insertText(bob.view, p2PosBob - "Paragraph P2 holds more of bob's offline notes, later removed upstream.".length, 'BOB P2 EDIT: ');

  const qPosAlice = paraPos(alice.view, 'Paragraph Q holds');
  insertText(alice.view, qPosAlice - "Paragraph Q holds alice's online draft notes before anyone else changes it.".length, 'ALICE EDIT: ');
  await waitUntilAsync(async () => {
    const relayDoc = await fetchRelayDoc(relay, docName);
    return docToPM(relayDoc).textContent.includes('ALICE EDIT');
  }, 5000);

  return { relay, alice, bob, labels, comments: { untouched, rewritten, deleted }, docName };
}

async function reconnectBobAndConverge(scn: MainScenario): Promise<void> {
  const { relay, alice, bob, docName } = scn;
  await waitUntil(() => alice.view.state.doc.textContent.toLowerCase().includes('revised'), 5000);
  bob.websocketProvider.connect();
  await waitUntil(() => bob.view.state.doc.textContent.includes('BOB EDIT'), 5000);
  await waitUntil(() => bob.view.state.doc.textContent.toLowerCase().includes('revised'), 5000);
  await new Promise((r) => setTimeout(r, 300));
  await waitUntilAsync(async () => {
    const relayDoc = await fetchRelayDoc(relay, docName);
    return docToPM(relayDoc).textContent.toLowerCase().includes('revised');
  }, 5000);
}

export async function runGateF(opts: { port: number; dbPath: string }): Promise<GateFResult> {
  const checks: GateFCheck[] = [];
  let relay: RelayHandle | undefined;
  let alice: RebaseLiveClient | undefined;
  let bob: RebaseLiveClient | undefined;
  try {
    const scn = await buildMainScenario(opts.port, opts.dbPath);
    relay = scn.relay;
    alice = scn.alice;
    bob = scn.bob;

    const rebaseResult = await postRebase(relay, scn.docName, MD_B, 'B');
    checks.push({
      name: 'Rebase applied while alice online, bob offline',
      pass: rebaseResult.applied === true,
      detail: JSON.stringify(rebaseResult),
    });

    await reconnectBobAndConverge(scn);

    const relayDoc = await fetchRelayDoc(relay, scn.docName);

    const pmAlice = canonicalJSON(alice.view.state.doc.toJSON());
    const pmBob = canonicalJSON(bob.view.state.doc.toJSON());
    const pmRelay = canonicalJSON(docToPM(relayDoc).toJSON());
    const pmConverged = pmAlice === pmBob && pmBob === pmRelay;
    checks.push({
      name: 'Convergence: alice, bob and the relay have identical ProseMirror JSON',
      pass: pmConverged,
      detail: pmConverged ? 'identical' : `alice==bob:${pmAlice === pmBob} bob==relay:${pmBob === pmRelay}`,
    });

    const reviewAlice = canonicalJSON((alice.ydoc.get(REVIEW_MAP) as any).getAttrs());
    const reviewBob = canonicalJSON((bob.ydoc.get(REVIEW_MAP) as any).getAttrs());
    const reviewRelay = canonicalJSON((relayDoc.get(REVIEW_MAP) as any).getAttrs());
    const reviewConverged = reviewAlice === reviewBob && reviewBob === reviewRelay;
    checks.push({
      name: 'Convergence: alice, bob and the relay have identical review state',
      pass: reviewConverged,
      detail: reviewConverged ? 'identical' : `alice==bob:${reviewAlice === reviewBob} bob==relay:${reviewBob === reviewRelay}`,
    });

    const resolvedUntouched: Record<string, ResolvedRange> = {
      alice: resolveComment(alice.ydoc, scn.comments.untouched),
      bob: resolveComment(bob.ydoc, scn.comments.untouched),
      relay: resolveComment(relayDoc, scn.comments.untouched),
    };
    const aOk = Object.values(resolvedUntouched).every((r) => r.method === 'crdt' && r.text === 'never touched by anyone');
    checks.push({
      name: 'A: untouched-paragraph comment resolves via crdt on alice, bob and the relay',
      pass: aOk,
      detail: JSON.stringify(resolvedUntouched),
    });

    const resolvedRewritten: Record<string, ResolvedRange> = {
      alice: resolveComment(alice.ydoc, scn.comments.rewritten),
      bob: resolveComment(bob.ydoc, scn.comments.rewritten),
      relay: resolveComment(relayDoc, scn.comments.rewritten),
    };
    const bOk = Object.values(resolvedRewritten).every((r) => (r.method === 'crdt' || r.method === 'fuzzy') && r.text === 'plan for the rollout');
    checks.push({
      name: 'B: rewritten-paragraph comment survives (anchor or quote) on alice, bob and the relay',
      pass: bOk,
      detail: JSON.stringify(resolvedRewritten),
    });

    const resolvedDeleted: Record<string, ResolvedRange> = {
      alice: resolveComment(alice.ydoc, scn.comments.deleted),
      bob: resolveComment(bob.ydoc, scn.comments.deleted),
      relay: resolveComment(relayDoc, scn.comments.deleted),
    };
    const cOk = Object.values(resolvedDeleted).every(
      (r) => r.method === 'orphaned' && r.quote?.exact === 'old lighthouse keeper' && (r.method !== ('fuzzy' as any) || !(r.text ?? '').includes('harbor'))
    );
    checks.push({
      name: 'C: deleted-paragraph comment orphans, quote kept, negative control (harbor) not captured',
      pass: cOk,
      detail: JSON.stringify(resolvedDeleted),
    });

    const entriesAlice = needsReview(alice.ydoc);
    const flaggedAlice = new Set(entriesAlice.map((e) => e.blockId));
    const pFlagged = flaggedAlice.has(scn.labels.pId);
    const qFlagged = flaggedAlice.has(scn.labels.qId);
    const textAlice = alice.view.state.doc.textContent;
    const textBob = bob.view.state.doc.textContent;
    const textRelay = docToPM(relayDoc).textContent;
    const survivesEverywhere = (needle: string) => [textAlice, textBob, textRelay].every((t) => t.includes(needle));
    const dTextOk = survivesEverywhere('BOB EDIT:') && survivesEverywhere('ALICE EDIT:') && survivesEverywhere("server's revised draft notes");
    const unexpectedFlags = entriesAlice.filter(
      (f) => f.blockId !== scn.labels.pId && f.blockId !== scn.labels.qId && f.reason !== 'deleted-upstream-edited-locally'
    );
    checks.push({
      name: 'D: P and Q flagged concurrent-edit; offline (bob) and online (alice) upstream-conflicting text both survive; no unexpected flags',
      pass: pFlagged && qFlagged && dTextOk && unexpectedFlags.length === 0,
      detail: `pFlagged=${pFlagged} qFlagged=${qFlagged} textOk=${dTextOk} unexpected=${JSON.stringify(unexpectedFlags)}`,
    });

    const p2Original = collectBlocks(alice.ydoc.get(PM_FRAGMENT)).find((b) => b.id === scn.labels.p2Id);
    const p2Deleted = !!p2Original && !isVisibleAt(p2Original.item, undefined);
    const resurrections = entriesAlice.filter((f) => f.reason === 'deleted-upstream-edited-locally' && f.text.includes('BOB P2 EDIT'));
    const d2Ok = p2Deleted && resurrections.length === 1 && survivesEverywhere('BOB P2 EDIT');
    checks.push({
      name: 'D2: P2 (deleted upstream, edited offline by bob) resurrected exactly once, flagged, converged',
      pass: d2Ok,
      detail: `p2Deleted=${p2Deleted} resurrections=${resurrections.length} survivesEverywhere=${survivesEverywhere('BOB P2 EDIT')}`,
    });

    const untouchedTexts = [
      'This introductory paragraph is never touched by anyone during the rebase.',
      'The lighthouse by the harbor stayed lit every night that whole winter season.',
      'The first list item never changes at all.',
      'The third list item never changes at all.',
    ];
    const untouchedOk = untouchedTexts.every((t) => survivesEverywhere(t));
    checks.push({
      name: 'Every block nobody touched equals commit B, on alice, bob and the relay',
      pass: untouchedOk,
      detail: untouchedOk ? 'all present' : untouchedTexts.filter((t) => !survivesEverywhere(t)).join(' | '),
    });

    const beforeRetryPM = pmRelay;
    const beforeRetryReview = reviewRelay;
    const retry = await postRebase(relay, scn.docName, MD_B, 'B');
    await new Promise((r) => setTimeout(r, 200));
    const relayDocAfterRetry = await fetchRelayDoc(relay, scn.docName);
    const afterRetryPM = canonicalJSON(docToPM(relayDocAfterRetry).toJSON());
    const afterRetryReview = canonicalJSON((relayDocAfterRetry.get(REVIEW_MAP) as any).getAttrs());
    const retryOk = retry.applied === false && afterRetryPM === beforeRetryPM && afterRetryReview === beforeRetryReview;
    checks.push({
      name: 'A retried rebase changes nothing',
      pass: retryOk,
      detail: `${JSON.stringify(retry)}; pmUnchanged=${afterRetryPM === beforeRetryPM} reviewUnchanged=${afterRetryReview === beforeRetryReview}`,
    });

    const pass = checks.every((c) => c.pass);
    return { pass, checks, detail: pass ? 'all checks passed' : checks.filter((c) => !c.pass).map((c) => c.name).join('; ') };
  } finally {
    alice?.destroy();
    bob?.destroy();
    if (relay) await relay.stop();
  }
}

// --- Variant: alice types continuously while the rebase is applied ---
export async function runGateFContinuousTyping(opts: { port: number; dbPath: string }): Promise<GateFCheck> {
  const docId = `${DOC_ID}-continuous`;
  const docName = docNameFor(docId);
  fs.rmSync(opts.dbPath, { force: true });
  writeSeedFile(docId, MD_A);
  let relay: RelayHandle | undefined;
  let alice: RebaseLiveClient | undefined;
  let bob: RebaseLiveClient | undefined;
  try {
    relay = await startRelay({ port: opts.port, db: opts.dbPath, seeds: SEEDS_ROOT });
    alice = await createRebaseLiveClient({ url: relay.wsUrl, docName, token: 'alice' });
    bob = await createRebaseLiveClient({ url: relay.wsUrl, docName, token: 'bob' });
    await waitUntil(() => bob!.view.state.doc.textContent.includes('never touched by anyone'), 5000);

    const untouchedPos = paraPos(alice.view, 'never touched by anyone');
    let typingDone = false;
    const typing = (async () => {
      let pos = untouchedPos;
      for (let i = 0; i < 40; i++) {
        pos = insertText(alice!.view, pos, 'x');
        await new Promise((r) => setTimeout(r, 5));
      }
      typingDone = true;
    })();

    await new Promise((r) => setTimeout(r, 60));
    const rebasePromise = postRebase(relay, docName, MD_B, 'B');

    await typing;
    const rebaseResult = await rebasePromise;

    await waitUntil(() => bob!.view.state.doc.textContent.toLowerCase().includes('revised'), 5000);
    await new Promise((r) => setTimeout(r, 300));
    const relayDoc = await fetchRelayDoc(relay, docName);

    const pmAlice = canonicalJSON(alice.view.state.doc.toJSON());
    const pmBob = canonicalJSON(bob.view.state.doc.toJSON());
    const pmRelay = canonicalJSON(docToPM(relayDoc).toJSON());
    const converged = pmAlice === pmBob && pmBob === pmRelay;
    const hasIntactRun = alice.view.state.doc.textContent.includes('x'.repeat(40)) && !alice.view.state.doc.textContent.includes('x'.repeat(41));
    const pass = typingDone && rebaseResult.applied === true && converged && hasIntactRun;
    return {
      name: 'Variant: alice types continuously while the rebase is applied; still converges',
      pass,
      detail: `typingDone=${typingDone} rebaseApplied=${rebaseResult.applied} converged=${converged} intactRunOf40Xs=${hasIntactRun}`,
    };
  } finally {
    alice?.destroy();
    bob?.destroy();
    if (relay) await relay.stop();
  }
}
