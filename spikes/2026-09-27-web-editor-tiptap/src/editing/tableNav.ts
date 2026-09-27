// Brief 02, task 2 (tables) / task 4 (unit test): Tab/Shift-Tab cell-to-cell
// navigation, pure position arithmetic over spike 1's schema.
//
// Not built on `prosemirror-tables`: that package's own navigation
// (`goToNextCell`) requires every table/row/cell NodeSpec to carry a
// `tableRole` (via its own `tableNodes()` schema helper), which
// `src/model/schema.ts` does not set -- adding it would mean editing the
// shared schema, which this brief's "schema-free Extension" rule forbids.
// Table structure here is simple enough (no merged cells, no resizing) that
// plain position arithmetic over `table`/`table_row`/`table_cell` by name is
// both simpler and schema-free.
import type { Node as PMNode } from 'prosemirror-model';

interface CellLocation {
  table: PMNode;
  tablePos: number; // position right before the table node's own opening token
  rowIndex: number;
  cellIndex: number;
}

/** Find the table/row/cell containing `pos`, if any. */
function findCellLocation(doc: PMNode, pos: number): CellLocation | null {
  const $pos = doc.resolve(pos);
  for (let d = $pos.depth; d >= 2; d--) {
    if ($pos.node(d).type.name === 'table_cell' && $pos.node(d - 1).type.name === 'table_row' && $pos.node(d - 2).type.name === 'table') {
      return {
        table: $pos.node(d - 2),
        tablePos: $pos.before(d - 2),
        rowIndex: $pos.index(d - 2),
        cellIndex: $pos.index(d - 1),
      };
    }
  }
  return null;
}

/** The position of the start of a cell's own inline content, given its
 * table's own position and (row, col) address. */
function cellContentStart(tablePos: number, table: PMNode, row: number, col: number): number {
  let pos = tablePos + 1; // inside the table's own content
  for (let r = 0; r < row; r++) pos += table.child(r).nodeSize;
  pos += 1; // inside this row's own content
  const rowNode = table.child(row);
  for (let c = 0; c < col; c++) pos += rowNode.child(c).nodeSize;
  return pos + 1; // inside this cell's own content
}

/** True if `pos` is inside a table cell. */
export function isInTableCell(doc: PMNode, pos: number): boolean {
  return findCellLocation(doc, pos) != null;
}

/**
 * The position to move the caret to for Tab (next cell, wrapping to the next
 * row's first cell), or `null` if `pos` is not in a table cell, or is in the
 * very last cell of the table (nothing to move to -- "Tab in the last cell
 * does not insert a tab character" is satisfied by the caller treating a
 * `null` result as "handled, do nothing" rather than falling through to
 * default Tab behaviour).
 */
export function findNextCell(doc: PMNode, pos: number): number | null {
  const loc = findCellLocation(doc, pos);
  if (!loc) return null;
  const { table, tablePos, rowIndex, cellIndex } = loc;
  const row = table.child(rowIndex);
  if (cellIndex + 1 < row.childCount) return cellContentStart(tablePos, table, rowIndex, cellIndex + 1);
  if (rowIndex + 1 < table.childCount) return cellContentStart(tablePos, table, rowIndex + 1, 0);
  return null;
}

/** The position to move the caret to for Shift-Tab (previous cell, wrapping
 * to the previous row's last cell), or `null` if not in a table cell, or in
 * the very first cell. */
export function findPreviousCell(doc: PMNode, pos: number): number | null {
  const loc = findCellLocation(doc, pos);
  if (!loc) return null;
  const { table, tablePos, rowIndex, cellIndex } = loc;
  if (cellIndex > 0) return cellContentStart(tablePos, table, rowIndex, cellIndex - 1);
  if (rowIndex > 0) {
    const prevRow = table.child(rowIndex - 1);
    return cellContentStart(tablePos, table, rowIndex - 1, prevRow.childCount - 1);
  }
  return null;
}
