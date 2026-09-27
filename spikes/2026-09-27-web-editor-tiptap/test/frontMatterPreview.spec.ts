// Brief 03, task 2/7 (unit test for the front-matter preview parser).
import { describe, expect, it } from 'vitest';
import { parseFlatFrontMatter, stripFrontMatterFences } from '../src/editing/frontMatterPreview.js';

describe('stripFrontMatterFences', () => {
  it('strips --- fences', () => {
    expect(stripFrontMatterFences('---\ntitle: Hi\nauthor: Ann\n---')).toBe('title: Hi\nauthor: Ann');
  });

  it('strips +++ fences', () => {
    expect(stripFrontMatterFences('+++\ntitle = "Hi"\n+++')).toBe('title = "Hi"');
  });

  it('returns the text unchanged when there is no fence', () => {
    expect(stripFrontMatterFences('title: Hi')).toBe('title: Hi');
  });
});

describe('parseFlatFrontMatter', () => {
  it('parses a flat YAML-style mapping', () => {
    expect(parseFlatFrontMatter('title: YAML Front Matter\nauthor: Test\nlicense: MIT')).toEqual([
      { key: 'title', value: 'YAML Front Matter' },
      { key: 'author', value: 'Test' },
      { key: 'license', value: 'MIT' },
    ]);
  });

  it('unquotes quoted scalar values', () => {
    expect(parseFlatFrontMatter('title = "Hi there"')).toEqual([{ key: 'title', value: 'Hi there' }]);
  });

  it('skips blank lines and comments', () => {
    expect(parseFlatFrontMatter('title: Hi\n\n# a comment\nauthor: Ann')).toEqual([
      { key: 'title', value: 'Hi' },
      { key: 'author', value: 'Ann' },
    ]);
  });

  it('returns null for a nested mapping', () => {
    expect(parseFlatFrontMatter('title: Hi\nnested:\n  a: 1')).toBeNull();
  });

  it('returns null for a list', () => {
    expect(parseFlatFrontMatter('tags:\n  - one\n  - two')).toBeNull();
  });

  it('returns null for a block scalar', () => {
    expect(parseFlatFrontMatter('description: |\n  multi\n  line')).toBeNull();
  });

  it('returns null for empty content', () => {
    expect(parseFlatFrontMatter('')).toBeNull();
    expect(parseFlatFrontMatter('   \n  ')).toBeNull();
  });
});
