// Brief 06 (comments, gate F), task 2: build an `AnchoringContext` from the
// EDITOR's own live `ySyncPlugin` binding -- "resolve ... through the
// binding's mapping", literally: `binding.doc`/`binding.type`/
// `binding.mapping` are exactly the fields
// `src/collab/workarounds/localCaretFollow.ts` already reads (see that
// file's own comment), and `state.doc` is the editor's current document, no
// separate reconstruction needed (unlike the headless path in
// `src/comments/anchor.ts`'s `contextFromYDoc`, which has no live binding to
// read and must rebuild one via `initProseMirrorDoc`).
import type { EditorState } from 'prosemirror-state';
import * as Y from 'yjs';
import { ySyncPluginKey } from '@tiptap/y-tiptap';
import { contextFromBinding, type AnchoringContext } from '../../../src/comments/anchor.js';

interface YSyncBinding {
  doc: Y.Doc;
  type: Y.XmlFragment;
  mapping: unknown;
}

/** Returns null only if the Collaboration extension isn't installed at all
 * (should not happen in this app, but a defensive null is cheaper than a
 * throw for what is ultimately a decoration/sidebar concern). */
export function liveAnchoringContext(state: EditorState): AnchoringContext | null {
  const syncState = ySyncPluginKey.getState(state) as { binding?: YSyncBinding } | undefined;
  const binding = syncState?.binding;
  if (!binding) return null;
  return contextFromBinding(binding.doc, binding.type, binding.mapping as Parameters<typeof contextFromBinding>[2], state.doc);
}
