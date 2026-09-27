// Brief 02, task 3/4: headless unit tests for the Markdown-or-not paste rule
// and the inline-vs-block paste content decision.
import { describe, expect, it } from 'vitest';
import { schema } from '../src/model/schema.js';
import { looksLikeMarkdown, buildMarkdownPasteContent } from '../src/editing/pasteMarkdown.js';

describe('looksLikeMarkdown', () => {
  it('recognizes block-level markers', () => {
    expect(looksLikeMarkdown('# A heading')).toBe(true);
    expect(looksLikeMarkdown('## A heading')).toBe(true);
    expect(looksLikeMarkdown('- an item')).toBe(true);
    expect(looksLikeMarkdown('* an item')).toBe(true);
    expect(looksLikeMarkdown('1. an item')).toBe(true);
    expect(looksLikeMarkdown('> a quote')).toBe(true);
    expect(looksLikeMarkdown('```js')).toBe(true);
    expect(looksLikeMarkdown('| a | b |\n| - | - |')).toBe(true);
    expect(looksLikeMarkdown('---')).toBe(true);
  });

  it('recognizes inline markers', () => {
    expect(looksLikeMarkdown('some **bold** text')).toBe(true);
    expect(looksLikeMarkdown('some *italic* text')).toBe(true);
    expect(looksLikeMarkdown('some ~~struck~~ text')).toBe(true);
    expect(looksLikeMarkdown('some `code` text')).toBe(true);
    expect(looksLikeMarkdown('a [link](https://example.com)')).toBe(true);
  });

  it('leaves plain prose alone', () => {
    expect(looksLikeMarkdown('Just a normal sentence copied from somewhere.')).toBe(false);
    expect(looksLikeMarkdown('user_id and file-name.txt are not markdown.')).toBe(false);
    expect(looksLikeMarkdown('')).toBe(false);
    expect(looksLikeMarkdown('   ')).toBe(false);
  });
});

describe('buildMarkdownPasteContent', () => {
  it('treats a single-line, single-paragraph fragment as inline content', () => {
    const { inline, fragment } = buildMarkdownPasteContent('some **bold** text', schema);
    expect(inline).toBe(true);
    const texts: string[] = [];
    fragment.forEach((n) => texts.push(n.text ?? ''));
    expect(texts.join('')).toBe('some bold text');
    // The bold word carries the strong mark.
    let boldNode: (typeof fragment)['firstChild'] | null = null;
    fragment.forEach((n) => {
      if (n.marks.some((m) => m.type.name === 'strong')) boldNode = n;
    });
    expect(boldNode).not.toBeNull();
  });

  it('treats a heading as block content, not inline', () => {
    const { inline, fragment } = buildMarkdownPasteContent('# A heading', schema);
    expect(inline).toBe(false);
    expect(fragment.childCount).toBe(1);
    expect(fragment.firstChild!.type.name).toBe('heading');
  });

  it('treats a multi-block fragment (heading + paragraph) as block content', () => {
    const { inline, fragment } = buildMarkdownPasteContent('# Title\n\nA paragraph.', schema);
    expect(inline).toBe(false);
    expect(fragment.childCount).toBe(2);
    expect(fragment.child(0).type.name).toBe('heading');
    expect(fragment.child(1).type.name).toBe('paragraph');
  });

  it('treats a list as block content', () => {
    const { inline, fragment } = buildMarkdownPasteContent('- one\n- two', schema);
    expect(inline).toBe(false);
    expect(fragment.childCount).toBe(1);
    expect(fragment.firstChild!.type.name).toBe('bullet_list');
  });

  it('treats a table as block content', () => {
    const { inline, fragment } = buildMarkdownPasteContent('| a | b |\n| - | - |\n| 1 | 2 |', schema);
    expect(inline).toBe(false);
    expect(fragment.firstChild!.type.name).toBe('table');
  });

  it('nulls the last block\'s gap, so it does not glue onto whatever follows it once inserted', () => {
    // parseMarkdown sets the last block's gap from its own trailing text
    // (here '', no trailing newline) -- serializeDoc would otherwise treat
    // that '' as the real (empty) separator to use once this content is
    // spliced into a real document, gluing it onto the next block with no
    // blank line at all.
    const { fragment } = buildMarkdownPasteContent('# Title\n\nA paragraph.', schema);
    expect(fragment.child(1).attrs.gap).toBeNull();
    // The non-last block's gap is untouched (it is real, meaningful
    // spacing between two blocks that are BOTH part of the pasted content).
    expect(fragment.child(0).attrs.gap).toBe('\n\n');
  });
});
