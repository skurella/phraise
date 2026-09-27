// Where did a missing token go? Walks every Y.XmlText in the document,
// deleted content included (session docs use gc: false), and reports whether
// the token's characters exist, whether they are deleted, and whether an
// enclosing element is deleted. Used by the gate I fuzz to tell a block
// deleted under a concurrent edit (delete-versus-edit, a CRDT property) from
// text deleted by the sync itself. Written by the spike 3 orchestrator.
import * as Y from 'yjs';

export interface TokenLocation {
  /** The token's characters exist somewhere in the Y document. */
  found: boolean;
  /** Some enclosing element (or the text type itself) is deleted. */
  inDeletedBlock: boolean;
  /** How many copies of the token exist, deleted ones included. */
  copies: number;
  /** The token's own items are deleted. */
  textDeleted: boolean;
}

export function locateToken(fragment: Y.XmlFragment, core: string, countAll = false): TokenLocation {
  const result: TokenLocation = { found: false, inDeletedBlock: false, textDeleted: false, copies: 0 };
  const walk = (type: any, ancestorDeleted: boolean): void => {
    if (result.found && !countAll) return;
    if (type instanceof Y.XmlText) {
      const items: any[] = [];
      for (let it = type._start; it; it = it.right) items.push(it);
      const strs = items.map((it) => (typeof it.content?.str === 'string' ? (it.content.str as string) : ''));
      const all = strs.join('');
      result.copies += all.split(core).length - 1;
      if (result.found) return;
      const at = all.indexOf(core);
      if (at < 0) return;
      result.found = true;
      result.inDeletedBlock = ancestorDeleted;
      let pos = 0;
      for (let k = 0; k < items.length; k++) {
        if (pos + strs[k].length > at && pos < at + core.length && items[k].deleted) result.textDeleted = true;
        pos += strs[k].length;
      }
      return;
    }
    for (let it = type._start; it; it = it.right) {
      const child = it.content?.type;
      if (child) walk(child, ancestorDeleted || it.deleted);
    }
  };
  walk(fragment, false);
  return result;
}
