// Brief 07 fix list: "the table header row is neither bold nor shaded".
// `table_cell`'s own schema `toDOM` (`src/model/schema.ts`) always renders
// `<td>`, because a cell node has no way to see its enclosing row's
// `header` attr from a pure `toDOM(node)` function -- only `table_row`
// carries `header`, decided once at parse time from the row's index
// (`src/model/parse.ts`'s `ri === 0`) and read back by the serializer the
// same way. So the existing `#editor .ProseMirror th { background; font-
// weight }` CSS rule in `style.css` never actually matched anything: no
// `<th>` was ever in the DOM. Confirmed directly (`document.querySelectorAll
// ('th')` on a table fixture returned zero elements) before writing this
// node view, rather than assumed from the screenshot alone.
//
// Fixed as a view-only concern, not a schema/parse/serialize change: this
// node view resolves the enclosing `table_row` from `getPos()` (the
// standard "look up the parent through the current doc" idiom, same as
// `rawBlockView.ts`'s `updateEditingState`) and picks `<th>`/`<td>`
// accordingly. The Markdown round-trip was never broken (it already goes
// through `table_row.attrs.header`, not the DOM tag) -- only the rendered
// tag/CSS-hook was.
import type { Editor, NodeViewRendererProps } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { NodeView } from '@tiptap/pm/view';

function resolveTag(editor: Editor, getPos: () => number | undefined): 'th' | 'td' {
  const pos = getPos();
  if (pos == null) return 'td';
  try {
    const row = editor.state.doc.resolve(pos).parent;
    return row.type.name === 'table_row' && row.attrs.header === true ? 'th' : 'td';
  } catch {
    return 'td'; // a stale getPos() during a structural edit -- update() will be called again once the doc settles.
  }
}

class TableCellView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  private node: PMNode;
  private readonly editor: Editor;
  private readonly getPos: () => number | undefined;

  constructor(node: PMNode, editor: Editor, getPos: () => number | undefined) {
    this.node = node;
    this.editor = editor;
    this.getPos = getPos;
    this.dom = document.createElement(resolveTag(editor, getPos));
    this.contentDOM = this.dom;
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    // The tag itself can't be changed on an existing element; if the
    // enclosing row's header-ness changed (or this cell moved between
    // rows), force ProseMirror to recreate the view via a fresh
    // constructor call rather than try to swap the tag in place.
    if (this.dom.tagName.toLowerCase() !== resolveTag(this.editor, this.getPos)) return false;
    this.node = node;
    return true;
  }

  ignoreMutation(): boolean {
    return false;
  }
}

export function tableCellNodeView() {
  return ({ node, editor, getPos }: NodeViewRendererProps) =>
    new TableCellView(node as unknown as PMNode, editor, getPos as () => number | undefined);
}
