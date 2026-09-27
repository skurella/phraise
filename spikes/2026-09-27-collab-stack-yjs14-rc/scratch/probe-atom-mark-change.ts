// Orchestrator probe (spike 5): does @y/prosemirror 2.0.0-13 sync a change of
// an existing mark's attrs on an inline atom (edit the href of a linked
// image) through ordinary incremental transactions, not only through a
// whole-document replace? Two editors, updates exchanged directly.
// Run: npx tsx scratch/probe-atom-mark-change.ts
import 'global-jsdom/register';
import * as Y from '@y/y';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { syncPlugin, configureYProsemirror, pmnodeToDelta } from '@y/prosemirror';
import { schema } from '../src/schema.js';
import { parseMarkdown } from '../src/parse.js';

function editor(ydoc: Y.Doc): EditorView {
  const view = new EditorView(document.createElement('div'), {
    state: EditorState.create({ schema, plugins: [syncPlugin()] }),
  });
  configureYProsemirror({ ytype: ydoc.get('prosemirror') })(view.state, view.dispatch);
  return view;
}

function imageInfo(view: EditorView, url: string) {
  let out: { pos: number; marks: string } | null = null;
  view.state.doc.descendants((n, pos) => {
    if (n.type.name === 'image' && n.attrs.url === url) out = { pos, marks: JSON.stringify(n.marks.map((m) => m.toJSON())) };
  });
  return out as { pos: number; marks: string } | null;
}

const md = 'A [![ci](badge.svg)](https://old.example) badge and a [text link](https://old.example).\n';
const { doc } = parseMarkdown(md);
const d1 = new Y.Doc();
const d2 = new Y.Doc();
d1.on('update', (u: Uint8Array) => Y.applyUpdate(d2, u));
d2.on('update', (u: Uint8Array) => Y.applyUpdate(d1, u));
d1.get('prosemirror').applyDelta(pmnodeToDelta(doc));
const v1 = editor(d1);
const v2 = editor(d2);
console.log('initial  e1', imageInfo(v1, 'badge.svg')?.marks, '| e2', imageInfo(v2, 'badge.svg')?.marks);

// Case 1: change href on the image's link mark (removeMark + addMark, the way an "edit link" UI does it).
{
  const { pos } = imageInfo(v1, 'badge.svg')!;
  const tr = v1.state.tr.removeMark(pos, pos + 1, schema.marks.link).addMark(pos, pos + 1, schema.marks.link.create({ href: 'https://new.example' }));
  v1.dispatch(tr);
  console.log('case 1 href change on image: e1', imageInfo(v1, 'badge.svg')?.marks, '| e2', imageInfo(v2, 'badge.svg')?.marks);
}
// Case 2: same on the text link, for comparison.
{
  let from = -1, to = -1;
  v1.state.doc.descendants((n, pos) => {
    if (n.isText && n.text === 'text link') { from = pos; to = pos + n.nodeSize; }
  });
  const tr = v1.state.tr.removeMark(from, to, schema.marks.link).addMark(from, to, schema.marks.link.create({ href: 'https://new.example' }));
  v1.dispatch(tr);
  const hrefs = (v: EditorView) => { const s: string[] = []; v.state.doc.descendants((n) => { if (n.isText) n.marks.forEach((m) => m.type.name === 'link' && s.push(m.attrs.href)); }); return s.join(','); };
  console.log('case 2 href change on text: e1', hrefs(v1), '| e2', hrefs(v2));
}
// Case 3: remove the link from the image entirely.
{
  const { pos } = imageInfo(v1, 'badge.svg')!;
  v1.dispatch(v1.state.tr.removeMark(pos, pos + 1, schema.marks.link));
  console.log('case 3 unlink image: e1', imageInfo(v1, 'badge.svg')?.marks, '| e2', imageInfo(v2, 'badge.svg')?.marks);
}
v1.destroy();
v2.destroy();

// Case 4: whole-document replace where only the image link's href differs
// (what Tiptap's setContent or a client-side file load does).
{
  const e1 = new Y.Doc();
  const e2 = new Y.Doc();
  e1.on('update', (u: Uint8Array) => Y.applyUpdate(e2, u));
  e2.on('update', (u: Uint8Array) => Y.applyUpdate(e1, u));
  e1.get('prosemirror').applyDelta(pmnodeToDelta(parseMarkdown(md).doc));
  const w1 = editor(e1);
  const w2 = editor(e2);
  const variant = process.argv[2] === 'url-too' ? md.replaceAll('old.example', 'new.example').replace('badge.svg', 'badge2.svg') : md.replaceAll('old.example', 'new.example');
  const next = parseMarkdown(variant).doc;
  w1.dispatch(w1.state.tr.replaceWith(0, w1.state.doc.content.size, next.content));
  const img = process.argv[2] === 'url-too' ? 'badge2.svg' : 'badge.svg';
  const which = (w: EditorView) => { const i = imageInfo(w, img); return i ? (i.marks.includes('new.example') ? 'new' : 'OLD ' + i.marks) : 'image missing'; };
  console.log('case 4 whole-doc replace, image href differs: e1', which(w1), '| e2', which(w2));
  w1.destroy();
  w2.destroy();
}

// Case 5: an "edit image" dialog: replace only the image node with one that
// has a new url and a new link href.
{
  const e1 = new Y.Doc();
  const e2 = new Y.Doc();
  e1.on('update', (u: Uint8Array) => Y.applyUpdate(e2, u));
  e2.on('update', (u: Uint8Array) => Y.applyUpdate(e1, u));
  e1.get('prosemirror').applyDelta(pmnodeToDelta(parseMarkdown(md).doc));
  const w1 = editor(e1);
  const w2 = editor(e2);
  const { pos } = imageInfo(w1, 'badge.svg')!;
  const old = w1.state.doc.nodeAt(pos)!;
  const repl = schema.nodes.image.create({ ...old.attrs, url: 'badge3.svg' }, null, [schema.marks.link.create({ href: 'https://new.example' })]);
  w1.dispatch(w1.state.tr.replaceWith(pos, pos + 1, repl));
  const which = (w: EditorView) => { const i = imageInfo(w, 'badge3.svg'); return i ? (i.marks.includes('new.example') ? 'new' : 'OLD') : 'image missing'; };
  console.log('case 5 replace one image node, url and href change: e1', which(w1), '| e2', which(w2));
  w1.destroy();
  w2.destroy();
}

// Case 6 (y-prosemirror issue #241): swap one text mark for another (bold -> code) in one transaction.
{
  const e1 = new Y.Doc();
  const e2 = new Y.Doc();
  e1.on('update', (u: Uint8Array) => Y.applyUpdate(e2, u));
  e2.on('update', (u: Uint8Array) => Y.applyUpdate(e1, u));
  e1.get('prosemirror').applyDelta(pmnodeToDelta(parseMarkdown('Some **bold** words.\n').doc));
  const w1 = editor(e1);
  const w2 = editor(e2);
  let from = -1;
  let to = -1;
  w1.state.doc.descendants((n, pos) => {
    if (n.isText && n.text === 'bold') { from = pos; to = pos + n.nodeSize; }
  });
  w1.dispatch(w1.state.tr.removeMark(from, to, schema.marks.strong).addMark(from, to, schema.marks.code.create()));
  const marksOf = (v: EditorView) => { let m = ''; v.state.doc.descendants((n) => { if (n.isText && n.text === 'bold') m = n.marks.map((x) => x.type.name).join('+'); }); return m; };
  console.log('case 6 swap strong for code on text: e1', marksOf(w1), '| e2', marksOf(w2));
  w1.destroy();
  w2.destroy();
}
