// Origin: spike 5 (collab-stack-yjs13-hocuspocus), branch
// spike/2026-09-27-collab-stack, commit eeb3fe2, src/yjs.ts (itself copied
// from spike 1's src/yjs.ts at 1e1f4a6, retargeted to @tiptap/y-tiptap).
// Added here: createDoc(), seed()/read() named per plan section 3 point 1
// (the originals were named docToYDoc/yDocToDoc).
//
// Yjs boundary for the document model. This is the ONLY file in this spike
// (with diff.ts, forkDiffMerge.ts and the workarounds) that may import yjs,
// y-protocols or @tiptap/y-tiptap; see the import-boundary test.
//
// @tiptap/y-tiptap 3.0.9 (the Tiptap fork of y-prosemirror 1.3.7) loses two
// things this model needs, measured by spike 1's gate A3:
//   1. Attributes of the root `doc` node (`lead`, `eol`): a Y.XmlFragment has
//      no attribute slot, and yXmlFragmentToProseMirrorRootNode creates the
//      root with default attrs.
//   2. Marks on inline leaf nodes (image, hard_break, raw_inline): element
//      nodes are stored as Y.XmlElement with node attrs only; their marks are
//      dropped. The common case is a linked badge image `[![x](img)](href)`.
//
// This codec keeps both: root attrs go into a Y.Map next to the fragment, and
// inline leaf marks are encoded into the leaf's own `leafMarks` attr (a meta
// attr, ignored by semanticEq) on the way in and decoded on the way out.
//
// Limitation: this covers seeding a Y.Doc from a document and reading one
// back. The live ySyncPlugin converts editor transactions itself and would
// still drop leaf marks created during editing; src/crdt/workarounds/
// keeps `leafMarks` correct for that path.
import * as Y from 'yjs';
import { prosemirrorToYXmlFragment, yXmlFragmentToProseMirrorRootNode } from '@tiptap/y-tiptap';
import { Node as PMNode, Fragment, Mark } from 'prosemirror-model';
import { schema } from '../markdown/index.js';

export const FRAGMENT_NAME = 'prosemirror';
export const META_MAP_NAME = 'phraise-doc';

function mapInlineLeaves(node: PMNode, f: (leaf: PMNode) => PMNode): PMNode {
  if (node.isText) return node;
  if (node.isInline && node.isLeaf) return f(node);
  if (node.childCount === 0) return node;
  const children: PMNode[] = [];
  let changed = false;
  node.forEach((c) => {
    const m = mapInlineLeaves(c, f);
    if (m !== c) changed = true;
    children.push(m);
  });
  return changed ? node.copy(Fragment.fromArray(children)) : node;
}

/** Encode marks of inline leaf nodes into their `leafMarks` attr. */
export function encodeLeafMarks(doc: PMNode): PMNode {
  return mapInlineLeaves(doc, (leaf) => {
    if (leaf.marks.length === 0 || !('leafMarks' in leaf.type.spec.attrs!)) return leaf;
    const leafMarks = JSON.stringify(leaf.marks.map((m) => m.toJSON()));
    return leaf.type.create({ ...leaf.attrs, leafMarks }, null, leaf.marks);
  });
}

/** Restore marks from `leafMarks` and clear the attr. */
export function decodeLeafMarks(doc: PMNode): PMNode {
  return mapInlineLeaves(doc, (leaf) => {
    const enc = leaf.attrs.leafMarks as string | null | undefined;
    if (!enc) return leaf;
    const marks = (JSON.parse(enc) as any[]).map((j) => Mark.fromJSON(schema, j));
    return leaf.type.create({ ...leaf.attrs, leafMarks: null }, null, marks);
  });
}

/** A fresh Y.Doc, gc: false (forks need tombstones; Y.createDocFromSnapshot refuses a gc'd doc). */
export function createDoc(): Y.Doc {
  return new Y.Doc({ gc: false });
}

/** Seed `doc` in place from a parsed ProseMirror document. */
export function seed(doc: Y.Doc, pmDoc: PMNode, opts: { clientId?: number } = {}): void {
  if (opts.clientId !== undefined) doc.clientID = opts.clientId;
  const meta = doc.getMap(META_MAP_NAME);
  doc.transact(() => {
    meta.set('lead', pmDoc.attrs.lead ?? '');
    meta.set('eol', pmDoc.attrs.eol ?? '\n');
    prosemirrorToYXmlFragment(encodeLeafMarks(pmDoc), doc.getXmlFragment(FRAGMENT_NAME));
  });
}

/** Read the document back out of a Y.Doc, decoded (leaf marks restored, root attrs set). */
export function read(doc: Y.Doc): PMNode {
  const meta = doc.getMap(META_MAP_NAME);
  const root = yXmlFragmentToProseMirrorRootNode(doc.getXmlFragment(FRAGMENT_NAME), schema);
  const pmDoc = schema.node('doc', { lead: meta.get('lead') ?? '', eol: meta.get('eol') ?? '\n' }, root.content);
  return decodeLeafMarks(pmDoc);
}

/**
 * Read the document's PM view WITHOUT decoding leaf marks, so it lines up
 * with `encodeLeafMarks(target)` for an apples-to-apples structural diff
 * against Y's actual on-the-wire encoding (inline leaves carry their marks
 * in the meta `leafMarks` attr, not as real PM marks, until decoded). Used
 * by forkDiffMerge.ts; not part of the public five-point interface.
 */
export function readEncoded(doc: Y.Doc): PMNode {
  const meta = doc.getMap(META_MAP_NAME);
  const root = yXmlFragmentToProseMirrorRootNode(doc.getXmlFragment(FRAGMENT_NAME), schema);
  return schema.node('doc', { lead: meta.get('lead') ?? '', eol: meta.get('eol') ?? '\n' }, root.content);
}
