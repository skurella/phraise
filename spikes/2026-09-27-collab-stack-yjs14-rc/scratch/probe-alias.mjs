// Probe: does importing Y.Doc via the aliased "yjs" specifier (what
// Hocuspocus itself imports) interoperate with @y/prosemirror, which
// imports its own Y.Node/Y.Doc classes via the true "@y/y" specifier?
import * as YAliased from 'yjs';
import * as YTrue from '@y/y';
import { pmnodeToDelta, ynodeToPmnode } from '@y/prosemirror';
import { Schema } from 'prosemirror-model';

const schema = new Schema({
  nodes: {
    doc: { content: 'paragraph+' },
    paragraph: { content: 'text*', group: 'block' },
    text: { group: 'inline' },
  },
});

console.log('YAliased.Doc === YTrue.Doc ?', YAliased.Doc === YTrue.Doc);

const doc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text('hello')])]);

console.log('--- using aliased yjs Doc ---');
try {
  const ydoc = new YAliased.Doc();
  const ytype = ydoc.get('prosemirror');
  ytype.applyDelta(pmnodeToDelta(doc));
  const rebuilt = ynodeToPmnode(ytype, schema);
  console.log('OK, textContent=', rebuilt.textContent);
} catch (e) {
  console.log('THREW:', (e && e.stack) || e);
}

console.log('--- using true @y/y Doc ---');
try {
  const ydoc = new YTrue.Doc();
  const ytype = ydoc.get('prosemirror');
  ytype.applyDelta(pmnodeToDelta(doc));
  const rebuilt = ynodeToPmnode(ytype, schema);
  console.log('OK, textContent=', rebuilt.textContent);
} catch (e) {
  console.log('THREW:', (e && e.stack) || e);
}
