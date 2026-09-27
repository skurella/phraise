// Brief 06 (comments, gate F), task 1: `projectDocText`'s plain-text
// projection and its offset<->position mapping, over a real document built
// through spike 1's own parser (not a hand-rolled toy schema), including
// list items, a table cell and an inline atom (image), to prove the walk
// handles this schema's actual nesting and inline-atom siblings.
import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '../../src/model/parse.js';
import { projectDocText, offsetToPos, posToOffset, BLOCK_SEPARATOR, ATOM_PLACEHOLDER } from '../../src/comments/textProjection.js';

describe('projectDocText', () => {
  it('joins textblocks with the block separator and round-trips offset<->pos for plain paragraphs', () => {
    const { doc } = parseMarkdown('First paragraph here.\n\nSecond paragraph here.\n');
    const projection = projectDocText(doc);
    expect(projection.text).toBe(`First paragraph here.${BLOCK_SEPARATOR}Second paragraph here.`);

    const idx = projection.text.indexOf('Second');
    const pos = offsetToPos(projection, idx);
    expect(pos).not.toBeNull();
    expect(posToOffset(projection, pos!)).toBe(idx);
  });

  it('descends into list items and table cells (nested textblocks)', () => {
    const { doc } = parseMarkdown('- one\n- two\n\n| A | B |\n| --- | --- |\n| cell1 | cell2 |\n');
    const projection = projectDocText(doc);
    expect(projection.text).toContain('one');
    expect(projection.text).toContain('two');
    expect(projection.text).toContain('cell1');
    expect(projection.text).toContain('cell2');

    const idx = projection.text.indexOf('cell2');
    const pos = offsetToPos(projection, idx);
    expect(pos).not.toBeNull();
    const node = doc.resolve(pos!).parent;
    expect(node.type.name).toBe('table_cell');
  });

  it('represents an inline atom (image) as one placeholder character, keeping offsets aligned around it', () => {
    const { doc } = parseMarkdown('Before ![alt](img.png) after.\n');
    const projection = projectDocText(doc);
    expect(projection.text).toBe(`Before ${ATOM_PLACEHOLDER} after.`);

    const placeholderOffset = projection.text.indexOf(ATOM_PLACEHOLDER);
    const beforePos = offsetToPos(projection, placeholderOffset);
    const afterPos = offsetToPos(projection, placeholderOffset + 1);
    expect(afterPos).toBe(beforePos! + 1); // the image node's own nodeSize is 1

    // And the reverse mapping recovers the same offsets.
    expect(posToOffset(projection, beforePos!)).toBe(placeholderOffset);
    expect(posToOffset(projection, afterPos!)).toBe(placeholderOffset + 1);
  });

  it('offsetToPos/posToOffset return null outside any run (e.g. inside the block separator)', () => {
    const { doc } = parseMarkdown('One.\n\nTwo.\n');
    const projection = projectDocText(doc);
    const sepOffset = projection.text.indexOf(BLOCK_SEPARATOR) + 1; // inside the "\n\n" gap
    expect(offsetToPos(projection, sepOffset)).toBeNull();
    expect(posToOffset(projection, -5)).toBeNull();
  });
});
