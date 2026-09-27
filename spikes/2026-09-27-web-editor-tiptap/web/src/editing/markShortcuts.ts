// Brief 02, task 2: Mod-B (bold), Mod-I (italic), Mod-E (inline code).
//
// Google Docs has no shortcut for inline code (there is no inline-code
// concept in Docs at all); Mod-E is this spike's own choice -- documented
// here since the brief asks for it to be documented. `Mod-E` was picked
// because it is unused by both browsers and by every other shortcut in this
// spike (Mod-K is the link field, Mod-B/I are the usual bold/italic), and it
// echoes the letter already used for the `code` mark's HTML tag.
//
// `editor.commands.toggleMark(name)` is a generic core command (from
// `@tiptap/core`'s always-present `Commands` extension, see
// `listKeymap.ts`'s comment) that resolves the mark by name against the
// editor's actual schema and already toggles off when the mark is active at
// the selection -- covers "toggling bold off again" with no extra code.
import { Extension } from '@tiptap/core';

export const MarkShortcuts = Extension.create({
  name: 'markShortcuts',
  addKeyboardShortcuts() {
    return {
      'Mod-b': () => this.editor.commands.toggleMark('strong'),
      'Mod-i': () => this.editor.commands.toggleMark('em'),
      'Mod-e': () => this.editor.commands.toggleMark('code'),
    };
  },
});
