// Brief 03, task 3: keyboard wiring for the pure position logic in
// `src/editing/sourceBlockBoundary.ts`. Placed AFTER (later in the
// extensions array than) the other keymap extensions in `web/src/main.ts`,
// same convention as `tableKeymap.ts`/`listKeymap.ts` (extensions are
// reversed before becoming plugins, so the last one here is tried first) --
// it needs to run before Tiptap core's own default Backspace/Delete chain
// (`joinBackward`/`joinForward`) so a `raw_block` boundary is protected
// before the default join ever gets a chance to corrupt it.
import { Extension } from '@tiptap/core';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import type { EditorState } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import {
  rawBlockBeforeCursorAtStart,
  rawBlockAfterCursorAtEnd,
  exitPositionAfterCodeNode,
  isOnLastLineOfCodeNode,
} from '../../../src/editing/sourceBlockBoundary.js';

type EditorLike = { state: EditorState; view: EditorView };

function selectRawBlockBefore(editor: EditorLike): boolean {
  const { state, view } = editor;
  const { $from, empty } = state.selection;
  if (!empty) return false;
  const pos = rawBlockBeforeCursorAtStart($from);
  if (pos == null) return false;
  view.dispatch(state.tr.setSelection(NodeSelection.create(state.doc, pos)));
  return true;
}

function selectRawBlockAfter(editor: EditorLike): boolean {
  const { state, view } = editor;
  const { $from, empty } = state.selection;
  if (!empty) return false;
  const pos = rawBlockAfterCursorAtEnd($from);
  if (pos == null) return false;
  view.dispatch(state.tr.setSelection(NodeSelection.create(state.doc, pos)));
  return true;
}

/** "A way out" of a source block's own source (task 3): Mod-Enter always,
 * ArrowDown only when the cursor is already on the block's last line (so
 * moving between internal lines of a multi-line source is unaffected). */
function exitSourceBlock(editor: EditorLike): boolean {
  const { state, view } = editor;
  const { $from, empty } = state.selection;
  if (!empty) return false;
  const exit = exitPositionAfterCodeNode($from);
  if (!exit) return false;
  if ('existingBlockContentStart' in exit) {
    view.dispatch(state.tr.setSelection(TextSelection.near(state.doc.resolve(exit.existingBlockContentStart), 1)));
    return true;
  }
  const paragraph = state.schema.nodes.paragraph!.createAndFill()!;
  const tr = state.tr.insert(exit.insertAt, paragraph);
  tr.setSelection(TextSelection.near(tr.doc.resolve(exit.insertAt + 1)));
  view.dispatch(tr);
  return true;
}

function exitSourceBlockOnArrowDown(editor: EditorLike): boolean {
  const { $from, empty } = editor.state.selection;
  if (!empty || !isOnLastLineOfCodeNode($from)) return false;
  return exitSourceBlock(editor);
}

export const SourceBlockKeymap = Extension.create({
  name: 'sourceBlockKeymap',
  addKeyboardShortcuts() {
    return {
      Backspace: () => selectRawBlockBefore(this.editor),
      Delete: () => selectRawBlockAfter(this.editor),
      'Mod-Enter': () => exitSourceBlock(this.editor),
      ArrowDown: () => exitSourceBlockOnArrowDown(this.editor),
    };
  },
});
