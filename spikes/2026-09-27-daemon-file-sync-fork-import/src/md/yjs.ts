// Yjs boundary for the document model.
//
// y-prosemirror 1.3.7 (and its Tiptap fork @tiptap/y-tiptap 3.0.9) loses two
// things this model needs, measured by gate A3:
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
// back (D1: docs are re-seeded from commits; D2: drafts are flushed). The live
// ySyncPlugin converts editor transactions itself and would still drop leaf
// marks created during editing; that needs the same encoding inside
// y-prosemirror (a small upstream patch) or an appendTransaction plugin that
// maintains `leafMarks`. Spike 2 owns that.
import * as Y from 'yjs';
import { prosemirrorToYXmlFragment, yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror';
import { Node as PMNode, Fragment, Mark } from 'prosemirror-model';
import { schema } from './schema.js';

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

/** Seed a Y.Doc from a parsed document. */
export function docToYDoc(doc: PMNode, ydoc: Y.Doc = new Y.Doc()): Y.Doc {
  const meta = ydoc.getMap(META_MAP_NAME);
  ydoc.transact(() => {
    meta.set('lead', doc.attrs.lead ?? '');
    meta.set('eol', doc.attrs.eol ?? '\n');
    prosemirrorToYXmlFragment(encodeLeafMarks(doc), ydoc.getXmlFragment(FRAGMENT_NAME));
  });
  return ydoc;
}

/** Read the document back out of a Y.Doc. */
export function yDocToDoc(ydoc: Y.Doc): PMNode {
  const meta = ydoc.getMap(META_MAP_NAME);
  const root = yXmlFragmentToProseMirrorRootNode(ydoc.getXmlFragment(FRAGMENT_NAME), schema);
  const doc = schema.node('doc', { lead: meta.get('lead') ?? '', eol: meta.get('eol') ?? '\n' }, root.content);
  return decodeLeafMarks(doc);
}
