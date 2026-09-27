// Brief 07 fix list: "badge images from the network show as broken". A
// reference-style image (`![alt][id]`) or link is stored with an empty
// `url`/`href` plus `refType`/`identifier` (`src/model/schema.ts`), by
// design, so the Markdown re-serializes as the same reference syntax
// rather than a hardcoded literal URL (see the schema's own comment: "the
// identifier is the semantic target"). Rendering the raw (empty) `url`
// directly, as the schema's plain `toDOM` does, is fine for the Markdown
// model but wrong for DISPLAY -- an `<img src="">` is not "no image", it
// is "reload this very page as image data" in a real browser, confirmed
// directly (see `web/src/nodeviews/imageView.ts`'s own comment for how).
// This module resolves an identifier to the actual URL a reference
// definition gives it, for a node view to use for display only.
import type { Node as PMNode } from 'prosemirror-model';
import { parseLinkReferenceDefinition } from './definitionPreview.js';

/** CommonMark reference-identifier normalization: case-fold and collapse
 * internal whitespace, so `![Foo Bar][x]`'s definition may be written
 * `[x]: ...` or, for a shortcut/collapsed reference, `[Foo   Bar]: ...`
 * matches `![Foo Bar]`. */
function normalizeIdentifier(id: string): string {
  return id.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Resolve a link/image reference identifier to its definition's URL, by
 * scanning the document's own `definition` raw_blocks (kind === 'definition',
 * see `src/model/parse.ts`) -- the same blocks `definitionPreview.ts`'s
 * `parseLinkReferenceDefinition` already turns into a "reference link:
 * <url>" preview for the definition's own source-block view. Returns
 * `null` if no definition matches (a genuinely unresolvable reference --
 * this function does not invent a URL for one).
 */
export function resolveReferenceUrl(doc: PMNode, identifier: string): string | null {
  const target = normalizeIdentifier(identifier);
  let found: string | null = null;
  doc.descendants((node) => {
    if (found !== null) return false;
    if (node.type.name === 'raw_block' && node.attrs.kind === 'definition') {
      const parsed = parseLinkReferenceDefinition(node.textContent);
      if (parsed && normalizeIdentifier(parsed.label) === target) {
        found = parsed.url;
        return false;
      }
    }
    return true;
  });
  return found;
}
