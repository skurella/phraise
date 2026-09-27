// Brief 03, task 2: the `raw_block` node view. Structure:
//   <div class="phraise-source-block">
//     <div class="phraise-source-label">HTML  [Edit source]</div>
//     <div class="phraise-source-preview">...rendered preview...</div>
//     <pre class="phraise-source-editor">...contentDOM, always present...</pre>
//   </div>
// The source editor (`contentDOM`) is the node's real, always-editable
// content -- ProseMirror needs it in the DOM to track the caret and dispatch
// edits regardless of which of preview/editor is visually shown; CSS
// (`.phraise-editing` on the wrapper, see `web/src/style.css`) toggles which
// one is visible. "Editing" is exactly "the current selection is inside this
// node", tracked via the editor's own `selectionUpdate` event (a NodeView
// has no other hook for "the caret moved" -- ProseMirror does not call
// `update()` just because the selection changed elsewhere in the same
// node), or the "Edit source" button, which simply moves the selection
// there itself (after which `selectionUpdate` takes over).
import type { Editor, NodeViewRendererProps } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { NodeView } from '@tiptap/pm/view';
import katex from 'katex';
import { labelForRawBlockKind } from '../../../src/editing/rawBlockLabels.js';
import { sanitizeRawHtml } from '../../../src/editing/sanitizeHtml.js';
import { parseFlatFrontMatter, stripFrontMatterFences } from '../../../src/editing/frontMatterPreview.js';
import { parseFootnoteDefinition, parseLinkReferenceDefinition } from '../../../src/editing/definitionPreview.js';
import { keepUnverifiedBlock } from '../editing/unverifiedCheck.js';

class RawBlockView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  private node: PMNode;
  private readonly editor: Editor;
  private readonly getPos: () => number | undefined;
  private readonly previewEl: HTMLElement;
  private readonly labelEl: HTMLElement;
  private readonly selectionHandler: () => void;

  constructor(node: PMNode, editor: Editor, getPos: () => number | undefined) {
    this.node = node;
    this.editor = editor;
    this.getPos = getPos;

    this.dom = document.createElement('div');
    this.dom.className = 'phraise-source-block';
    // A plain data attribute for tests (and any future styling) to select
    // by kind without depending on the label's own translated text.
    this.dom.dataset.rawBlockKind = node.attrs.kind as string;

    this.labelEl = document.createElement('div');
    this.labelEl.className = 'phraise-source-label';

    this.previewEl = document.createElement('div');
    this.previewEl.className = 'phraise-source-preview';

    this.contentDOM = document.createElement('pre');
    this.contentDOM.className = 'phraise-source-editor';

    this.dom.append(this.labelEl, this.previewEl, this.contentDOM);

    this.renderLabel();
    this.renderPreview();

    this.selectionHandler = () => this.updateEditingState();
    this.editor.on('selectionUpdate', this.selectionHandler);
    // Brief 07 fix list: a raw block that happens to sit at the position
    // ProseMirror's initial (unfocused) selection resolves to -- routinely
    // front matter, since it is usually the document's very first block --
    // must not open in "editing" (raw source) mode before the user has ever
    // actually focused the editor. `editor.isFocused` gates this below, so
    // `focus`/`blur` need their own listeners too: a plain `selectionUpdate`
    // does not fire just because focus moved into or out of the editor with
    // the ProseMirror selection itself unchanged (e.g. blurring to click a
    // toolbar button, or the very first click landing exactly on the
    // existing default selection).
    this.editor.on('focus', this.selectionHandler);
    this.editor.on('blur', this.selectionHandler);
    this.updateEditingState();
  }

  /**
   * Brief 03, task 5 (gate H): kind `unverified` replaces the normal
   * label/edit-source chrome with the plain-language banner the brief
   * describes ("Phraise can't save this formatting exactly. This is what
   * will be saved.") and two buttons. The source editor stays permanently
   * visible for this kind (no preview to toggle back to -- the whole point
   * is showing exactly what will be saved), so `updateEditingState` is a
   * no-op for it (see below).
   */
  private isUnverified(): boolean {
    return (this.node.attrs.kind as string) === 'unverified';
  }

  private renderLabel(): void {
    this.labelEl.innerHTML = '';
    if (this.isUnverified()) {
      this.labelEl.classList.add('phraise-unverified-banner');
      const message = document.createElement('div');
      message.className = 'phraise-unverified-message';
      message.textContent = "Phraise can't save this formatting exactly. This is what will be saved.";
      const buttons = document.createElement('div');
      buttons.className = 'phraise-unverified-buttons';
      const keepButton = document.createElement('button');
      keepButton.type = 'button';
      keepButton.textContent = 'Keep this';
      keepButton.addEventListener('mousedown', (event) => {
        event.preventDefault();
        keepUnverifiedBlock(this.editor, this.getPos);
      });
      const undoButton = document.createElement('button');
      undoButton.type = 'button';
      undoButton.textContent = 'Undo my change';
      undoButton.addEventListener('mousedown', (event) => {
        event.preventDefault();
        this.editor.commands.undo();
      });
      buttons.append(keepButton, undoButton);
      this.labelEl.append(message, buttons);
      this.dom.classList.add('phraise-editing'); // always show the source text
      return;
    }
    this.labelEl.classList.remove('phraise-unverified-banner');
    const labelTextEl = document.createElement('span');
    labelTextEl.textContent = labelForRawBlockKind(this.node.attrs.kind as string);
    const editButton = document.createElement('button');
    editButton.type = 'button';
    editButton.className = 'phraise-edit-source-button';
    editButton.textContent = 'Edit source';
    editButton.addEventListener('mousedown', (event) => {
      event.preventDefault();
      const pos = this.getPos();
      if (pos == null) return;
      this.editor.commands.focus();
      this.editor.commands.setTextSelection(pos + 1);
    });
    this.labelEl.append(labelTextEl, editButton);
  }

  private renderPreview(): void {
    const kind = this.node.attrs.kind as string;
    const text = this.node.textContent;
    this.previewEl.innerHTML = '';
    if (kind === 'unverified') return; // no preview mode: the source IS the message.

    if (kind === 'html') {
      const wrap = document.createElement('div');
      wrap.className = 'phraise-html-preview';
      wrap.innerHTML = sanitizeRawHtml(text);
      this.previewEl.appendChild(wrap);
      return;
    }

    if (kind === 'yaml' || kind === 'toml') {
      const fenceless = stripFrontMatterFences(text);
      const entries = parseFlatFrontMatter(fenceless);
      if (entries && entries.length > 0) {
        const dl = document.createElement('dl');
        dl.className = 'phraise-frontmatter-preview';
        for (const { key, value } of entries) {
          const dt = document.createElement('dt');
          dt.textContent = key;
          const dd = document.createElement('dd');
          dd.textContent = value;
          dl.append(dt, dd);
        }
        this.previewEl.appendChild(dl);
        return;
      }
      // Brief 07 fix list: never show the `---`/`+++` fence lines in normal
      // view, even in this fallback (a nested/nonflat front matter this
      // preview isn't confident summarizing) -- only the body, still raw.
      this.previewEl.appendChild(this.rawTextPreview(fenceless));
      return;
    }

    if (kind === 'footnoteDefinition') {
      const parsed = parseFootnoteDefinition(text);
      if (parsed) {
        const p = document.createElement('p');
        p.className = 'phraise-definition-preview';
        p.textContent = `${parsed.id}. ${parsed.body}`;
        this.previewEl.appendChild(p);
        return;
      }
      this.previewEl.appendChild(this.rawTextPreview(text));
      return;
    }

    if (kind === 'definition') {
      const parsed = parseLinkReferenceDefinition(text);
      if (parsed) {
        const p = document.createElement('p');
        p.className = 'phraise-definition-preview';
        p.textContent = `reference link: ${parsed.url}`;
        this.previewEl.appendChild(p);
        return;
      }
      this.previewEl.appendChild(this.rawTextPreview(text));
      return;
    }

    if (kind === 'math') {
      const mathEl = document.createElement('div');
      mathEl.className = 'phraise-math-preview';
      try {
        katex.render(stripMathDelimiters(text), mathEl, { throwOnError: true, displayMode: true });
      } catch (err) {
        mathEl.classList.add('phraise-render-error');
        const message = document.createElement('div');
        message.className = 'phraise-render-error-message';
        message.textContent = `Could not render this formula: ${err instanceof Error ? err.message : String(err)}`;
        mathEl.append(message, this.rawTextPreview(text));
      }
      this.previewEl.appendChild(mathEl);
      return;
    }

    this.previewEl.appendChild(this.rawTextPreview(text));
  }

  private rawTextPreview(text: string): HTMLElement {
    const pre = document.createElement('pre');
    pre.className = 'phraise-raw-text-preview';
    pre.textContent = text;
    return pre;
  }

  private updateEditingState(): void {
    if (this.isUnverified()) return; // always shown; see renderLabel's comment.
    const pos = this.getPos();
    if (pos == null || !this.editor.isFocused) {
      this.dom.classList.remove('phraise-editing');
      return;
    }
    const { from, to } = this.editor.state.selection;
    const inside = from >= pos && to <= pos + this.node.nodeSize;
    this.dom.classList.toggle('phraise-editing', inside);
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    const kindChanged = node.attrs.kind !== this.node.attrs.kind;
    const textChanged = node.textContent !== this.node.textContent;
    this.node = node;
    if (kindChanged) {
      this.dom.dataset.rawBlockKind = node.attrs.kind as string;
      this.renderLabel();
    }
    if (kindChanged || textChanged) this.renderPreview();
    this.updateEditingState();
    return true;
  }

  selectNode(): void {
    this.dom.classList.add('phraise-block-selected');
  }

  deselectNode(): void {
    this.dom.classList.remove('phraise-block-selected');
  }

  stopEvent(): boolean {
    return false;
  }

  ignoreMutation(mutation: { target: Node }): boolean {
    return !this.contentDOM.contains(mutation.target);
  }

  destroy(): void {
    this.editor.off('selectionUpdate', this.selectionHandler);
    this.editor.off('focus', this.selectionHandler);
    this.editor.off('blur', this.selectionHandler);
  }
}

/** Strip `$$`/`$` delimiters from a math raw_block's own source text (which,
 * like every raw_block, carries its Markdown delimiters verbatim -- see
 * `src/model/parse.ts`'s comment on `raw_block` text) before handing the
 * bare formula to KaTeX. */
function stripMathDelimiters(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith('$$') && trimmed.endsWith('$$')) return trimmed.slice(2, -2).trim();
  if (trimmed.startsWith('$') && trimmed.endsWith('$')) return trimmed.slice(1, -1).trim();
  return trimmed;
}

export function rawBlockNodeView() {
  return ({ node, getPos, editor }: NodeViewRendererProps) =>
    new RawBlockView(node as unknown as PMNode, editor, getPos as () => number | undefined);
}
