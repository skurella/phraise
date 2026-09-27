// Brief 07 fix list: "badge images from the network show as broken, find
// out whether the service worker, the headless browser or the network is
// the cause". Root cause, confirmed directly against the real app (not
// guessed): none of the three. Express's own README writes its badges as
// reference-style images (`[![NPM Version][npm-version-image]][npm-url]`),
// which this schema stores with `url: ''` plus `refType`/`identifier`
// (see `src/editing/referenceResolve.ts`'s comment) so the Markdown
// round-trips as reference syntax, not a resolved literal URL. The
// schema's plain `toDOM` used that raw (empty) `url` directly as
// `<img src>` -- and `document.querySelectorAll('img')` on the real page
// showed every such badge's `src` resolving to `location.href` (the
// current page's own URL), which Chromium then genuinely re-requested and
// failed to decode as an image. Same underlying cause for a reference-
// style TEXT link (`href=""`, confirmed too) -- out of THIS fix's scope
// (badges rendering broken is what screenshots showed; an empty-href link
// is silently wrong, not visibly broken, and marks have no per-instance
// NodeView equivalent in ProseMirror to fix the same way without a larger
// decoration-based mechanism -- left as a documented, separate finding in
// the builder log).
//
// Fixed as a view-only concern: this node view resolves the identifier
// against the document's own reference definitions ONLY for the `src`
// actually put in the DOM; the node's own attrs (and therefore the
// serialized Markdown) are completely untouched.
import type { Editor, NodeViewRendererProps } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { NodeView } from '@tiptap/pm/view';
import { resolveReferenceUrl } from '../../../src/editing/referenceResolve.js';

class ImageView implements NodeView {
  dom: HTMLImageElement;
  private node: PMNode;
  private readonly editor: Editor;

  constructor(node: PMNode, editor: Editor) {
    this.node = node;
    this.editor = editor;
    this.dom = document.createElement('img');
    this.render();
  }

  private render(): void {
    const attrs = this.node.attrs as {
      url: string;
      alt: string;
      title: string | null;
      identifier: string | null;
    };
    const resolved = attrs.url || (attrs.identifier ? resolveReferenceUrl(this.editor.state.doc, attrs.identifier) : null);
    if (resolved) this.dom.setAttribute('src', resolved);
    else this.dom.removeAttribute('src'); // a genuinely unresolvable reference: no src to invent.
    this.dom.alt = attrs.alt ?? '';
    if (attrs.title) this.dom.title = attrs.title;
    else this.dom.removeAttribute('title');
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render();
    return true;
  }
}

export function imageNodeView() {
  return ({ node, editor }: NodeViewRendererProps) => new ImageView(node as unknown as PMNode, editor);
}
