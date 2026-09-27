// Brief 03, task 4: "A `code_block` with `lang: mermaid` shows the rendered
// diagram, with the source editable (same pattern as step 2). Load
// `mermaid` with a dynamic `import()` so it is a separate chunk. A render
// error shows the error text and the source, not a blank. Other code blocks
// stay plain monospaced blocks with a small language label."
//
// `mermaid` is never statically imported anywhere in this app -- only
// through the dynamic `import('mermaid')` call in `renderMermaid` below --
// so Vite/Rollup puts it in its own chunk, loaded only once a document
// actually contains a Mermaid fence. See the builder log for the measured
// bundle sizes with and without it.
import type { Editor, NodeViewRendererProps } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { NodeView } from '@tiptap/pm/view';

let mermaidIdCounter = 0;
/** Cached across the page's lifetime: mermaid's own module-level init only
 * needs to run once (`mermaid.initialize`), and every node view can await
 * this same promise instead of re-importing per instance. */
let mermaidModulePromise: Promise<typeof import('mermaid')> | null = null;
function loadMermaid(): Promise<typeof import('mermaid')> {
  if (!mermaidModulePromise) {
    mermaidModulePromise = import('mermaid').then((mod) => {
      mod.default.initialize({ startOnLoad: false, securityLevel: 'strict' });
      return mod;
    });
  }
  return mermaidModulePromise;
}

class PlainCodeBlockView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  private node: PMNode;

  constructor(node: PMNode) {
    this.node = node;
    this.dom = document.createElement('div');
    this.dom.className = 'phraise-code-block';
    const label = document.createElement('div');
    label.className = 'phraise-code-label';
    this.dom.appendChild(label);
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    pre.appendChild(code);
    this.dom.appendChild(pre);
    this.contentDOM = code;
    this.renderLabel();
  }

  private renderLabel(): void {
    const label = this.dom.querySelector('.phraise-code-label')!;
    label.textContent = (this.node.attrs.lang as string) || 'Code';
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type || node.attrs.lang === 'mermaid') return false;
    const langChanged = node.attrs.lang !== this.node.attrs.lang;
    this.node = node;
    if (langChanged) this.renderLabel();
    return true;
  }

  ignoreMutation(mutation: { target: Node }): boolean {
    return !this.contentDOM.contains(mutation.target);
  }
}

class MermaidBlockView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  private node: PMNode;
  private readonly editor: Editor;
  private readonly getPos: () => number | undefined;
  private readonly previewEl: HTMLElement;
  private readonly selectionHandler: () => void;
  private renderGeneration = 0;

  constructor(node: PMNode, editor: Editor, getPos: () => number | undefined) {
    this.node = node;
    this.editor = editor;
    this.getPos = getPos;

    this.dom = document.createElement('div');
    this.dom.className = 'phraise-source-block phraise-mermaid-block';

    const label = document.createElement('div');
    label.className = 'phraise-source-label';
    const labelText = document.createElement('span');
    labelText.textContent = 'Mermaid diagram';
    label.appendChild(labelText);
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
    label.appendChild(editButton);

    this.previewEl = document.createElement('div');
    this.previewEl.className = 'phraise-mermaid-preview';

    const pre = document.createElement('pre');
    pre.className = 'phraise-source-editor';
    const code = document.createElement('code');
    pre.appendChild(code);
    this.contentDOM = code;

    this.dom.append(label, this.previewEl, pre);

    this.renderMermaid();
    this.selectionHandler = () => this.updateEditingState();
    this.editor.on('selectionUpdate', this.selectionHandler);
    this.updateEditingState();
  }

  private renderMermaid(): void {
    const generation = ++this.renderGeneration;
    const source = this.node.textContent;
    const id = `phraise-mermaid-${++mermaidIdCounter}`;
    this.previewEl.textContent = 'Rendering diagram…';
    loadMermaid()
      .then(async (mod) => {
        if (generation !== this.renderGeneration) return;
        const valid = await mod.default.parse(source, { suppressErrors: true });
        if (!valid) throw new Error('invalid Mermaid syntax');
        const { svg } = await mod.default.render(id, source);
        if (generation !== this.renderGeneration) return;
        this.previewEl.innerHTML = svg;
        this.previewEl.classList.remove('phraise-render-error');
      })
      .catch((err: unknown) => {
        if (generation !== this.renderGeneration) return;
        this.previewEl.classList.add('phraise-render-error');
        this.previewEl.innerHTML = '';
        const message = document.createElement('div');
        message.className = 'phraise-render-error-message';
        message.textContent = `Could not render this diagram: ${err instanceof Error ? err.message : String(err)}`;
        const pre = document.createElement('pre');
        pre.className = 'phraise-raw-text-preview';
        pre.textContent = source;
        this.previewEl.append(message, pre);
      });
  }

  private updateEditingState(): void {
    const pos = this.getPos();
    if (pos == null) {
      this.dom.classList.remove('phraise-editing');
      return;
    }
    const { from, to } = this.editor.state.selection;
    const inside = from >= pos && to <= pos + this.node.nodeSize;
    this.dom.classList.toggle('phraise-editing', inside);
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type || node.attrs.lang !== 'mermaid') return false;
    const textChanged = node.textContent !== this.node.textContent;
    this.node = node;
    if (textChanged) this.renderMermaid();
    this.updateEditingState();
    return true;
  }

  stopEvent(): boolean {
    return false;
  }

  ignoreMutation(mutation: { target: Node }): boolean {
    return !this.contentDOM.contains(mutation.target);
  }

  destroy(): void {
    this.editor.off('selectionUpdate', this.selectionHandler);
  }
}

export function codeBlockNodeView() {
  return ({ node, getPos, editor }: NodeViewRendererProps) => {
    const pmNode = node as unknown as PMNode;
    if (pmNode.attrs.lang === 'mermaid') {
      return new MermaidBlockView(pmNode, editor, getPos as () => number | undefined);
    }
    return new PlainCodeBlockView(pmNode);
  };
}
