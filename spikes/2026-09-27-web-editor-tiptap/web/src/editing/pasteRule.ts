// Brief 02, task 3 (paste): "text/plain that is Markdown ... becomes rich
// content through spike 1's parseMarkdown; text/html from another app goes
// through the schema's parseDOM."
//
// Only the Markdown-recognized text/plain path needs custom code here: when
// `looksLikeMarkdown` (see `src/editing/pasteMarkdown.ts`) says no, this
// plugin returns `false` from `handlePaste` and lets ProseMirror's own
// default paste pipeline run, which already parses a pasted `text/html`
// payload through the schema's `parseDOM` (that pipeline is exactly why
// `src/model/schema.ts` has `parseDOM` rules at all -- brief 03/05's
// comment there: "so a live jsdom EditorView can render this schema and so
// `view.pasteHTML` ... has parse rules to build a paste Slice from") -- and
// falls back to plain text otherwise. No custom HTML handling is written
// here at all.
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Slice } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';
import { looksLikeMarkdown, buildMarkdownPasteContent } from '../../../src/editing/pasteMarkdown.js';

export const MarkdownPasteRule = Extension.create({
  name: 'markdownPasteRule',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('markdownPasteRule'),
        props: {
          handlePaste(view: EditorView, event: ClipboardEvent): boolean {
            const text = event.clipboardData?.getData('text/plain') ?? '';
            if (!text || !looksLikeMarkdown(text)) return false;

            const { fragment } = buildMarkdownPasteContent(text, view.state.schema);
            if (fragment.childCount === 0) return false;
            // A fully closed slice (openStart=openEnd=0): inline content
            // (a single-line, single-paragraph fragment; see
            // `buildMarkdownPasteContent`) fits directly into the
            // surrounding paragraph's inline stream; block content splits
            // the current block at the caret and inserts between the two
            // halves -- both are ProseMirror's own standard `replace`
            // fitting behaviour for a closed slice, not anything this
            // plugin special-cases.
            const slice = new Slice(fragment, 0, 0);
            view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView());
            return true;
          },
        },
      }),
    ];
  },
});
