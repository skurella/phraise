// Brief 02, task 2/4: headless unit tests for table cell Tab/Shift-Tab
// navigation.
import { describe, expect, it } from 'vitest';
import type { Node as PMNode } from 'prosemirror-model';
import { schema } from '../src/model/schema.js';
import { isInTableCell, findNextCell, findPreviousCell } from '../src/editing/tableNav.js';

function cell(text: string) {
  return schema.node('table_cell', {}, text ? [schema.text(text)] : []);
}

function twoByTwoTable() {
  const row = (a: string, b: string) => schema.node('table_row', { header: false }, [cell(a), cell(b)]);
  const table = schema.node('table', { align: [null, null], src: null, gap: null }, [row('a1', 'b1'), row('a2', 'b2')]);
  return schema.node('doc', { lead: '', eol: '\n' }, [schema.node('paragraph', { src: null, gap: null }, []), table]);
}

/** Find the doc position right at the start of the text of a cell whose sole
 * text content is `text` (test helper: avoids hand-computed offsets). */
function posInCellText(doc: PMNode, text: string): number {
  let found = -1;
  doc.descendants((node, pos) => {
    if (found >= 0) return false;
    if (node.isText && node.text === text) found = pos;
    return true;
  });
  if (found < 0) throw new Error(`no text node ${JSON.stringify(text)} found`);
  return found;
}

describe('tableNav', () => {
  it('isInTableCell is false outside a table and true inside one', () => {
    const doc = twoByTwoTable();
    expect(isInTableCell(doc, 1)).toBe(false); // in the leading paragraph
    expect(isInTableCell(doc, posInCellText(doc, 'a1'))).toBe(true);
  });

  it('Tab moves from the first cell to the second cell in the same row', () => {
    const doc = twoByTwoTable();
    const next = findNextCell(doc, posInCellText(doc, 'a1'));
    expect(next).not.toBeNull();
    expect(doc.resolve(next!).parent.textContent).toBe('b1');
  });

  it('Tab in the last cell of a row wraps to the first cell of the next row', () => {
    const doc = twoByTwoTable();
    const next = findNextCell(doc, posInCellText(doc, 'b1'));
    expect(next).not.toBeNull();
    expect(doc.resolve(next!).parent.textContent).toBe('a2');
  });

  it('Tab in the very last cell returns null (nothing to move to, no tab character inserted)', () => {
    const doc = twoByTwoTable();
    expect(findNextCell(doc, posInCellText(doc, 'b2'))).toBeNull();
  });

  it('Shift-Tab moves backward, wrapping to the previous row', () => {
    const doc = twoByTwoTable();
    const prev = findPreviousCell(doc, posInCellText(doc, 'a2'));
    expect(prev).not.toBeNull();
    expect(doc.resolve(prev!).parent.textContent).toBe('b1');
  });

  it('Shift-Tab in the very first cell returns null', () => {
    const doc = twoByTwoTable();
    expect(findPreviousCell(doc, posInCellText(doc, 'a1'))).toBeNull();
  });

  it('Shift-Tab from the middle of a row moves to the previous cell in the same row', () => {
    const doc = twoByTwoTable();
    const prev = findPreviousCell(doc, posInCellText(doc, 'b1'));
    expect(prev).not.toBeNull();
    expect(doc.resolve(prev!).parent.textContent).toBe('a1');
  });
});
