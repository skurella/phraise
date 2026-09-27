// Brief 03, task 2: "Inline atoms (`raw_inline`: inline HTML, inline math,
// footnote references) render as unobtrusive chips or rendered math, not as
// Markdown syntax." `raw_inline` is a leaf (no content, no contentDOM
// needed): inline math renders through KaTeX; everything else (inline HTML,
// footnote references, and any future/unrecognized inline kind) renders as
// a small chip carrying the plain-word label from `rawBlockLabels.ts`, with
// the raw source in its `title` tooltip so a curious user can see exactly
// what will be saved without it cluttering the running text.
import type { Node as PMNode } from '@tiptap/pm/model';
import type { NodeViewRendererProps } from '@tiptap/core';
import type { NodeView } from '@tiptap/pm/view';
import katex from 'katex';
import { labelForRawInlineKind } from '../../../src/editing/rawBlockLabels.js';

class RawInlineView implements NodeView {
  dom: HTMLElement;
  private node: PMNode;

  constructor(node: PMNode) {
    this.node = node;
    this.dom = document.createElement('span');
    this.render();
  }

  private render(): void {
    const kind = this.node.attrs.kind as string;
    const value = (this.node.attrs.value as string) ?? '';
    this.dom.innerHTML = '';
    this.dom.className = '';

    if (kind === 'inlineMath') {
      this.dom.className = 'phraise-inline-math';
      try {
        katex.render(value, this.dom, { throwOnError: true, displayMode: false });
      } catch {
        this.dom.textContent = value;
        this.dom.classList.add('phraise-render-error');
      }
      return;
    }

    if (kind === 'footnoteReference') {
      // Brief 07 fix list: "a footnote reference renders as a chip saying
      // 'FOOTNOTE REF' (render a superscript number)". `value` is the raw
      // source (`[^1]`); show its id as a real superscript, the way a
      // rendered footnote reference actually looks, with the raw source
      // still in the tooltip for a curious user.
      this.dom.className = 'phraise-footnote-ref';
      this.dom.title = value;
      const idMatch = /^\[\^([^\]]+)\]$/.exec(value.trim());
      const sup = document.createElement('sup');
      sup.textContent = idMatch ? idMatch[1]! : value;
      this.dom.appendChild(sup);
      return;
    }

    this.dom.className = 'phraise-inline-chip';
    this.dom.title = value;
    this.dom.textContent = labelForRawInlineKind(kind);
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render();
    return true;
  }
}

export function rawInlineNodeView() {
  return ({ node }: NodeViewRendererProps) => new RawInlineView(node as unknown as PMNode);
}
