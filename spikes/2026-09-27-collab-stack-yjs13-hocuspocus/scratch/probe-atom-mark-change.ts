// Orchestrator probe (spike 5), stack 13 twin of the stack 14 probe of the
// same name: do edits that change a linked image's link (href change, unlink,
// whole-document replace, replacing the image node) survive the live binding
// with the two workaround plugins? Two editors, updates exchanged directly.
// Run: npx tsx scratch/probe-atom-mark-change.ts
import 'global-jsdom/register';
import * as Y from 'yjs';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { ySyncPlugin, initProseMirrorDoc } from '@tiptap/y-tiptap';
import { schema } from '../src/schema.js';
import { parseMarkdown } from '../src/parse.js';
import { docToYDoc, FRAGMENT_NAME } from '../src/yjs.js';
import { leafMarksPlugin } from '../src/workarounds/leafMarks.js';
import { rootAttrsPlugin } from '../src/workarounds/rootAttrs.js';

function editor(ydoc: Y.Doc): EditorView {
  const fragment = ydoc.getXmlFragment(FRAGMENT_NAME);
  const { doc, mapping } = initProseMirrorDoc(fragment, schema);
  const plugins = [ySyncPlugin(fragment, { mapping }), leafMarksPlugin(), rootAttrsPlugin(ydoc)];
  return new EditorView(document.createElement('div'), { state: EditorState.create({ doc, schema, plugins }) });
}

function pair(md: string): [EditorView, EditorView] {
  const d1 = new Y.Doc();
  const d2 = new Y.Doc();
  docToYDoc(parseMarkdown(md).doc, d1);
  Y.applyUpdate(d2, Y.encodeStateAsUpdate(d1));
  d1.on('update', (u: Uint8Array) => Y.applyUpdate(d2, u));
  d2.on('update', (u: Uint8Array) => Y.applyUpdate(d1, u));
  return [editor(d1), editor(d2)];
}

function imageHref(view: EditorView, url: string): string {
  let out = 'image missing';
  view.state.doc.descendants((n) => {
    if (n.type.name === 'image' && n.attrs.url === url) out = n.marks.find((m) => m.type.name === 'link')?.attrs.href ?? 'no link';
  });
  return out;
}
function imagePos(view: EditorView, url: string): number {
  let p = -1;
  view.state.doc.descendants((n, pos) => {
    if (n.type.name === 'image' && n.attrs.url === url) p = pos;
  });
  return p;
}

const md = 'A [![ci](badge.svg)](https://old.example) badge and a [text link](https://old.example).\n';

{
  const [v1, v2] = pair(md);
  console.log('initial: e1', imageHref(v1, 'badge.svg'), '| e2', imageHref(v2, 'badge.svg'));
  const pos = imagePos(v1, 'badge.svg');
  v1.dispatch(v1.state.tr.removeMark(pos, pos + 1, schema.marks.link).addMark(pos, pos + 1, schema.marks.link.create({ href: 'https://new.example' })));
  console.log('case 1 href change on image: e1', imageHref(v1, 'badge.svg'), '| e2', imageHref(v2, 'badge.svg'));
  const pos2 = imagePos(v1, 'badge.svg');
  v1.dispatch(v1.state.tr.removeMark(pos2, pos2 + 1, schema.marks.link));
  console.log('case 3 unlink image: e1', imageHref(v1, 'badge.svg'), '| e2', imageHref(v2, 'badge.svg'));
}
{
  const [v1, v2] = pair(md);
  const next = parseMarkdown(md.replaceAll('old.example', 'new.example').replace('badge.svg', 'badge2.svg')).doc;
  v1.dispatch(v1.state.tr.replaceWith(0, v1.state.doc.content.size, next.content));
  console.log('case 4 whole-doc replace, url and href change: e1', imageHref(v1, 'badge2.svg'), '| e2', imageHref(v2, 'badge2.svg'));
}
{
  const [v1, v2] = pair(md);
  const pos = imagePos(v1, 'badge.svg');
  const old = v1.state.doc.nodeAt(pos)!;
  const repl = schema.nodes.image.create({ ...old.attrs, url: 'badge3.svg', leafMarks: null }, null, [schema.marks.link.create({ href: 'https://new.example' })]);
  v1.dispatch(v1.state.tr.replaceWith(pos, pos + 1, repl));
  console.log('case 5 replace one image node, url and href change: e1', imageHref(v1, 'badge3.svg'), '| e2', imageHref(v2, 'badge3.svg'));
}
// Case 6 (y-prosemirror issue #241): swap one text mark for another (bold -> code) in one transaction.
{
  const [v1, v2] = pair('Some **bold** words.\n');
  let from = -1;
  let to = -1;
  v1.state.doc.descendants((n, pos) => {
    if (n.isText && n.text === 'bold') { from = pos; to = pos + n.nodeSize; }
  });
  v1.dispatch(v1.state.tr.removeMark(from, to, schema.marks.strong).addMark(from, to, schema.marks.code.create()));
  const marksOf = (v: EditorView) => { let m = ''; v.state.doc.descendants((n) => { if (n.isText && n.text === 'bold') m = n.marks.map((x) => x.type.name).join('+'); }); return m; };
  console.log('case 6 swap strong for code on text: e1', marksOf(v1), '| e2', marksOf(v2));
}
