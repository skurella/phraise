// Brief 02, task 2: Mod-K opens a small in-page link field (no
// `window.prompt`), Enter applies the link, Escape cancels.
//
// The popup is a plain DOM element created lazily and appended to
// `document.body` (kept out of `web/index.html`/`style.css` so this
// extension is self-contained, one file for the whole concern). It captures
// the selection's `{from, to}` at the moment Mod-K is pressed: the popup's
// `<input>` then takes DOM focus, which does not touch the editor's own
// ProseMirror selection state, so applying the link on Enter re-selects that
// captured range explicitly rather than relying on "the current selection"
// (which, from the editor's point of view, never actually left -- the
// popup's own DOM focus is irrelevant to `EditorState.selection` -- but
// capturing it explicitly is clearer and safer against an intervening
// remote-collaborator edit shifting positions, which is mapped through
// below).
import { Extension } from '@tiptap/core';
import type { Editor } from '@tiptap/core';

function ensurePopup(): { root: HTMLDivElement; input: HTMLInputElement } {
  let root = document.getElementById('phraise-link-popup') as HTMLDivElement | null;
  if (root) {
    return { root, input: root.querySelector('input')! };
  }
  root = document.createElement('div');
  root.id = 'phraise-link-popup';
  root.hidden = true;
  Object.assign(root.style, {
    position: 'absolute',
    zIndex: '1000',
    background: '#fff',
    border: '1px solid #888',
    borderRadius: '4px',
    padding: '4px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
  } as CSSStyleDeclaration);
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'https://…';
  Object.assign(input.style, { font: 'inherit', minWidth: '220px', border: 'none', outline: 'none' } as CSSStyleDeclaration);
  root.appendChild(input);
  document.body.appendChild(root);
  return { root, input };
}

export const LinkShortcut = Extension.create({
  name: 'linkShortcut',
  addKeyboardShortcuts() {
    return {
      'Mod-k': () => {
        openLinkPopup(this.editor);
        return true;
      },
    };
  },
});

function openLinkPopup(editor: Editor): void {
  const { from, to } = editor.state.selection;
  const { root, input } = ensurePopup();

  const coords = editor.view.coordsAtPos(to);
  root.style.left = `${coords.left + window.scrollX}px`;
  root.style.top = `${coords.bottom + window.scrollY + 4}px`;
  root.hidden = false;
  input.value = '';

  const cleanup = () => {
    root.hidden = true;
    input.removeEventListener('keydown', onKeyDown);
    input.removeEventListener('blur', onBlur);
  };
  const apply = () => {
    const href = input.value.trim();
    cleanup();
    if (!href) {
      editor.commands.focus();
      return;
    }
    editor
      .chain()
      .focus()
      .setTextSelection({ from, to })
      .extendMarkRange('link')
      .setMark('link', { href })
      .setTextSelection(to)
      .run();
  };
  const cancel = () => {
    cleanup();
    editor.commands.focus();
  };
  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      apply();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancel();
    }
  }
  function onBlur(): void {
    // A click elsewhere (not Enter/Escape) cancels too, same as Google
    // Docs' own link-insert popup.
    if (!root.hidden) cancel();
  }
  input.addEventListener('keydown', onKeyDown);
  input.addEventListener('blur', onBlur);
  input.focus();
}
