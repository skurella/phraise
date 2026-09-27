// Brief 07 fix list: unit test for `resolveReferenceUrl`, which fixes
// "badge images from the network show as broken" (see the module's own
// comment, and `web/src/nodeviews/imageView.ts`'s, for the confirmed root
// cause -- a reference-style image's `url` attr is intentionally empty).
// Built on a real parsed document (`parseMarkdown`), not a hand-built PM
// doc, so this exercises the actual `definition` raw_block shape the
// parser produces.
import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '../src/model/parse.js';
import { resolveReferenceUrl } from '../src/editing/referenceResolve.js';

const SOURCE = `See the [reference link][ref] and [another][Multi Word Ref].

[ref]: https://example.com/reference "Reference title"
[multi word ref]: https://example.com/multi
`;

describe('resolveReferenceUrl', () => {
  it('resolves a plain identifier to its definition URL', () => {
    const { doc } = parseMarkdown(SOURCE);
    expect(resolveReferenceUrl(doc, 'ref')).toBe('https://example.com/reference');
  });

  it('normalizes case and internal whitespace, per CommonMark reference matching', () => {
    const { doc } = parseMarkdown(SOURCE);
    expect(resolveReferenceUrl(doc, 'Multi Word Ref')).toBe('https://example.com/multi');
    expect(resolveReferenceUrl(doc, 'MULTI   WORD   REF')).toBe('https://example.com/multi');
  });

  it('returns null for an identifier with no matching definition', () => {
    const { doc } = parseMarkdown(SOURCE);
    expect(resolveReferenceUrl(doc, 'nope')).toBeNull();
  });
});
