// Workaround 1 of 2 for stack 13's binding loss (see src/yjs.ts header): a
// Y.XmlFragment has no attribute slot, so the doc's own `lead`/`eol` attrs
// have nowhere to live for the *live* ySyncPlugin path (docToYDoc/yDocToDoc
// in src/yjs.ts only cover seeding/reading a Y.Doc, not live editing).
//
// This plugin keeps a sibling `Y.Map` (yjs.ts's META_MAP_NAME,
// "phraise-doc") in sync with `doc.attrs` in both directions:
//   - local: a transaction that calls `tr.setDocAttribute(...)` changes
//     `newState.doc.attrs`; appendTransaction notices the difference from
//     the map's current value and writes the new value into the map.
//   - remote (including the initial sync): the map's Yjs observer fires
//     (on the local client that made the edit too, since Y.Map.observe
//     fires for local transacts as well) and dispatches a transaction that
//     calls `setDocAttribute` to bring the editor's `doc.attrs` in line.
//
// Both directions compare-before-write, so applying either side's change
// converges immediately: the write on one side becomes a no-op check on
// the other, with no further round trip. See the plugin's docWrites/
// mapWrites stats, used by gate B to confirm updates stop growing.
//
// Constraint this puts on the schema: only attrs actually reachable via
// `Transform.setDocAttribute` can be covered (works for any doc attr;
// spike 1's schema has exactly `lead` and `eol`, both plain strings, so no
// further constraint beyond "root attrs must be JSON-serializable").
import { Plugin, PluginKey, type EditorState, type Transaction } from 'prosemirror-state';
import * as Y from 'yjs';
import { META_MAP_NAME } from '../yjs.js';

export const rootAttrsPluginKey = new PluginKey('rootAttrs');

export const ROOT_ATTR_NAMES = ['lead', 'eol'] as const;
type RootAttrName = (typeof ROOT_ATTR_NAMES)[number];

export interface RootAttrsStats {
  /** Number of times a transaction wrote doc.attrs into the Y.Map (local -> map). */
  mapWrites: number;
  /** Number of times a transaction wrote the Y.Map's value into doc.attrs (map -> local). */
  docWrites: number;
}

function readMapAttrs(meta: Y.Map<string>): Record<RootAttrName, string> {
  return {
    lead: meta.get('lead') ?? '',
    eol: meta.get('eol') ?? '\n',
  };
}

function readDocAttrs(state: EditorState): Record<RootAttrName, string> {
  return {
    lead: state.doc.attrs.lead ?? '',
    eol: state.doc.attrs.eol ?? '\n',
  };
}

function attrsDiffer(a: Record<RootAttrName, string>, b: Record<RootAttrName, string>): boolean {
  return ROOT_ATTR_NAMES.some((k) => a[k] !== b[k]);
}

/** Root-attribute workaround: keeps doc.attrs and the phraise-doc Y.Map in sync. */
export function rootAttrsPlugin(ydoc: Y.Doc, stats: RootAttrsStats = { mapWrites: 0, docWrites: 0 }): Plugin {
  const meta = ydoc.getMap<string>(META_MAP_NAME);

  return new Plugin({
    key: rootAttrsPluginKey,
    view(editorView) {
      const syncFromMap = () => {
        const mapAttrs = readMapAttrs(meta);
        const docAttrs = readDocAttrs(editorView.state);
        if (!attrsDiffer(mapAttrs, docAttrs)) return;
        let tr: Transaction = editorView.state.tr;
        for (const k of ROOT_ATTR_NAMES) tr = tr.setDocAttribute(k, mapAttrs[k]);
        tr.setMeta('addToHistory', false);
        tr.setMeta(rootAttrsPluginKey, { fromMap: true });
        editorView.dispatch(tr);
        stats.docWrites++;
      };
      // Initial render: the map may already carry seeded content (server
      // seed applied before this client synced) or may still be empty (a
      // brand-new document) -- either way, bring doc.attrs in line once.
      syncFromMap();
      const observer = () => syncFromMap();
      meta.observe(observer);
      return {
        destroy() {
          meta.unobserve(observer);
        },
      };
    },
    appendTransaction(_trs, _oldState, newState) {
      const docAttrs = readDocAttrs(newState);
      const mapAttrs = readMapAttrs(meta);
      if (!attrsDiffer(docAttrs, mapAttrs)) return null;
      ydoc.transact(() => {
        meta.set('lead', docAttrs.lead);
        meta.set('eol', docAttrs.eol);
      });
      stats.mapWrites++;
      return null;
    },
  });
}
