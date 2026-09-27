// Brief 04, gate E part (b) probe: does @y/prosemirror's suggestion mode
// (a second Y.Doc + Y.createDiffRenderer, per the upstream Tiptap 3 demo
// the brief names) actually render y-attributed-* marks with bob as author
// when alice's view reads the base document, using this spike's own
// (hardened, see src/schema.ts) schema? Two attempts tried here before
// promoting whichever works into gates/gateE.ts.
import 'global-jsdom/register';
import * as Y from '@y/y';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { syncPlugin, configureYProsemirror, pmnodeToDelta, acceptChanges, rejectChanges } from '@y/prosemirror';
import { schema } from '../src/schema.js';
import { parseMarkdown } from '../src/parse.js';
import { serializeDoc } from '../src/serialize.js';

function editor(): EditorView {
  return new EditorView(document.createElement('div'), { state: EditorState.create({ schema, plugins: [syncPlugin()] }) });
}

const md = 'A [![ci](badge.svg)](https://old.example) badge and some words to delete here.\n';
const { doc } = parseMarkdown(md);

const ydoc = new Y.Doc();
ydoc.get('prosemirror').applyDelta(pmnodeToDelta(doc));

const suggestionDoc = new Y.Doc();
Y.applyUpdate(suggestionDoc, Y.encodeStateAsUpdate(ydoc));

const attributions = { inserts: Y.createIdMap(), deletes: Y.createIdMap() };

// Attempt 2 (attempt 1's result: userIds always came back []): tag each of
// bob's OWN edits into the `attributions` ContentMap from a
// `beforeObserverCalls` listener registered on suggestionDoc BEFORE
// Y.createDiffRenderer's own listener (below) is attached. `DiffRenderer`
// reads `attributions?.inserts`/`.deletes` fresh, by closure, inside ITS
// OWN `beforeObserverCalls` handler on every transaction -- not once at
// construction time -- but Yjs fires same-event listeners in REGISTRATION
// order, so if the renderer's handler is attached first (attempt 1: it was,
// since attribution was populated only after all of bob's edits already
// ran), every one of bob's edits gets diffed and permanently recorded with
// WHATEVER attribution existed in the map AT THAT MOMENT -- empty, since
// nothing had tagged it yet. Registering our own tagger first fixes the
// order: by the time the renderer's own handler runs for a given
// transaction, this transaction's own new content ids are already tagged.
suggestionDoc.on('beforeObserverCalls', (tr: any) => {
  if (!tr.local) return; // only bob's own edits are attributed here
  const taggedInserts = Y.createIdMapFromIdSet(tr.insertSet, [Y.createContentAttribute('insert', 'bob')]);
  Y.insertIntoIdMap(attributions.inserts, taggedInserts);
  const taggedDeletes = Y.createIdMapFromIdSet(tr.deleteSet, [Y.createContentAttribute('delete', 'bob')]);
  Y.insertIntoIdMap(attributions.deletes, taggedDeletes);
});

const renderer = Y.createDiffRenderer(ydoc, suggestionDoc, { attributions });
renderer.suggestionMode = true;

// Alice's view: the LIVE document, no renderer -- plain.
const aliceView = editor();
configureYProsemirror({ ytype: ydoc.get('prosemirror') })(aliceView.state, aliceView.dispatch);

// Bob's view: the SUGGESTION document, bound WITH the renderer.
const bobView = editor();
configureYProsemirror({ ytype: suggestionDoc.get('prosemirror'), renderer })(bobView.state, bobView.dispatch);

console.log('--- before any suggestion ---');
console.log('alice html:', aliceView.dom.innerHTML);

// Bob inserts text.
{
  const pos = bobView.state.doc.content.size - 1;
  bobView.dispatch(bobView.state.tr.insertText('SUGGESTED', pos));
}
// Bob deletes a word ("delete").
{
  let from = -1, to = -1;
  bobView.state.doc.descendants((n, p) => {
    if (n.isText && n.text?.includes('delete')) {
      const idx = n.text.indexOf('delete');
      from = p + idx;
      to = from + 'delete'.length;
    }
  });
  if (from >= 0) bobView.dispatch(bobView.state.tr.delete(from, to));
}
// Bob adds a link to the image.
{
  let pos = -1;
  bobView.state.doc.descendants((n, p) => {
    if (n.type.name === 'image') pos = p;
  });
  if (pos >= 0) bobView.dispatch(bobView.state.tr.addMark(pos, pos + 1, schema.marks.link.create({ href: 'https://suggested.example' })));
}

console.log('--- after bob\'s suggestions (attempt 2: tagged live, via beforeObserverCalls) ---');
console.log('bob html:', bobView.dom.innerHTML);
console.log('alice html (renderer-less, should be unaffected while suggestionMode=true):', aliceView.dom.innerHTML);

// Rebuild bob's view fresh to force a full re-render with the now-populated attributions ContentMap.
const bobView2 = editor();
configureYProsemirror({ ytype: suggestionDoc.get('prosemirror'), renderer })(bobView2.state, bobView2.dispatch);
console.log('bob html (fresh rebind):', bobView2.dom.innerHTML);
console.log('bob doc JSON (fresh rebind):', JSON.stringify(bobView2.state.doc.toJSON()));

// Reject the delete FIRST (real doc positions via descendants, not
// textContent.indexOf -- textContent skips the position an atom like the
// image occupies, which under-counts every position after it).
{
  let delFrom = -1, delTo = -1;
  bobView2.state.doc.descendants((n, p) => {
    if (n.marks.some((m) => m.type.name === 'y-attributed-delete')) {
      if (delFrom === -1) delFrom = p;
      delTo = p + n.nodeSize;
    }
  });
  console.log('rejecting delete at', delFrom, delTo);
  if (delFrom >= 0) rejectChanges(delFrom, delTo)(bobView2.state, bobView2.dispatch);
}
console.log('bob html after rejecting the delete:', bobView2.dom.innerHTML);
{
  let insFrom = -1, insTo = -1;
  bobView2.state.doc.descendants((n, p) => {
    if (n.marks.some((m) => m.type.name === 'y-attributed-insert')) {
      if (insFrom === -1) insFrom = p;
      insTo = p + n.nodeSize;
    }
  });
  console.log('accepting insert at', insFrom, insTo);
  if (insFrom >= 0) acceptChanges(insFrom, insTo)(bobView2.state, bobView2.dispatch);
}
console.log('bob html after accepting the insert:', bobView2.dom.innerHTML);
console.log('bob doc JSON after accept/reject:', JSON.stringify(bobView2.state.doc.toJSON()));

// What matters most for Phraise: does the live document (ydoc, alice's own
// side) now reflect the accepted insert and the rejected delete surviving?
console.log('--- live ydoc after accept/reject ---');
const aliceView2 = editor();
configureYProsemirror({ ytype: ydoc.get('prosemirror') })(aliceView2.state, aliceView2.dispatch);
console.log('alice live html:', aliceView2.dom.innerHTML);
console.log('alice live doc JSON:', JSON.stringify(aliceView2.state.doc.toJSON()));
aliceView2.destroy();

console.log('doc.check() on bob view:', (bobView2.state.doc as any).check ? 'has check()' : 'no check() method');
try {
  (bobView2.state.doc as any).check?.();
  console.log('doc.check() passed');
} catch (e) {
  console.log('doc.check() FAILED:', (e as Error).message);
}

// Serialization leak check: does serializeDoc see the phantom deleted text / attribution marks at all?
try {
  const out = serializeDoc(bobView2.state.doc);
  console.log('--- serializeDoc on the (post accept/reject) suggestion-mode doc ---');
  console.log(JSON.stringify(out));
} catch (e) {
  console.log('serializeDoc THREW on the suggestion-mode doc:', (e as Error).message);
}
// And on a doc that STILL has an unresolved pending suggestion (the format/link one, never accepted/rejected above):
try {
  const out2 = serializeDoc(bobView.state.doc);
  console.log('serializeDoc on bobView (format-link suggestion still pending):', JSON.stringify(out2));
} catch (e) {
  console.log('serializeDoc THREW on bobView (pending format suggestion):', (e as Error).message);
}

aliceView.destroy();
bobView.destroy();
bobView2.destroy();
process.exit(0);
