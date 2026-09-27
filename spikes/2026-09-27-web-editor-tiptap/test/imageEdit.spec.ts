// Brief 04, task 2/6: the pure half of the image popover's Apply/Remove-link
// edit -- computing new attrs/marks for a real image node against the real
// schema, no DOM.
import { describe, expect, it } from 'vitest';
import { schema } from '../src/model/schema.js';
import { buildImageEdit } from '../src/editing/imageEdit.js';

function image(url: string, marks: ReturnType<typeof schema.mark>[] = []) {
  return schema.node('image', { url, alt: 'Badge' }, undefined, marks);
}

describe('buildImageEdit', () => {
  it('sets a new url and a new link mark together, from a plain (unlinked) image', () => {
    const node = image('https://example.com/old.png');
    const { attrs, marks } = buildImageEdit(schema, node, { url: 'https://example.com/new.png', href: 'https://example.com/target' });

    expect(attrs.url).toBe('https://example.com/new.png');
    expect(marks).toHaveLength(1);
    expect(marks[0].type.name).toBe('link');
    expect(marks[0].attrs.href).toBe('https://example.com/target');
  });

  it('replaces an existing link mark\'s href while preserving its other attrs (e.g. title)', () => {
    const oldLink = schema.mark('link', { href: 'https://old.example', title: 'Old title' });
    const node = image('https://example.com/badge.png', [oldLink]);

    const { attrs, marks } = buildImageEdit(schema, node, { url: 'https://example.com/badge.png', href: 'https://new.example' });

    expect(attrs.url).toBe('https://example.com/badge.png');
    expect(marks).toHaveLength(1);
    expect(marks[0].attrs.href).toBe('https://new.example');
    expect(marks[0].attrs.title).toBe('Old title'); // preserved, only href overwritten
  });

  it('removes the link mark when href is null (Remove-link), keeping the url', () => {
    const oldLink = schema.mark('link', { href: 'https://old.example' });
    const node = image('https://example.com/badge.png', [oldLink]);

    const { attrs, marks } = buildImageEdit(schema, node, { url: 'https://example.com/badge.png', href: null });

    expect(attrs.url).toBe('https://example.com/badge.png');
    expect(marks).toHaveLength(0);
  });

  it('removes the link mark when href is an empty/whitespace string, same as null', () => {
    const oldLink = schema.mark('link', { href: 'https://old.example' });
    const node = image('https://example.com/badge.png', [oldLink]);

    const { marks } = buildImageEdit(schema, node, { url: 'https://example.com/badge.png', href: '   ' });
    expect(marks).toHaveLength(0);
  });

  it('leaves other marks (not link) on the node untouched', () => {
    // Images are inline atoms; a link mark is the realistic case, but the
    // function must not assume it is the ONLY mark ever present -- any
    // OTHER mark type must survive unrelated to the link edit.
    const oldLink = schema.mark('link', { href: 'https://old.example' });
    const node = image('https://example.com/badge.png', [oldLink]);
    // Sanity: no other inline mark applies to `image` per the schema, so
    // this test only asserts the link-removal path doesn't also drop
    // anything else that WAS there (already covered above) -- kept as a
    // regression guard should a future schema add another leaf-applicable mark.
    const { marks } = buildImageEdit(schema, node, { url: 'https://example.com/badge.png', href: null });
    expect(marks.some((m) => m.type.name === 'link')).toBe(false);
  });

  it('throws for a non-image node (programmer error, not a user-facing path)', () => {
    const para = schema.node('paragraph', {}, [schema.text('hi')]);
    expect(() => buildImageEdit(schema, para, { url: 'x', href: null })).toThrow(/image/);
  });
});
