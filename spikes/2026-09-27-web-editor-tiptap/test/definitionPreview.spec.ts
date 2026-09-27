// Brief 07 fix list: unit tests for the footnote/link-reference definition
// preview parser (see src/editing/definitionPreview.ts's own comment for
// what bug this fixes and why).
import { describe, expect, it } from 'vitest';
import { parseFootnoteDefinition, parseLinkReferenceDefinition } from '../src/editing/definitionPreview.js';

describe('parseFootnoteDefinition', () => {
  it('parses a simple numeric footnote definition', () => {
    expect(parseFootnoteDefinition("[^1]: The footnote's own definition text.")).toEqual({
      id: '1',
      body: "The footnote's own definition text.",
    });
  });

  it('parses a named identifier', () => {
    expect(parseFootnoteDefinition('[^note]: Some text.')).toEqual({ id: 'note', body: 'Some text.' });
  });

  it('trims surrounding whitespace and tolerates no space after the colon', () => {
    expect(parseFootnoteDefinition('  [^2]:text here  ')).toEqual({ id: '2', body: 'text here' });
  });

  it('returns null for text with no body', () => {
    expect(parseFootnoteDefinition('[^1]:')).toBeNull();
    expect(parseFootnoteDefinition('[^1]:   ')).toBeNull();
  });

  it('returns null for text that is not a footnote definition', () => {
    expect(parseFootnoteDefinition('plain paragraph text')).toBeNull();
    expect(parseFootnoteDefinition('[ref]: https://example.com')).toBeNull();
  });
});

describe('parseLinkReferenceDefinition', () => {
  it('parses a plain reference definition', () => {
    expect(parseLinkReferenceDefinition('[ref]: https://example.com/reference')).toEqual({
      label: 'ref',
      url: 'https://example.com/reference',
    });
  });

  it('ignores a trailing title', () => {
    expect(parseLinkReferenceDefinition('[ref]: https://example.com/reference "Reference title"')).toEqual({
      label: 'ref',
      url: 'https://example.com/reference',
    });
  });

  it('strips angle brackets around the URL', () => {
    expect(parseLinkReferenceDefinition('[ref]: <https://example.com/reference>')).toEqual({
      label: 'ref',
      url: 'https://example.com/reference',
    });
  });

  it('returns null for text that is not a link reference definition', () => {
    expect(parseLinkReferenceDefinition('plain paragraph text')).toBeNull();
    expect(parseLinkReferenceDefinition('[^1]: a footnote')).toBeNull();
  });
});
