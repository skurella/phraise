// Brief 02, task 2 (lists): Enter to add an item, Tab/Shift-Tab to nest/lift.
//
// Not a hand-rolled command: `@tiptap/core`'s `Commands` core extension (see
// its `src/extensions/commands.ts`, always present regardless of which
// extensions the editor is given) exposes `splitListItem`/`sinkListItem`/
// `liftListItem` as generic commands that resolve a node type BY NAME
// against whatever schema the editor actually has -- confirmed by reading
// their source, they are `prosemirror-schema-list`-equivalent
// reimplementations, including `splitListItem`'s "bail out on an empty
// TOP-LEVEL item" behaviour (only a nested item's Enter is handled here;
// see below for why that is correct, not a gap).
//
// "Enter on an empty item to leave the list" needs no extra code: Tiptap
// core's default Enter chain (`newlineInCode, createParagraphNear,
// liftEmptyBlock, splitBlock`) already tries `liftEmptyBlock` -- a generic
// "lift this empty textblock out of its parent" command -- before falling
// back to a plain split, and `splitListItem` above returns `false` for a
// non-nested empty item specifically so that fallback chain still runs.
// Confirmed by reading `@tiptap/core`'s `get plugins()`: extensions are
// reversed then stably sorted (all default priority 100) before becoming
// plugins, so USER extensions' keymaps -- this one included -- are tried
// before the core Keymap extension's defaults, and a handler returning
// `false` correctly falls through to the next plugin's binding for the same
// key, all the way down to core's own chain.
import { Extension } from '@tiptap/core';

export const ListKeymap = Extension.create({
  name: 'listKeymap',
  addKeyboardShortcuts() {
    return {
      Enter: () => this.editor.commands.splitListItem('list_item'),
      Tab: () => this.editor.commands.sinkListItem('list_item'),
      'Shift-Tab': () => this.editor.commands.liftListItem('list_item'),
    };
  },
});
