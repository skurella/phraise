// Gate A (charter milestone 1): "The relay opens a path on a branch at the
// remote's head commit and seeds the document deterministically. Two live
// editors connect and see it." Brief 04 task 4: also checks the seeded
// relay state against an INDEPENDENT `engine.seedFromCommit` of the same
// inputs, byte for byte, and that both editors' documents serialize back
// to exactly the original file.
import 'global-jsdom/register';
import { startRelayHarness, type RelayHarnessHandle } from '../src/testkit/relayHarness.js';
import { createLiveEditor, type LiveEditor } from '../src/testkit/editor.js';
import { makeRemote, type Remote } from '../src/testkit/remote.js';
import { makeTempDir } from '../src/testkit/tmp.js';
import { GitStore } from '../src/git/index.js';
import { docId, makeDocName } from '../src/relay/index.js';
import { createDoc, encodeState } from '../src/crdt/index.js';
import { seedFromCommit } from '../src/engine/index.js';
import { renderDoc } from '../src/markdown/index.js';

export interface GateAResult {
  gate: 'A';
  pass: boolean;
  summary: string;
  numbers: Record<string, number>;
}

const BRANCH = 'main';
const PATH_MD = 'doc.md';
const FIXTURE = '# Live document\n\nParagraph Alpha ends here.\n\nParagraph Beta ends here.\n';

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

async function fetchState(baseUrl: string, docName: string): Promise<Uint8Array> {
  const res = await fetch(`${baseUrl}/state/${encodeURIComponent(docName)}`);
  return new Uint8Array(await res.arrayBuffer());
}

export async function run(opts: { quick?: boolean } = {}): Promise<GateAResult> {
  let remote: Remote | undefined;
  let relay: RelayHarnessHandle | undefined;
  let alice: LiveEditor | undefined;
  let bob: LiveEditor | undefined;
  const checks: { name: string; pass: boolean; detail: string }[] = [];

  try {
    remote = await makeRemote({ branch: BRANCH, files: { [PATH_MD]: FIXTURE } });
    const dataDir = (await makeTempDir('phraise-gateA-relay-')).path;
    relay = await startRelayHarness({ remote: remote.url, dataDir });

    // --- resolve, forcing the relay to seed the document ---
    const resolveRes = await fetch(`${relay.baseUrl}/resolve?branch=${BRANCH}&path=${encodeURIComponent(PATH_MD)}`);
    const resolved = (await resolveRes.json()) as { docName: string; generation: number };
    const expectedDocName = makeDocName(BRANCH, PATH_MD, 0);
    checks.push({ name: 'resolve returns the expected doc name', pass: resolved.docName === expectedDocName, detail: `${resolved.docName} vs ${expectedDocName}` });

    const relayBytes = await fetchState(relay.baseUrl, resolved.docName);

    // --- independent seedFromCommit of the same inputs ---
    const independentCache = (await makeTempDir('phraise-gateA-cache-')).path;
    const independentStore = new GitStore({ cacheDir: independentCache, remoteUrl: remote.url });
    await independentStore.init();
    const head = await independentStore.remoteHead(BRANCH);
    if (!head) throw new Error('gate A: remote has no head');
    await independentStore.fetch(BRANCH);
    const md = await independentStore.readFile(head, PATH_MD);
    const info = await independentStore.commitInfo(head);
    if (md === undefined) throw new Error('gate A: blob missing at head');
    const independentDoc = createDoc();
    seedFromCommit(independentDoc, { docId: docId(BRANCH, PATH_MD), markdown: md, commit: head, author: info.author, generation: 0 });
    const independentBytes = encodeState(independentDoc);

    const identical = bytesEqual(relayBytes, independentBytes);
    checks.push({
      name: 'relay-seeded state is byte-identical to an independent seedFromCommit',
      pass: identical,
      detail: `relay ${relayBytes.length}B vs independent ${independentBytes.length}B`,
    });

    // --- two live editors connect and see it ---
    [alice, bob] = await Promise.all([
      createLiveEditor({ url: relay.wsUrl, docName: resolved.docName, token: 'alice' }),
      createLiveEditor({ url: relay.wsUrl, docName: resolved.docName, token: 'bob' }),
    ]);
    const bothConverged = alice.view.state.doc.textContent === bob.view.state.doc.textContent && alice.view.state.doc.textContent.includes('Paragraph Alpha');
    checks.push({ name: 'both editors see the seeded content', pass: bothConverged, detail: alice.view.state.doc.textContent.slice(0, 60) });

    const aliceRendered = renderDoc(alice.view.state.doc).text;
    const bobRendered = renderDoc(bob.view.state.doc).text;
    const roundTrips = aliceRendered === FIXTURE && bobRendered === FIXTURE;
    checks.push({
      name: 'both editors serialize byte-identically to the original file',
      pass: roundTrips,
      detail: roundTrips ? 'exact match' : `alice=${JSON.stringify(aliceRendered)} bob=${JSON.stringify(bobRendered)} want=${JSON.stringify(FIXTURE)}`,
    });

    const pass = checks.every((c) => c.pass);
    return {
      gate: 'A',
      pass,
      summary: pass ? `all ${checks.length} checks passed` : checks.filter((c) => !c.pass).map((c) => `${c.name}: ${c.detail}`).join('; '),
      numbers: { checks: checks.length, relayBytes: relayBytes.length },
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
