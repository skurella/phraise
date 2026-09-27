// Brief 02, task 3 (copy) / task 4 (unit test): "a selection puts text/plain
// holding Markdown (serialized through spike 1's serializer from a document
// built of the slice, with `src` stripped so it re-serializes cleanly)".
//
// Probed `Node.slice()` directly (see the builder log) to confirm the two
// shapes a selection's content actually takes: a selection entirely inside
// one textblock returns a flat Fragment of INLINE nodes (no wrapping
// paragraph, openStart=openEnd=0); a selection spanning multiple top-level
// blocks returns a Fragment of the block nodes themselves, still carrying
// the ORIGINAL document's `src`/`gap` (openStart=openEnd>=1). Serializing
// with the original `src` intact would be wrong here: `serializeDoc`'s
// verbatim/splice paths reparse `src` using a defs context built from the
// FULL original document, which this isolated copy doesn't have, and the
// copied fragment is usually a different (shorter) slice of that block's
// content anyway. Stripping the top-level nodes' `src`/`gap` forces
// `serializeDoc` down its own re-serialize-and-verify path for every copied
// block, which needs no outside context and is exactly what "re-serializes
// cleanly" means here.
import { Fragment, Node as PMNode, Slice } from 'prosemirror-model';
import type { Schema } from 'prosemirror-model';
import { serializeDoc } from '../model/serialize.js';

/** True if a slice's content is a flat run of inline nodes (a selection that
 * stayed inside one textblock), rather than a fragment of block nodes. */
function isInlineFragment(content: Fragment): boolean {
  return content.childCount > 0 && content.firstChild!.isInline;
}

/** Recursively null `src`/`gap` on a fragment's own top-level children only
 * (nested blocks already carry null per `src/model/schema.ts`'s invariant,
 * so there is nothing to strip further down). */
function stripTopLevelSrc(content: Fragment, schema: Schema): Fragment {
  const hasSrcGap = (node: PMNode) => 'src' in node.attrs || 'gap' in node.attrs;
  const children: PMNode[] = [];
  content.forEach((child) => {
    if (hasSrcGap(child)) {
      children.push(child.type.create({ ...child.attrs, src: null, gap: null }, child.content, child.marks));
    } else {
      children.push(child);
    }
  });
  return Fragment.fromArray(children.length ? children : [schema.nodes.paragraph.createAndFill()!]);
}

/**
 * Convert a selection's `Slice` (from `state.selection.content()`) into
 * Markdown text, through spike 1's own serializer. `schema` is spike 1's
 * model schema (`src/model/schema.ts`'s `schema`, or a schema
 * `checkSchemaEquivalence` has confirmed equivalent to it -- the live
 * editor's Tiptap-converted schema, in practice) -- the same schema instance
 * requirement `serializeDoc` has everywhere else in this codebase.
 *
 * Returns `''` for an empty slice.
 */
export function sliceToMarkdown(slice: Slice, schema: Schema): string {
  if (slice.content.childCount === 0) return '';

  let blockContent: Fragment;
  if (isInlineFragment(slice.content)) {
    // A same-textblock selection: wrap the bare inline run in one fresh
    // paragraph so `serializeDoc` (which always expects a `doc` of block+
    // children) has something to serialize.
    const paragraph = schema.nodes.paragraph.create({ src: null, gap: null }, slice.content);
    blockContent = Fragment.from(paragraph);
  } else {
    blockContent = stripTopLevelSrc(slice.content, schema);
  }

  const doc = schema.nodes.doc.create({ lead: '', eol: '\n' }, blockContent);
  // `onUnverified: 'emit'`: a copy should never throw at the user; if some
  // corner of the copied fragment's re-serialization cannot be verified
  // (see `serializeDoc`'s ladder), emit the best-effort text rather than
  // fail the whole copy.
  const serialized = serializeDoc(doc, { onUnverified: 'emit' });
  // `serializeDoc` always ends a document with one trailing eol (the
  // convention for a whole file, e.g. `emit()`'s `index === n - 1 ? eol :
  // ...`). A copied selection is not a file: pasting "world" mid-sentence
  // should not silently insert a paragraph break after it. Strip exactly
  // that one trailing terminator.
  return serialized.endsWith('\r\n') ? serialized.slice(0, -2) : serialized.endsWith('\n') ? serialized.slice(0, -1) : serialized;
}
