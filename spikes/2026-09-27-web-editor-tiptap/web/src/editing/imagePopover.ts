// Brief 04, task 2: clicking an image opens a small in-page popover with two
// fields ("Image address", "Link") and Apply/Remove-link buttons. The pure
// half (new attrs/marks from the two field values) is
// `src/editing/imageEdit.ts`; this file is the DOM layer, same pattern as
// `linkShortcut.ts` (a lazily-created popup appended to `document.body`,
// kept out of `index.html`/`style.css` so this extension is self-contained).
//
// Apply/Remove-link both dispatch exactly ONE transaction
// (`tr.setNodeMarkup(pos, undefined, attrs, marks)`), changing the image's
// `url` attr and its `link` mark together -- this IS spike 5's gate B3 edit
// (see `imageEdit.ts`'s file comment for why that matters on this stack).
import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from 'prosemirror-model';
import { buildImageEdit } from '../../../src/editing/imageEdit.js';

function ensurePopup(): { root: HTMLDivElement; address: HTMLInputElement; link: HTMLInputElement; apply: HTMLButtonElement; removeLink: HTMLButtonElement } {
  let root = document.getElementById('phraise-image-popover') as HTMLDivElement | null;
  if (root) {
    return {
      root,
      address: root.querySelector('input[name="address"]')!,
      link: root.querySelector('input[name="link"]')!,
      apply: root.querySelector('button[data-action="apply"]')!,
      removeLink: root.querySelector('button[data-action="remove-link"]')!,
    };
  }
  root = document.createElement('div');
  root.id = 'phraise-image-popover';
  root.hidden = true;
  // Static layout/appearance lives in style.css (`#phraise-image-popover`),
  // NOT as an inline style here: a real bug found while testing this popover
  // (not guessed -- see the builder log) was setting `display: 'flex'` as
  // an inline style, which -- being higher specificity than the UA
  // stylesheet's default `[hidden] { display: none }` -- permanently
  // overrode the `hidden` property/attribute, so the popover never actually
  // visually hid despite `root.hidden` correctly toggling. Only the
  // per-open dynamic position (`left`/`top`) is set inline, below.
  root.className = 'phraise-image-popover';

  function fieldRow(labelText: string, name: string): HTMLInputElement {
    const label = document.createElement('label');
    label.style.display = 'flex';
    label.style.flexDirection = 'column';
    label.style.gap = '2px';
    const span = document.createElement('span');
    span.textContent = labelText;
    const input = document.createElement('input');
    input.type = 'text';
    input.name = name;
    Object.assign(input.style, { font: 'inherit', minWidth: '220px' } as CSSStyleDeclaration);
    label.appendChild(span);
    label.appendChild(input);
    root!.appendChild(label);
    return input;
  }

  const address = fieldRow('Image address', 'address');
  const link = fieldRow('Link', 'link');

  const buttonRow = document.createElement('div');
  buttonRow.style.display = 'flex';
  buttonRow.style.gap = '6px';
  buttonRow.style.justifyContent = 'flex-end';

  const removeLink = document.createElement('button');
  removeLink.type = 'button';
  removeLink.textContent = 'Remove link';
  removeLink.dataset.action = 'remove-link';

  const apply = document.createElement('button');
  apply.type = 'button';
  apply.textContent = 'Apply';
  apply.dataset.action = 'apply';

  buttonRow.appendChild(removeLink);
  buttonRow.appendChild(apply);
  root.appendChild(buttonRow);
  document.body.appendChild(root);

  return { root, address, link, apply, removeLink };
}

export const ImagePopover = Extension.create({
  name: 'imagePopover',
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        props: {
          handleClickOn(_view, pos, node) {
            if (node.type.name !== 'image') return false;
            openImagePopover(editor, pos, node);
            return true;
          },
        },
      }),
    ];
  },
});

function openImagePopover(editor: Editor, pos: number, node: PMNode): void {
  const { root, address, link, apply, removeLink } = ensurePopup();

  const coords = editor.view.coordsAtPos(pos);
  root.style.left = `${coords.left + window.scrollX}px`;
  root.style.top = `${coords.bottom + window.scrollY + 4}px`;
  root.hidden = false;

  address.value = node.attrs.url ?? '';
  const existingLink = node.marks.find((m) => m.type.name === 'link');
  link.value = (existingLink?.attrs.href as string | undefined) ?? '';

  const cleanup = () => {
    root.hidden = true;
    apply.removeEventListener('click', onApply);
    removeLink.removeEventListener('click', onRemoveLink);
    document.removeEventListener('mousedown', onDocMouseDown, true);
  };

  /** Re-reads the node at `pos` at edit time (not the one captured when the
   * popover opened): a remote collaborator's edit could have changed the
   * document while the popover was open, and this must never blindly
   * `setNodeMarkup` at a position that no longer holds an image. */
  function currentImageNode(): { node: PMNode; pos: number } | null {
    const at = editor.state.doc.nodeAt(pos);
    if (at && at.type.name === 'image') return { node: at, pos };
    return null;
  }

  function applyEdit(hrefOverride: string | null | undefined): void {
    const found = currentImageNode();
    if (!found) {
      cleanup();
      return;
    }
    const href = hrefOverride !== undefined ? hrefOverride : link.value;
    const { attrs, marks } = buildImageEdit(editor.state.schema, found.node, { url: address.value, href });
    const tr = editor.state.tr.setNodeMarkup(found.pos, undefined, attrs, marks);
    editor.view.dispatch(tr);
    cleanup();
  }

  function onApply(): void {
    applyEdit(undefined);
  }
  function onRemoveLink(): void {
    link.value = '';
    applyEdit(null);
  }
  function onDocMouseDown(event: MouseEvent): void {
    if (!root.contains(event.target as Node)) cleanup();
  }

  apply.addEventListener('click', onApply);
  removeLink.addEventListener('click', onRemoveLink);
  // Capture phase, next tick: the click that OPENED the popover is still
  // bubbling when this handler is attached synchronously in the same
  // dispatch; without deferring, that same click would immediately close it.
  setTimeout(() => document.addEventListener('mousedown', onDocMouseDown, true), 0);
}
