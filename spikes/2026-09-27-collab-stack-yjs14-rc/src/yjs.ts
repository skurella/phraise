// Yjs boundary for the document model, stack 14.
//
// Unlike stack 13's src/yjs.ts (Yjs 13 + @tiptap/y-tiptap, which loses root
// `doc` attrs and marks on inline leaf/atom nodes -- see that file's header
// and spike 1's gate A3), the Yjs 14 release candidate's ProseMirror binding
// (`@y/prosemirror` 2.0.0-13 on `@y/y` 14.0.0-rc.26) keeps both structurally:
// every shared type is a single unified `Y.Node` (no more `Y.Text`/`Y.Map`/
// `Y.XmlFragment`/`Y.XmlElement` split), so the root is projected the same
// way as any other node (root attrs have somewhere to live), and
// `nodeToDelta`'s child loop attaches `marksToFormattingAttributes(c.marks)`
// to every child's insert op regardless of whether the child is text or an
// element (not gated on `c.isText` the way stack 13's binding is). Verified
// against spike 2's binding probe (branch spike/2026-09-27-crdt-rebase,
// commit 88bd85c, spikes/2026-09-27-crdt-rebase-binding-probe/) before
// writing this: both losses are already fixed at this layer, headless and
// through the live `syncPlugin`. So, unlike stack 13, **no workaround code
// exists in this spike directory** -- this file is a thin, direct wrapper
// around `pmnodeToDelta`/`ynodeToPmnode`.
import * as Y from '@y/y';
import { pmnodeToDelta, ynodeToPmnode } from '@y/prosemirror';
import { Node as PMNode } from 'prosemirror-model';
import { schema } from './schema.js';

export const FRAGMENT_NAME = 'prosemirror';

/** Seed a Y.Doc from a parsed document. `ydoc` may be any Y.Doc-shaped
 * instance (including one constructed via the aliased `yjs` specifier a
 * relay's own dependency graph resolves to -- see relay.ts) since
 * `@y/prosemirror`'s functions only touch the shared type object, not the
 * Y.Doc class itself. */
export function docToYDoc(doc: PMNode, ydoc: Y.Doc = new Y.Doc()): Y.Doc {
  const ytype = ydoc.get(FRAGMENT_NAME);
  ydoc.transact(() => {
    ytype.applyDelta(pmnodeToDelta(doc));
  });
  return ydoc;
}

/** Read the document back out of a Y.Doc. */
export function yDocToDoc(ydoc: Y.Doc): PMNode {
  const ytype = ydoc.get(FRAGMENT_NAME);
  return ynodeToPmnode(ytype, schema) as unknown as PMNode;
}
