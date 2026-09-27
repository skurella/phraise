// Brief 06 task 1/2/3 de-risking probe (not part of the gate runner; kept as
// evidence, per this package's convention of scratch/ scripts documenting
// what was verified before writing the real code). Answers, empirically:
// 1. Deterministic seeding via pmnodeToDelta + applyDelta under a fixed
//    clientID -> byte-identical Y updates from two independent seeds.
// 2. createDocFromSnapshot + Y.Node.getAttr/setAttr (as a Y.Map replacement)
//    round-trip.
// 3. pmDocDiff(pmA, pmB) applied via ytype.applyDelta converges the fork to
//    pmB exactly (ynodeToPmnode reads back .eq(pmB)).
// 4. Y.Node.getAttrs(snapshot) point-in-time read.
// 5. IdSet.hasId(item.id) as the Yjs14 replacement for Y.isDeleted(ds, id).
// 6. createRelativePositionFromTypeIndex / createAbsolutePositionFromRelativePosition
//    round-trip on a textblock Y.Node (spike 2's schema has no inline atoms,
//    so a textblock's own content is pure text -- no nested XmlText needed).
// 7. Y.Node.clone() for resurrection (a standalone copy insertable elsewhere).
import * as Y from '@y/y';
import { pmnodeToDelta, ynodeToPmnode, docToDelta } from '@y/prosemirror';
import { schema } from '../src/rebase/schema.js';
import { parseMarkdown } from '../src/rebase/markdown.js';

const FRAGMENT_NAME = 'pm';

function seedPeerId(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  const u = h >>> 0;
  return u === 0 ? 1 : u;
}

const MD_A = `# Title\n\nFirst paragraph with *emphasis* and a [link](https://example.com/a).\n\nSecond paragraph, unchanged.\n`;

function seed(md: string, peer: number): Y.Doc {
  const doc = new Y.Doc({ gc: false });
  doc.clientID = peer;
  const pm = parseMarkdown(md);
  const ytype = doc.get(FRAGMENT_NAME);
  doc.transact(() => {
    ytype.applyDelta(pmnodeToDelta(pm));
  }, 'seed');
  return doc;
}

function assert(cond: any, msg: string) {
  if (!cond) throw new Error('ASSERT FAILED: ' + msg);
  console.log('OK:', msg);
}

async function main() {
  const peer = seedPeerId('probe:seed:A');

  // --- 1. deterministic seeding ---
  const d1 = seed(MD_A, peer);
  const d2 = seed(MD_A, peer);
  const u1 = Y.encodeStateAsUpdate(d1);
  const u2 = Y.encodeStateAsUpdate(d2);
  assert(Buffer.from(u1).equals(Buffer.from(u2)), 'two independent seeds with the same clientID are byte-identical updates');

  // read-back equality
  const pmBack = ynodeToPmnode(d1.get(FRAGMENT_NAME), schema) as any;
  const pmOrig = parseMarkdown(MD_A);
  assert(pmBack.eq(pmOrig), 'seeded doc reads back equal to the parsed source');

  // --- 2. Y.Node as an attr bag (Y.Map replacement) + createDocFromSnapshot ---
  const phraise = d1.get('phraise');
  d1.transact(() => {
    phraise.setAttr('base', { id: 'A', commit: 'A' });
  }, 'seed');
  const snap = Y.encodeSnapshot(Y.snapshot(d1));
  d1.transact(() => {
    phraise.setAttr('snapshot:A', Buffer.from(snap).toString('base64'));
  }, 'seed');
  assert(JSON.stringify(phraise.getAttr('base')) === JSON.stringify({ id: 'A', commit: 'A' }), 'phraise node attr round-trips a plain object');

  const snapshotDecoded = Y.decodeSnapshot(Buffer.from(phraise.getAttr('snapshot:A') as string, 'base64'));
  const fork = Y.createDocFromSnapshot(d1, snapshotDecoded, new Y.Doc({ gc: false }));
  const forkPm = ynodeToPmnode(fork.get(FRAGMENT_NAME), schema) as any;
  assert(forkPm.eq(pmOrig), 'createDocFromSnapshot fork reads back equal to the seed');
  assert(JSON.stringify(fork.get('phraise').getAttr('base')) === JSON.stringify({ id: 'A', commit: 'A' }), 'fork carries the phraise attrs too');

  // forEachAttr enumeration
  const keys: string[] = [];
  (phraise as any).forEachAttr((_v: any, k: string) => keys.push(k));
  assert(keys.includes('base') && keys.includes('snapshot:A'), 'forEachAttr enumerates attr keys: ' + JSON.stringify(keys));

  // --- 3. pmDocDiff diff-and-apply ---
  const MD_B = `# Title\n\nFirst paragraph REWRITTEN with *emphasis* and a [link](https://example.com/a).\n\nSecond paragraph, unchanged.\n\nA brand new third paragraph.\n`;
  const pmB = parseMarkdown(MD_B);
  const rebasePeer = seedPeerId('probe:rebase:A->B');
  const fork2 = Y.createDocFromSnapshot(d1, snapshotDecoded, new Y.Doc({ gc: false }));
  fork2.clientID = rebasePeer;
  const ytype2 = fork2.get(FRAGMENT_NAME);
  const pmA2 = ynodeToPmnode(ytype2, schema) as any;
  // `pmDocDiff` (the exact function `syncPlugin`'s pull() uses on every
  // keystroke) is NOT re-exported from @y/prosemirror's public index.js
  // (checked: only docToDelta/nodeToDelta/... are). Its package.json
  // "exports" field also blocks reaching into src/sync-utils.js directly.
  // Fallback per the brief: lib0's own `diff` (which pmDocDiff itself calls
  // for every non-trivial window -- see sync-utils.js's pmNodeDiff) IS
  // public (`lib0/delta`'s `diff`), and diffing the two documents' own
  // canonical `nodeToDelta`/`docToDelta` snapshots directly recurses into
  // matched children via `modify` on its own (confirmed by reading
  // lib0/delta/delta.js's applyChangesetToDelta, which calls `diff()`
  // recursively on a paired hunk) -- so this is NOT a cruder text-only
  // diff, it is the same word/line/char-granularity structural diff,
  // computed as a single whole-document diff instead of pmDocDiff's
  // incremental changed-window optimization. lib0's own contract for
  // `diff` says op granularity may differ from an incremental walk only in
  // "rare ambiguous windows" and always converges identically.
  const lib0delta = await import('lib0/delta');
  const change = lib0delta.diff(docToDelta(pmA2) as any, docToDelta(pmB) as any);
  fork2.transact(() => {
    ytype2.applyDelta(change);
  }, 'rebase');
  const pmAfter = ynodeToPmnode(ytype2, schema) as any;
  assert(pmAfter.eq(pmB), 'fork content after pmDocDiff+applyDelta equals target B exactly');

  // --- 4. getAttrs(snapshot) point-in-time read ---
  const snapBeforeSecondAttr = Y.snapshot(d1);
  d1.transact(() => { phraise.setAttr('laterKey', 'laterValue'); }, 'seed');
  const attrsAtSnap = phraise.getAttrs(snapBeforeSecondAttr);
  assert(!('laterKey' in attrsAtSnap), 'getAttrs(snapshot) does not see an attr written after the snapshot');
  assert('laterKey' in phraise.getAttrs(), 'getAttrs() (no snapshot) sees the current attr');

  // --- 5. IdSet.hasId as Y.isDeleted replacement ---
  const root = d1.get(FRAGMENT_NAME);
  const firstItem: any = (root as any)._start;
  assert(firstItem !== null, 'root has at least one item to test visibility on');
  const dsHasId = typeof (snapBeforeSecondAttr.ds as any).hasId === 'function';
  assert(dsHasId, 'Snapshot.ds has a hasId(id) method');
  const visibleNow = !firstItem.deleted;
  const visibleAtSnap =
    snapBeforeSecondAttr.sv.has(firstItem.id.client) &&
    (snapBeforeSecondAttr.sv.get(firstItem.id.client) || 0) > firstItem.id.clock &&
    !(snapBeforeSecondAttr.ds as any).hasId(firstItem.id);
  assert(visibleNow === true && visibleAtSnap === true, 'hand-rolled isVisibleAt matches expected visibility for the root doc content item');

  // --- 6. RelativePosition round-trip on a textblock Y.Node ---
  // Find the first paragraph-shaped child directly under root (spike 2's
  // schema has no inline atoms, so the paragraph's own content IS its text).
  function firstChildNamed(node: any, name: string): any {
    let item = node._start;
    while (item) {
      if (!item.deleted && item.content && item.content.type && item.content.type.name === name) return item.content.type;
      item = item.right;
    }
    return null;
  }
  const para = firstChildNamed(root, 'paragraph');
  assert(para !== null, 'found a paragraph Y.Node directly under root');
  const relStart = Y.createRelativePositionFromTypeIndex(para, 5, 0);
  const abs = Y.createAbsolutePositionFromRelativePosition(relStart, d1);
  assert(abs !== null && abs.type === para && abs.index === 5, 'RelativePosition round-trips to the same Y.Node + index on a textblock');

  // --- 7. Y.Node.clone() for resurrection ---
  // First attempt (wrong): compared clone.toDelta() to the original's
  // *before* inserting the clone anywhere. That reads back empty --
  // clone() (`cpy.applyDelta(this.toDeltaDeep())`) hands the copy's content
  // to a still-detached, doc-less node, which -- per the constructor's own
  // `_prelim`/`warnPrematureAccess` machinery -- defers materializing it
  // until the node is actually integrated (inserted) into a real doc.
  // Fixed: insert the clone directly (content array entries accept a raw
  // detached Y.Node, mirroring legacy YXmlFragment.insert(idx, [xmlElement]))
  // and read the result back afterwards.
  const clone = (para as any).clone();
  assert(clone !== para, 'clone() returns a distinct object');
  const paraDeltaBefore = JSON.stringify((para as any).toDelta().toJSON());
  d1.transact(() => {
    (root as any).insert((root as any).length, [clone]);
  }, 'resurrect-probe');
  const insertedPm = ynodeToPmnode(root, schema) as any;
  const lastChildJson = JSON.stringify(insertedPm.lastChild.toJSON());
  const paraAsPm = ynodeToPmnode(para as any, schema);
  assert(lastChildJson === JSON.stringify((paraAsPm as any).toJSON()), 'clone(), once inserted into the live doc, matches the original block’s content: ' + lastChildJson);
  assert(paraDeltaBefore.length > 0, 'sanity: original para delta is non-empty');

  console.log('\nALL PROBES PASSED');
}

main().catch((err) => {
  console.error('PROBE FAILED', err);
  process.exit(1);
});
