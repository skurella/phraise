// Brief 06 (comments, gate F), task 3: wraps `commentHighlightPlugin` (a
// plain ProseMirror plugin) as a Tiptap `Extension`, same pattern as
// `src/collab/tiptapWorkaroundsExtension.ts` wrapping the two Yjs
// workaround plugins.
import { Extension } from '@tiptap/core';
import * as Y from 'yjs';
import { commentHighlightPlugin, type CommentHighlightOptions } from './highlightPlugin.js';

export const CommentHighlights = Extension.create<CommentHighlightOptions>({
  name: 'commentHighlights',
  addOptions() {
    return { ydoc: new Y.Doc(), getActiveThreadId: () => null, onActivate: () => {} };
  },
  addProseMirrorPlugins() {
    return [commentHighlightPlugin(this.options)];
  },
});
