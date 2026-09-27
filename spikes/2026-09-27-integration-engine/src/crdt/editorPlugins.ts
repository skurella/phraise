// Plan section 3 point 2: editorPlugins(doc, opts) returns the ProseMirror
// plugins a live EditorView needs to bind to this Y.Doc, in the order stack
// 13's binding loss requires: ySyncPlugin first (so leafMarksPlugin's
// appendTransaction sees ySyncPluginKey's isChangeOrigin correctly), then
// leafMarksPlugin, then rootAttrsPlugin (see workarounds/leafMarks.ts's own
// comment on why this order matters -- copied verbatim from spike 5's
// src/client.ts construction).
import type { Plugin } from 'prosemirror-state';
import * as Y from 'yjs';
import { ySyncPlugin, initProseMirrorDoc } from '@tiptap/y-tiptap';
import { FRAGMENT_NAME } from './codec.js';
import { leafMarksPlugin, type LeafMarksStats } from './workarounds/leafMarks.js';
import { rootAttrsPlugin, type RootAttrsStats } from './workarounds/rootAttrs.js';

/** The mapping type `initProseMirrorDoc` returns, threaded through to `ySyncPlugin` without naming @tiptap/y-tiptap's (unexported) mapping type directly. */
export type ProsemirrorMapping = ReturnType<typeof initProseMirrorDoc>['mapping'];

export interface EditorPluginsOpts {
  /**
   * The mapping `initProseMirrorDoc(fragment, schema)` produced, when the
   * caller built its initial EditorState from that helper (required for
   * ySyncPlugin to reuse the same fragment<->PM node mapping instead of
   * rebuilding one). Optional: omitted, ySyncPlugin builds its own.
   */
  mapping?: ProsemirrorMapping;
  /** Reserved for a future cursors plugin (yjs awareness); not implemented in brief 01. */
  cursors?: boolean;
  /** Reserved for a future Yjs-aware undo plugin; not implemented in brief 01. */
  undo?: boolean;
  /** Stats objects the workaround plugins accumulate into, for tests/gates that want to observe them. */
  stats?: { leafMarks?: LeafMarksStats; rootAttrs?: RootAttrsStats };
}

/** The plugins a live ProseMirror EditorView binds to `doc`'s `prosemirror` fragment. */
export function editorPlugins(doc: Y.Doc, opts: EditorPluginsOpts = {}): Plugin[] {
  const fragment = doc.getXmlFragment(FRAGMENT_NAME);
  const plugins: Plugin[] = [
    ySyncPlugin(fragment, opts.mapping ? { mapping: opts.mapping } : undefined),
    leafMarksPlugin(opts.stats?.leafMarks),
    rootAttrsPlugin(doc, opts.stats?.rootAttrs),
  ];
  return plugins;
}
