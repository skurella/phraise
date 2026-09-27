// Brief 02, task 2 (tables): Tab/Shift-Tab move between cells; Tab in the
// last cell does not insert a tab character (it is swallowed: returning
// `true` while not moving the selection, rather than falling through to
// whatever default Tab behaviour a contentEditable has). Pure cell-finding
// logic lives in `src/editing/tableNav.ts` (schema-only, no DOM, unit
// tested); this file is just the keyboard wiring.
//
// Registered in `web/src/main.ts` AFTER `ListKeymap` in the extensions
// array: `@tiptap/core` reverses extensions before turning them into
// plugins (see `listKeymap.ts`'s comment), so the LAST extension's Tab
// binding is tried FIRST. Tables and lists never nest into each other in
// this schema, but ordering it this way means "not in a table" cleanly
// falls through to the list handler either way.
import { Extension } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { isInTableCell, findNextCell, findPreviousCell } from '../../../src/editing/tableNav.js';

export const TableKeymap = Extension.create({
  name: 'tableKeymap',
  addKeyboardShortcuts() {
    return {
      Tab: () => moveToCell(this.editor, findNextCell),
      'Shift-Tab': () => moveToCell(this.editor, findPreviousCell),
    };
  },
});

function moveToCell(
  editor: { state: import('@tiptap/pm/state').EditorState; view: import('@tiptap/pm/view').EditorView },
  find: (doc: import('@tiptap/pm/model').Node, pos: number) => number | null,
): boolean {
  const { state, view } = editor;
  const pos = state.selection.from;
  if (!isInTableCell(state.doc, pos)) return false;
  const target = find(state.doc, pos);
  // No cell to move to (e.g. Tab in the very last cell): swallow the key so
  // no tab character is inserted, but do not move the selection.
  if (target == null) return true;
  const tr = state.tr.setSelection(TextSelection.near(state.doc.resolve(target)));
  view.dispatch(tr);
  return true;
}
