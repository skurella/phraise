// Brief 06 (comments, gate F), task 4: "Adding a comment: select text, then
// a small floating 'Comment' button next to the selection or Mod-Alt-M
// (Google Docs' shortcut); focus goes to the composer."
//
// Same lazy-DOM-element pattern as `web/src/editing/imagePopover.ts`/
// `linkShortcut.ts`: one element created on first use and appended to
// `document.body`, positioned inline (`left`/`top` only -- everything else
// lives in `style.css`, per that file's own comment about `hidden` vs an
// inline `display` fighting each other).
import { Extension } from '@tiptap/core';
import type { Editor } from '@tiptap/core';

function ensureButton(onClick: () => void): HTMLButtonElement {
  let button = document.getElementById('phraise-comment-button') as HTMLButtonElement | null;
  if (button) return button;
  button = document.createElement('button');
  button.id = 'phraise-comment-button';
  button.type = 'button';
  button.textContent = 'Comment';
  button.hidden = true;
  button.addEventListener('mousedown', (e) => {
    // Prevent the editor's selection from collapsing before onClick runs
    // (a plain click on a button outside the editable steals focus first).
    e.preventDefault();
  });
  button.addEventListener('click', () => onClick());
  document.body.appendChild(button);
  return button;
}

export interface CommentTriggerOptions {
  onStartComment: (from: number, to: number) => void;
}

export const CommentTrigger = Extension.create<CommentTriggerOptions>({
  name: 'commentTrigger',
  addOptions() {
    return { onStartComment: () => {} };
  },
  addKeyboardShortcuts() {
    return {
      'Mod-Alt-m': () => {
        const { from, to, empty } = this.editor.state.selection;
        if (empty) return false;
        this.options.onStartComment(from, to);
        return true;
      },
    };
  },
  onCreate() {
    const editor: Editor = this.editor;
    const button = ensureButton(() => {
      const { from, to } = editor.state.selection;
      button.hidden = true;
      this.options.onStartComment(from, to);
    });

    const updateButton = () => {
      const { from, to, empty } = editor.state.selection;
      if (empty || !editor.isFocused) {
        button.hidden = true;
        return;
      }
      const coords = editor.view.coordsAtPos(to);
      button.style.left = `${coords.right + window.scrollX + 6}px`;
      button.style.top = `${coords.top + window.scrollY - 4}px`;
      button.hidden = false;
    };

    editor.on('selectionUpdate', updateButton);
    editor.on('blur', () => {
      // Deferred: a click ON the button itself first blurs the editor, and
      // hiding synchronously here would remove it before its own click
      // handler fires.
      setTimeout(() => {
        if (!editor.isFocused) button.hidden = true;
      }, 150);
    });
  },
});
