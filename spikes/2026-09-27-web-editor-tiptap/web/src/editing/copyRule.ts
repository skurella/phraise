// Brief 02, task 3 (copy): "a selection puts text/plain holding Markdown ...
// and text/html holding the rendered HTML."
//
// A real native `copy`/`cut` DOM event, not a synthetic one: this plugin's
// `handleDOMEvents.copy`/`.cut` intercept the browser's own event, write our
// own `text/plain`/`text/html` onto `event.clipboardData`, and
// `preventDefault()` so the browser does not also write its default
// selection-derived clipboard content over ours.
//
// `sliceToMarkdown` (`src/editing/copyMarkdown.ts`) is called with
// `state.schema` -- the LIVE, Tiptap-converted schema the slice's nodes
// actually belong to -- not spike 1's canonical schema instance. That is
// safe (and simpler than the cross-schema `toJSON`/`fromJSON` conversion
// `src/editing/pasteMarkdown.ts` needs) because `serializeDoc`'s own
// verification compares nodes by `.type.name`, not by NodeType reference
// (see `src/model/compare.ts`'s `semanticEq` comment, "brief 03/gate D"): a
// paste has to hand ProseMirror actual instances of the live schema's node
// types to insert them into a transaction, but a copy only ever produces a
// string, so there is nothing that needs the canonical schema instance here.
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { DOMSerializer } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';
import { sliceToMarkdown } from '../../../src/editing/copyMarkdown.js';

function writeClipboard(view: EditorView, event: ClipboardEvent): boolean {
  const { state } = view;
  if (state.selection.empty) return false;
  const slice = state.selection.content();

  const markdown = sliceToMarkdown(slice, state.schema);
  const serializer = DOMSerializer.fromSchema(state.schema);
  const domFragment = serializer.serializeFragment(slice.content);
  const container = document.createElement('div');
  container.appendChild(domFragment);

  if (!event.clipboardData) return false;
  event.clipboardData.setData('text/plain', markdown);
  event.clipboardData.setData('text/html', container.innerHTML);
  event.preventDefault();
  return true;
}

export const MarkdownCopyRule = Extension.create({
  name: 'markdownCopyRule',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('markdownCopyRule'),
        props: {
          handleDOMEvents: {
            copy: (view, event) => writeClipboard(view, event),
            cut: (view, event) => {
              const handled = writeClipboard(view, event);
              if (handled) view.dispatch(view.state.tr.deleteSelection());
              return handled;
            },
          },
        },
      }),
    ];
  },
});
