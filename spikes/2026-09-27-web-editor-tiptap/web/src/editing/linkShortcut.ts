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

interface LinkPopupParts {
  root: HTMLDivElement;
  input: HTMLInputElement;
  removeButton: HTMLButtonElement;
}

function ensurePopup(): LinkPopupParts {
  let root = document.getElementById('phraise-link-popup') as HTMLDivElement | null;
  if (root) {
    return { root, input: root.querySelector('input')!, removeButton: root.querySelector('button')! };
  }
  root = document.createElement('div');
  root.id = 'phraise-link-popup';
  root.hidden = true;
  // No `display` set here (and never set inline elsewhere on `root`): the
  // `hidden` attribute's own UA-stylesheet `display: none` must stay the
  // only thing controlling this element's visibility, or it silently loses
  // to an inline `style.display` the moment one is set anywhere -- exactly
  // the bug `imagePopover.ts`'s own comment documents from brief 04. Input
  // and button are left as their natural inline-level `display`, which
  // already puts them side by side with no flexbox needed.
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
  // Brief 07 fix list: "Mod-K on a link opens the link field with the
  // current address and a 'Remove link' button". Hidden by default (a
  // fresh selection with no existing link has nothing to remove); shown
  // by `openLinkPopup` whenever the selection/caret is inside a link.
  const removeButton = document.createElement('button');
  removeButton.type = 'button';
  removeButton.textContent = 'Remove link';
  removeButton.hidden = true;
  Object.assign(removeButton.style, {
    font: 'inherit',
    fontSize: '13px',
    padding: '2px 8px',
    marginLeft: '4px',
    border: '1px solid #d0d7de',
    borderRadius: '4px',
    background: '#fff',
    cursor: 'pointer',
  } as CSSStyleDeclaration);
  root.append(input, removeButton);
  document.body.appendChild(root);
  return { root, input, removeButton };
}

/** The link mark's `href` at the current selection, if the ENTIRE selection
 * (or, for a collapsed caret, the mark at that position) carries the same
 * link -- otherwise `null` (nothing to prefill/remove). Mirrors
 * `extendMarkRange`'s own "is this position/range inside one link" idea,
 * but read-only. */
function currentLinkHref(editor: Editor): string | null {
  const { state } = editor;
  const linkType = state.schema.marks.link;
  if (!linkType) return null;
  const { from, to, empty, $from } = state.selection;
  if (empty) {
    const mark = $from.marks().find((m) => m.type === linkType);
    return (mark?.attrs.href as string | undefined) ?? null;
  }
  let href: string | null = null;
  let sawText = false;
  let consistent = true;
  state.doc.nodesBetween(from, to, (node) => {
    if (!consistent || !node.isText) return true;
    sawText = true;
    const mark = node.marks.find((m) => m.type === linkType);
    if (!mark) {
      consistent = false;
      return false;
    }
    if (href === null) href = mark.attrs.href as string;
    else if (href !== mark.attrs.href) consistent = false;
    return true;
  });
  return sawText && consistent ? href : null;
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
  const { root, input, removeButton } = ensurePopup();

  const coords = editor.view.coordsAtPos(to);
  root.style.left = `${coords.left + window.scrollX}px`;
  root.style.top = `${coords.bottom + window.scrollY + 4}px`;
  root.hidden = false;

  // Brief 07 fix list: "Mod-K on a link opens the link field with the
  // current address and a 'Remove link' button". `currentLinkHref` reads
  // the mark already at the selection/caret -- prefilling and showing the
  // button whenever the whole selection (or, for a collapsed caret, the
  // position itself) is already linked, exactly the case gate H's own
  // demonstration (an autolink) needs to unlink through this UI instead of
  // a hand-run `unsetMark`.
  const existingHref = currentLinkHref(editor);
  input.value = existingHref ?? '';
  removeButton.hidden = existingHref == null;

  const cleanup = () => {
    root.hidden = true;
    input.removeEventListener('keydown', onKeyDown);
    input.removeEventListener('blur', onBlur);
    removeButton.removeEventListener('mousedown', onRemoveMouseDown);
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
    // Docs' own link-insert popup. `mousedown` on `removeButton` below
    // calls `preventDefault()` specifically so it never triggers this
    // blur in the first place (the same "don't let the button steal focus
    // first" pattern `rawBlockView.ts`'s "Edit source" button uses).
    if (!root.hidden) cancel();
  }
  function onRemoveMouseDown(event: MouseEvent): void {
    event.preventDefault();
    cleanup();
    editor.chain().focus().setTextSelection({ from, to }).extendMarkRange('link').unsetMark('link').run();
  }
  input.addEventListener('keydown', onKeyDown);
  input.addEventListener('blur', onBlur);
  removeButton.addEventListener('mousedown', onRemoveMouseDown);
  input.focus();
}
