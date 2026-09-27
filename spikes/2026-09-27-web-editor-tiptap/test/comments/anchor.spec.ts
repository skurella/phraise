// Brief 06 (comments, gate F), tasks 1/2/6: the anchor record builder and
// the resolution order (CRDT, fuzzy, orphaned), plus the acceptance rule's
// hand cases -- including one where a second location scores nearly as
// well and must be rejected (D3 amendment: "rejected when a second
// location scores nearly as well").
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { docToYDoc } from '../../src/model/yjs.js';
import { parseMarkdown } from '../../src/model/parse.js';
import { contextFromYDoc, buildAnchorRecord, resolveAnchor, fuzzyAnchor, buildQuoteSelectors } from '../../src/comments/anchor.js';

function seed(md: string): Y.Doc {
  const { doc } = parseMarkdown(md);
  return docToYDoc(doc);
}

describe('buildQuoteSelectors', () => {
  it('captures the exact quote and up to 32 characters of prefix/suffix', () => {
    const text = 'x'.repeat(40) + 'TARGET' + 'y'.repeat(40);
    const q = buildQuoteSelectors(text, 40, 46);
    expect(q.exact).toBe('TARGET');
    expect(q.prefix).toBe('x'.repeat(32));
    expect(q.suffix).toBe('y'.repeat(32));
  });

  it('shrinks prefix/suffix near the start/end of the document instead of padding', () => {
    const text = 'abcTARGETdef';
    const q = buildQuoteSelectors(text, 3, 9);
    expect(q.prefix).toBe('abc');
    expect(q.suffix).toBe('def');
  });
});

describe('buildAnchorRecord + resolveAnchor: resolution order', () => {
  it('resolves via CRDT relative position when the text is untouched (even after an unrelated edit)', () => {
    const ydoc = seed('Hello world, this is a unique phrase in a paragraph.\n\nA second, unrelated paragraph.\n');
    const ctx = contextFromYDoc(ydoc);
    const from = ctx.projection.text.indexOf('a unique phrase');
    const fromPos = offsetPos(ctx, from);
    const anchor = buildAnchorRecord(ctx, fromPos, offsetPos(ctx, from + 'a unique phrase'.length));
    expect(anchor.quote.exact).toBe('a unique phrase');

    // An unrelated edit elsewhere in the document (typed in the SECOND
    // paragraph) must not disturb resolution of the first paragraph's anchor.
    const fragment = ydoc.getXmlFragment('prosemirror');
    const secondParagraph = fragment.toArray()[1] as Y.XmlElement;
    const secondText = secondParagraph.toArray()[0] as Y.XmlText;
    ydoc.transact(() => secondText.insert(0, 'PREFIX '));

    const ctx2 = contextFromYDoc(ydoc);
    const resolved = resolveAnchor(ctx2, anchor);
    expect(resolved.method).toBe('crdt');
    const text = ctx2.doc.textBetween(resolved.start!, resolved.end!, '', '');
    expect(text).toBe('a unique phrase');
  });

  it('falls back to a fuzzy match when the original CRDT position is gone but the same quote text exists (moved) elsewhere, and the quote is long and unique enough to stand alone', () => {
    // A short quote moved to a location with entirely different surrounding
    // context is exactly what the acceptance rule refuses to guess at (see
    // the ambiguity/context tests below) -- D3's "long unique quote"
    // exception is what makes a genuinely MOVED comment recoverable at all,
    // so this uses a long, one-of-a-kind phrase (>= 24 chars).
    const longPhrase = 'a truly distinctive unique phrase found nowhere else';
    const ydoc = seed(`Hello world, this is ${longPhrase} in a paragraph.\n\nA second, unrelated paragraph.\n`);
    const ctx = contextFromYDoc(ydoc);
    const from = ctx.projection.text.indexOf(longPhrase);
    const fromPos = offsetPos(ctx, from);
    const toPos = offsetPos(ctx, from + longPhrase.length);
    const anchor = buildAnchorRecord(ctx, fromPos, toPos);

    // Delete the quoted text from the FIRST paragraph's own Y.XmlText (the
    // exact items the anchor's relative position points at), and insert the
    // identical text into the SECOND paragraph instead -- simulating a user
    // cutting the phrase and pasting it elsewhere, with new neighbours.
    const fragment = ydoc.getXmlFragment('prosemirror');
    const firstParagraph = fragment.toArray()[0] as Y.XmlElement;
    const firstText = firstParagraph.toArray()[0] as Y.XmlText;
    const secondParagraph = fragment.toArray()[1] as Y.XmlElement;
    const secondText = secondParagraph.toArray()[0] as Y.XmlText;
    const deleteFrom = firstText.toString().indexOf(longPhrase);
    ydoc.transact(() => {
      firstText.delete(deleteFrom, longPhrase.length);
      secondText.insert(0, `${longPhrase}, `);
    });

    const ctx2 = contextFromYDoc(ydoc);
    const resolved = resolveAnchor(ctx2, anchor);
    expect(resolved.method).toBe('fuzzy');
    const text = ctx2.doc.textBetween(resolved.start!, resolved.end!, '', '');
    expect(text).toBe(longPhrase);
  });

  it('is orphaned when the quoted text is deleted outright and not found anywhere', () => {
    const longPhrase = 'a truly distinctive unique phrase found nowhere else';
    const ydoc = seed(`Hello world, this is ${longPhrase} in a paragraph.\n\nA second, unrelated paragraph.\n`);
    const ctx = contextFromYDoc(ydoc);
    const from = ctx.projection.text.indexOf(longPhrase);
    const fromPos = offsetPos(ctx, from);
    const toPos = offsetPos(ctx, from + longPhrase.length);
    const anchor = buildAnchorRecord(ctx, fromPos, toPos);

    const fragment = ydoc.getXmlFragment('prosemirror');
    const firstParagraph = fragment.toArray()[0] as Y.XmlElement;
    const firstText = firstParagraph.toArray()[0] as Y.XmlText;
    const deleteFrom = firstText.toString().indexOf(longPhrase);
    ydoc.transact(() => firstText.delete(deleteFrom, longPhrase.length));

    const ctx2 = contextFromYDoc(ydoc);
    const resolved = resolveAnchor(ctx2, anchor);
    expect(resolved.method).toBe('orphaned');
  });

  it('the highlight still covers an insertion made INSIDE the quoted phrase (CRDT resolves to the wider range)', () => {
    const ydoc = seed('Hello world, this is a unique phrase in a paragraph.\n');
    const ctx = contextFromYDoc(ydoc);
    const from = ctx.projection.text.indexOf('a unique phrase');
    const fromPos = offsetPos(ctx, from);
    const toPos = offsetPos(ctx, from + 'a unique phrase'.length);
    const anchor = buildAnchorRecord(ctx, fromPos, toPos);

    const fragment = ydoc.getXmlFragment('prosemirror');
    const firstParagraph = fragment.toArray()[0] as Y.XmlElement;
    const firstText = firstParagraph.toArray()[0] as Y.XmlText;
    const insertAt = firstText.toString().indexOf('unique');
    ydoc.transact(() => firstText.insert(insertAt, 'very '));

    const ctx2 = contextFromYDoc(ydoc);
    const resolved = resolveAnchor(ctx2, anchor);
    expect(resolved.method).toBe('crdt');
    const text = ctx2.doc.textBetween(resolved.start!, resolved.end!, '', '');
    expect(text).toBe('a very unique phrase');
  });
});

function offsetPos(ctx: ReturnType<typeof contextFromYDoc>, offset: number): number {
  const run = ctx.projection.runs.find((r) => offset >= r.offset && offset <= r.offset + r.text.length)!;
  return run.pos + (offset - run.offset);
}

describe('fuzzyAnchor: the acceptance rule', () => {
  it('accepts a match whose context (prefix/suffix) agrees', () => {
    const text = 'The quick brown fox jumps over the lazy dog in the meadow.';
    const quote = buildQuoteSelectors(text, text.indexOf('lazy dog'), text.indexOf('lazy dog') + 'lazy dog'.length);
    const result = fuzzyAnchor(text, quote, 30);
    expect(result).not.toBeNull();
    expect(text.slice(result!.start, result!.end)).toBe('lazy dog');
  });

  it('rejects a match when a second, non-overlapping location scores nearly as well (ambiguous)', () => {
    // The exact same sentence appears twice, far enough apart that each
    // occurrence's own 32-character prefix/suffix window never leaks into
    // the other's -- so both candidates score identically on quote and
    // context similarity, and only position proximity could tell them
    // apart. With `approxPos` at the midpoint, it barely does either: the
    // acceptance rule's ambiguity guard must refuse to guess between them.
    const sentence = 'The committee reviewed everything and the reviewer approved the final draft after the meeting concluded successfully today.';
    const filler =
      'Some unrelated separating paragraph text goes here to keep enough distance between the two identical sentences so their contexts do not leak into one another at all around here.';
    const text = `${sentence}\n\n${filler}\n\n${sentence}`;
    const quote = buildQuoteSelectors(text, text.indexOf('approved the final draft'), text.indexOf('approved the final draft') + 'approved the final draft'.length);
    const midpoint = Math.floor(text.length / 2);
    const result = fuzzyAnchor(text, quote, midpoint);
    expect(result).toBeNull();
  });

  it('accepts a long, unique quote even with weak/absent context (a moved paragraph)', () => {
    const longQuote = 'a distinctly long and entirely unique sentence fragment that appears exactly once';
    const text = `${longQuote} sits here now, moved far from where it used to be in the document, with brand new neighbours.`;
    const quote = { exact: longQuote, prefix: 'completely different old prefix that no longer exists', suffix: 'completely different old suffix gone too' };
    const result = fuzzyAnchor(text, quote, 0);
    expect(result).not.toBeNull();
    expect(text.slice(result!.start, result!.end)).toBe(longQuote);
  });

  it('returns null for an empty quote', () => {
    expect(fuzzyAnchor('some text here', { exact: '', prefix: '', suffix: '' }, 0)).toBeNull();
  });
});
