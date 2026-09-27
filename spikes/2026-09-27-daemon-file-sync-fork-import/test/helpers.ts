// Shared plumbing for test/core.*.test.ts: not itself a test file.
import * as Y from 'yjs';
import { FRAGMENT_NAME } from '../src/md/yjs.js';

/** Bidirectional state-vector-diff sync between two in-memory Y.Docs (stands in for the relay). */
export function syncDocs(a: Y.Doc, b: Y.Doc): void {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)), 'test-sync');
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)), 'test-sync');
}

/**
 * Runs `fn`, capturing every Y type whose content changed across every
 * transaction that ran on `ydoc` while it ran (via the 'update' event,
 * which hands over the transaction that produced each update). This is
 * this core test suite's stand-in for "decode the resulting update": Yjs's
 * own transaction-level change tracking (`tr.changed`) gives the same
 * guarantee -- nothing outside a touched type had items inserted or
 * deleted -- without hand-rolling a struct-level update decoder.
 */
export function changedTypesDuring<T>(ydoc: Y.Doc, fn: () => T): { result: T; changed: Set<any> } {
  const changed = new Set<any>();
  const onUpdate = (_update: Uint8Array, _origin: unknown, _doc: Y.Doc, tr: Y.Transaction) => {
    for (const t of tr.changed.keys()) changed.add(t);
  };
  ydoc.on('update', onUpdate as any);
  try {
    const result = fn();
    return { result, changed };
  } finally {
    ydoc.off('update', onUpdate as any);
  }
}

/** Walks up from `type` to the nearest ancestor that is a direct child of `root`, or undefined. */
export function topLevelBlockOf(type: any, root: Y.XmlFragment): any | undefined {
  let cur = type;
  while (cur) {
    if (cur.parent === root) return cur;
    cur = cur.parent;
  }
  return undefined;
}

export function rootFragment(ydoc: Y.Doc): Y.XmlFragment {
  return ydoc.getXmlFragment(FRAGMENT_NAME);
}
