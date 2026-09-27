// Workaround 2 of 2 for stack 13's binding loss (see src/yjs.ts header):
// @tiptap/y-tiptap 3.0.9 (like y-prosemirror 1.3.7) never reads or writes
// marks on an inline leaf/atom node (image, hard_break, raw_inline) when
// converting to/from its Y.XmlElement representation -- only node attrs
// survive that conversion. Spike 1's schema already carries a `leafMarks`
// meta attr on every such leaf for exactly this purpose (src/yjs.ts's
// encodeLeafMarks/decodeLeafMarks use it for the seed/read path); this
// plugin keeps it correct for the *live* ySyncPlugin path:
//
//   - local edits (marks changed by a real user transaction): appendTransaction
//     re-encodes `leafMarks` to match the leaf's current marks, via
//     `tr.setNodeAttribute`. That attr write is an ordinary doc change, so
//     y-tiptap mirrors it into Yjs the same way it mirrors any other attr.
//   - remote changes and the initial render (marks arrive empty because the
//     binding never carried them): the leaf's `leafMarks` attr *did* arrive
//     correctly (it's a plain attr), so this plugin restores real marks from
//     it, via `tr.setNodeMarkup(pos, undefined, node.attrs, decodedMarks)`.
//     Both transaction kinds are covered: appendTransaction sees
//     ySyncPluginKey's `isChangeOrigin` for a fragment-driven remote
//     transaction, and the plugin's own `view()` hook covers the initial
//     doc handed to `EditorState.create` (before any transaction exists to
//     append to).
//
// Constraint this puts on the schema: `leafMarks` must exist as a string
// attr (JSON-encoded `Mark[]`) on every node type that can carry marks the
// binding would otherwise drop -- already true of spike 1's schema (image,
// hard_break, raw_inline). A schema that adds a new inline-atom node type
// must add the same attr or this workaround silently ignores it (loss
// reappears for that node type only).
import { Plugin, PluginKey, type Transaction } from 'prosemirror-state';
import { Node as PMNode, Mark } from 'prosemirror-model';
import { ySyncPluginKey } from '@tiptap/y-tiptap';

export const leafMarksPluginKey = new PluginKey('leafMarks');

const LEAF_TYPES = new Set(['image', 'hard_break', 'raw_inline']);

export interface LeafMarksStats {
  /** Number of leaf nodes whose leafMarks attr was rewritten from live marks (local edits). */
  attrWrites: number;
  /** Number of leaf nodes whose marks were restored from the leafMarks attr (remote/initial). */
  restores: number;
}

function encodeMarks(node: PMNode): string | null {
  return node.marks.length ? JSON.stringify(node.marks.map((m) => m.toJSON())) : null;
}

function decodeMarks(node: PMNode): Mark[] {
  const enc = node.attrs.leafMarks as string | null | undefined;
  if (!enc) return [];
  const schema = node.type.schema;
  return (JSON.parse(enc) as unknown[]).map((j) => Mark.fromJSON(schema, j));
}

function marksEqual(a: readonly Mark[], b: readonly Mark[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((m, i) => m.eq(b[i]));
}

/**
 * Build a transaction that restores each leaf's real marks from its
 * leafMarks attr, for every leaf where they currently disagree. Safe to
 * call with the doc unchanged (no leaves touched) -- `count` is 0 then.
 *
 * Positions are read from `doc` (not `tr.doc`) while steps accumulate on
 * `tr`: both setNodeMarkup and setNodeAttribute below replace a leaf node
 * with another node of the same size (attrs/marks change, content and
 * child count do not), so earlier steps never shift a later leaf's
 * position and re-reading `doc` positions stays valid throughout.
 */
function buildRestoreTr(tr: Transaction, doc: PMNode): { tr: Transaction; count: number } {
  let count = 0;
  doc.descendants((node, pos) => {
    if (!LEAF_TYPES.has(node.type.name)) return;
    const wanted = decodeMarks(node);
    if (marksEqual(node.marks, wanted)) return;
    tr = tr.setNodeMarkup(pos, undefined, node.attrs, wanted);
    count++;
  });
  return { tr, count };
}

/** Build a transaction that re-encodes leafMarks from each leaf's current marks. */
function buildEncodeTr(tr: Transaction, doc: PMNode): { tr: Transaction; count: number } {
  let count = 0;
  doc.descendants((node, pos) => {
    if (!LEAF_TYPES.has(node.type.name)) return;
    const enc = encodeMarks(node);
    if ((node.attrs.leafMarks ?? null) === enc) return;
    tr = tr.setNodeAttribute(pos, 'leafMarks', enc);
    count++;
  });
  return { tr, count };
}

/** Leaf-marks workaround: keeps `leafMarks` and real marks on atom nodes in sync. */
export function leafMarksPlugin(stats: LeafMarksStats = { attrWrites: 0, restores: 0 }): Plugin {
  return new Plugin({
    key: leafMarksPluginKey,
    view(editorView) {
      // Initial render: initProseMirrorDoc/yXmlFragmentToProseMirrorRootNode
      // never attach marks, so the doc handed to EditorState.create is
      // always missing them on any leaf that has a non-null leafMarks attr.
      const { tr, count } = buildRestoreTr(editorView.state.tr, editorView.state.doc);
      if (count > 0) {
        tr.setMeta('addToHistory', false);
        editorView.dispatch(tr);
        stats.restores += count;
      }
      return {};
    },
    appendTransaction(_trs, _oldState, newState) {
      const ySyncState = ySyncPluginKey.getState(newState);
      const isRemote = !!ySyncState?.isChangeOrigin;
      if (isRemote) {
        const { tr, count } = buildRestoreTr(newState.tr, newState.doc);
        if (count === 0) return null;
        stats.restores += count;
        return tr;
      }
      const { tr, count } = buildEncodeTr(newState.tr, newState.doc);
      if (count === 0) return null;
      stats.attrWrites += count;
      return tr;
    },
  });
}
