// Brief 04, task 2: the image popover's Apply/Remove-link buttons must
// replace an image's `url` attr and its `link` mark together, as one
// transaction -- this is spike 5's gate B3, which showed this exact edit
// losing the old link mark on Yjs 14's ProseMirror binding (D5 resolved).
// On this spike's Yjs 13 stack the fix is the `leafMarks` workaround
// (`src/collab/workarounds/leafMarks.ts`), already wired in `main.ts`; this
// module is the pure, schema-free half of the edit itself: given the image
// node and the two field values, compute the new attrs and marks. No DOM,
// no EditorView, no Transaction -- `web/src/editing/imagePopover.ts` is the
// thin DOM layer that reads the popover's two inputs and calls
// `state.tr.setNodeMarkup(pos, undefined, attrs, marks)` with this
// function's result, which is what makes the url change and the mark
// change land in the SAME transaction/step (a precondition the brief states
// explicitly, and the reason gate B3 failed on Yjs 14 in the first place:
// two separate dispatches raced with the relay's own sync in that binding).
import type { Node as PMNode, Schema, Mark } from 'prosemirror-model';

export interface ImageEditInput {
  /** New value for the image node's `url` attr (the "Image address" field). */
  url: string;
  /** New `href` for the image's `link` mark, or `null`/empty to remove the link (the "Link" field, or the Remove-link button). */
  href: string | null;
}

export interface ImageEditResult {
  attrs: Record<string, unknown>;
  marks: Mark[];
}

/**
 * Pure computation of the new attrs/marks for an image edit. `node` must be
 * an `image` node (checked by the caller, which already has it from a
 * click); any existing `link` mark's other attrs (`title`, `refType`,
 * `identifier`, `label`, `kindHint`) are preserved when the link is kept,
 * so re-applying the same href through the popover doesn't silently drop a
 * reference-style link's identity -- only `href` itself is overwritten from
 * the field.
 */
export function buildImageEdit(schema: Schema, node: PMNode, input: ImageEditInput): ImageEditResult {
  if (node.type.name !== 'image') {
    throw new Error(`buildImageEdit: expected an image node, got ${node.type.name}`);
  }
  const attrs = { ...node.attrs, url: input.url };
  const existingLink = node.marks.find((m) => m.type.name === 'link');
  const otherMarks = node.marks.filter((m) => m.type.name !== 'link');

  const href = input.href?.trim() || null;
  if (!href) {
    return { attrs, marks: otherMarks };
  }
  const linkMark = schema.marks.link.create({ ...(existingLink?.attrs ?? {}), href });
  return { attrs, marks: [...otherMarks, linkMark] };
}
