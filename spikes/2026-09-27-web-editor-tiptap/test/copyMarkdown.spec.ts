// Brief 02, task 3/4: headless unit test for slice-to-Markdown (copy).
import { describe, expect, it } from 'vitest';
import { schema } from '../src/model/schema.js';
import { sliceToMarkdown } from '../src/editing/copyMarkdown.js';

function doc() {
  return schema.node('doc', { lead: '', eol: '\n' }, [
    schema.node('paragraph', { src: 'Hello world.', gap: '\n\n' }, [schema.text('Hello world.')]),
    schema.node('paragraph', { src: 'Second one here.', gap: '\n\n' }, [schema.text('Second one here.')]),
  ]);
}

describe('sliceToMarkdown', () => {
  it('returns an empty string for an empty slice', () => {
    const d = doc();
    const slice = d.slice(5, 5);
    expect(sliceToMarkdown(slice, schema)).toBe('');
  });

  it('serializes a selection within one paragraph as bare inline text, no paragraph wrapper markup', () => {
    const d = doc();
    // "world" inside "Hello world."
    const from = 1 + 'Hello '.length;
    const to = 1 + 'Hello world'.length;
    const slice = d.slice(from, to);
    expect(sliceToMarkdown(slice, schema)).toBe('world');
  });

  it('serializes a selection spanning two paragraphs as two paragraphs, src stripped so it does not reuse stale source', () => {
    const d = doc();
    const from = 1 + 'Hello '.length; // inside paragraph 1, after "Hello "
    const to = d.child(0).nodeSize + 1 + 'Second '.length; // inside paragraph 2, after "Second "
    const slice = d.slice(from, to);
    expect(slice.content.firstChild!.attrs.src).toBe('Hello world.'); // sanity: the raw slice still carries it
    // Trailing space before a hard paragraph boundary is escaped by
    // mdast-util-to-markdown (ambiguous otherwise on reparse).
    expect(sliceToMarkdown(slice, schema)).toBe('world.\n\nSecond&#x20;');
  });

  it('preserves marks (bold) inside a same-paragraph selection', () => {
    const strong = schema.marks.strong.create({ markerHint: '**' });
    const d = schema.node('doc', { lead: '', eol: '\n' }, [
      schema.node('paragraph', { src: null, gap: null }, [schema.text('very '), schema.text('bold', [strong]), schema.text(' text')]),
    ]);
    const from = 1;
    const to = 1 + 'very bold'.length;
    const slice = d.slice(from, to);
    expect(sliceToMarkdown(slice, schema)).toBe('very **bold**');
  });
});
