// Brief 03, task 1: "Pressing Enter twice leaves an empty paragraph, which
// has no Markdown form; today `serializeDoc` throws on it." An empty
// paragraph really has zero Markdown representation (a blank line parses to
// zero blocks, not one empty paragraph -- confirmed by brief 02's builder
// log, "Enter on an empty list item to leave the list"), so `serializeDoc`
// is right to refuse it rather than silently emit something that would not
// round-trip. The fix belongs at the page level, before serialization: strip
// empty top-level paragraphs out of the doc that gets handed to
// `serializeDoc`, so an editing state that is only transiently "the user
// pressed Enter twice and hasn't typed the second line yet" never reaches
// the serializer as an error.
//
// "Keeping neighbours' bytes intact": removing an empty paragraph never
// touches any OTHER block's own `src`. The one thing that does need fixing
// is the separator (`gap`) of whichever surviving block used to sit right
// before the removed paragraph(s): that `gap` described the whitespace
// between the survivor and the (now gone) empty paragraph, which is no
// longer the real separator to whatever now follows. Nulling it lets
// `serializeDoc`'s own default-separator fallback (single eol at the end of
// the doc, blank line otherwise) recompute the right bytes -- the same
// pattern `src/editing/freshSrc.ts` already uses for exactly this reason
// (see its own comment, "gap-invalidation").
//
// In practice `freshSrc.ts` already nulls the survivor's `gap` for the
// split-shape step that creates a second empty paragraph via Enter, so this
// function's own gap-nulling rarely has more to do -- but it does not depend
// on that: it recomputes the invariant directly from the (possibly
// remote-edited, possibly loaded-from-a-file-that-somehow-already-had-one)
// document, so it is correct on its own.
import { Node as PMNode } from 'prosemirror-model';

function isEmptyParagraph(node: PMNode): boolean {
  return node.type.name === 'paragraph' && node.childCount === 0;
}

/**
 * Return a doc with every empty top-level paragraph (no text, no inline
 * atoms) removed, so it never reaches `serializeDoc`. If every top-level
 * block is an empty paragraph (nothing to keep -- schema requires `block+`),
 * the original doc is returned unchanged; that trivial case has no sensible
 * Markdown output either way and is not one `serializeDoc`'s callers need to
 * handle specially.
 */
export function stripEmptyTopLevelParagraphs(doc: PMNode): PMNode {
  const kept: PMNode[] = [];
  let removedSinceLastKept = false;

  doc.forEach((block) => {
    if (isEmptyParagraph(block)) {
      removedSinceLastKept = true;
      return;
    }
    if (removedSinceLastKept && kept.length > 0) {
      const prev = kept[kept.length - 1]!;
      if ('gap' in prev.attrs && prev.attrs.gap != null) {
        kept[kept.length - 1] = prev.type.create({ ...prev.attrs, gap: null }, prev.content, prev.marks);
      }
    }
    removedSinceLastKept = false;
    kept.push(block);
  });

  if (kept.length === 0) return doc;
  if (kept.length === doc.childCount) return doc; // nothing removed, avoid rebuilding

  // Trailing removed paragraph(s) at the very end of the doc: the last kept
  // block's `gap` (if any) also needs invalidating, same reasoning as above.
  if (removedSinceLastKept) {
    const prev = kept[kept.length - 1]!;
    if ('gap' in prev.attrs && prev.attrs.gap != null) {
      kept[kept.length - 1] = prev.type.create({ ...prev.attrs, gap: null }, prev.content, prev.marks);
    }
  }

  return doc.type.create(doc.attrs, kept, doc.marks);
}
