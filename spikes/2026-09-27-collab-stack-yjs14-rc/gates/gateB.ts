// Gate B (charter): "With a schema shaped like spike 1's ... typing,
// pasting, splitting and joining blocks in one editor leaves the other
// editor and the relay's stored document with nothing lost."
//
// Brief 02 task 5: the identical edit script from stack 13's gates/gateB.ts
// (gates/lib/edits.ts, byte-identical, per the brief), same equality check.
// Unlike stack 13 there is no workaround plugin and so no negative control
// to run: stack 14's binding keeps root doc attrs and atom marks
// structurally (src/yjs.ts's header). Brief 02 adds one stack-14-specific
// check: "the number of Yjs updates stops growing after settling" -- each
// editor's Y.Doc 'update' event is counted, and the count must be the same
// immediately after convergence and after an additional settle wait.
import 'global-jsdom/register';
import { Mark } from 'prosemirror-model';
import { startRelay, type RelayHandle } from '../src/harness.js';
import { createLiveClient, waitUntil, type LiveClient } from '../src/client-hocuspocus.js';
import { schema } from '../src/schema.js';
import { findPos, insertText, pasteHTMLAt, splitBlockAt, joinBackwardAt, addMarkAt, deleteRange } from './lib/edits.js';
import { checkEquality, decodeRelayState, linkedImages } from './lib/equality.js';

export interface GateBResult {
  pass: boolean;
  reasons: string[];
  detail: string;
  updateCounts: { afterConverge: number; afterSettle: number };
}

const PASTED_HTML = '<strong>bold</strong> and <a href="https://pasted.example"><img src="pasted.png" alt="pasted"></a>';

/** Run the plan's scripted edit sequence against editor 1, with editor 2 typing concurrently. Identical in substance to stack 13's gates/gateB.ts. */
async function runScript(a: LiveClient, b: LiveClient): Promise<void> {
  const closingPara = () => findPos(a.view, (n) => n.type.name === 'paragraph' && n.textContent.includes('A closing paragraph'));
  const pos = closingPara();
  const node1 = a.view.state.doc.nodeAt(pos)!;
  insertText(a.view, pos + node1.nodeSize - 1, ' newword');

  const htmlParaB = findPos(b.view, (n) => n.type.name === 'paragraph' && n.textContent.includes('Some inline HTML'));
  const nodeB = b.view.state.doc.nodeAt(htmlParaB)!;
  insertText(b.view, htmlParaB + nodeB.nodeSize - 1, ' concurrent');

  const unlinkedParaPos = () => findPos(a.view, (n) => n.type.name === 'paragraph' && n.textContent.includes('An unlinked image'));
  const p2 = unlinkedParaPos();
  const node2 = a.view.state.doc.nodeAt(p2)!;
  pasteHTMLAt(a.view, p2 + node2.nodeSize - 1, PASTED_HTML);

  const badgePos = () => findPos(a.view, (n) => n.type.name === 'image' && n.attrs.url === 'badge.svg');
  const splitAt = badgePos();
  splitBlockAt(a.view, splitAt);
  const rejoinAt = badgePos() + 1;
  joinBackwardAt(a.view, rejoinAt);

  const iconPos = () => findPos(a.view, (n) => n.type.name === 'image' && n.attrs.url === 'icon.png');
  const linkMark = schema.marks.link.create({ href: 'https://icon.example' }) as Mark;
  addMarkAt(a.view, iconPos(), linkMark);

  const htmlParaPos = findPos(a.view, (n) => n.type.name === 'paragraph' && n.textContent.includes('Some inline HTML'));
  const htmlParaNode = a.view.state.doc.nodeAt(htmlParaPos)!;
  const deleteFrom = htmlParaPos + htmlParaNode.nodeSize - 4;
  const deleteTo = deleteFrom + 8;
  deleteRange(a.view, deleteFrom, deleteTo);

  await waitUntil(
    () => JSON.stringify(a.view.state.doc.toJSON()) === JSON.stringify(b.view.state.doc.toJSON()),
    8000,
  );
}

export async function runGateB(opts: {
  port: number;
  seedsDir: string;
  dbDir: string;
  docName: string;
}): Promise<GateBResult> {
  let relay: RelayHandle | undefined;
  try {
    relay = await startRelay({ port: opts.port, db: opts.dbDir, seeds: opts.seedsDir });
    const [a, b] = await Promise.all([
      createLiveClient({ url: relay.wsUrl, docName: opts.docName, token: 'alice' }),
      createLiveClient({ url: relay.wsUrl, docName: opts.docName, token: 'bob' }),
    ]);
    try {
      let updateCount = 0;
      a.ydoc.on('update', () => updateCount++);

      await runScript(a, b);
      const afterConverge = updateCount;
      await new Promise((r) => setTimeout(r, 500));
      const afterSettle = updateCount;

      const relayBytes = await relay.fetchState(opts.docName);
      const relayDoc = decodeRelayState(relayBytes);

      const result = checkEquality({ editor1: a.view.state.doc, editor2: b.view.state.doc, relay: relayDoc });
      const reasons = [...result.reasons];

      const linksA = linkedImages(a.view.state.doc);
      const iconLinked = linksA.some((im) => im.url === 'icon.png');
      const badgeLinked = linksA.some((im) => im.url === 'badge.svg');
      const logoLinked = linksA.some((im) => im.url === 'logo.png');
      const pastedLinked = linksA.some((im) => im.url === 'pasted.png');

      if (!iconLinked) reasons.push('icon.png did not keep its newly-added link mark');
      if (!badgeLinked) reasons.push('badge.svg lost its link mark across split/join');
      if (!logoLinked) reasons.push('logo.png lost its link mark');
      if (!pastedLinked) reasons.push('pasted.png (from paste) is missing its link mark');
      if (afterSettle !== afterConverge) {
        reasons.push(`Yjs update count kept growing after settling: ${afterConverge} -> ${afterSettle}`);
      }

      const pass = reasons.length === 0;
      return {
        pass,
        reasons,
        detail: pass
          ? `editor1, editor2 and the relay agree; every linked image kept its link mark; update count stable at ${afterSettle}`
          : `mismatch: ${reasons.join('; ')}`,
        updateCounts: { afterConverge, afterSettle },
      };
    } finally {
      a.destroy();
      b.destroy();
    }
  } finally {
    if (relay) await relay.stop();
  }
}
