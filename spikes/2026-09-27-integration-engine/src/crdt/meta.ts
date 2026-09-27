// Plan section 3: "a small typed accessor for JSON values in named maps
// (getMeta(doc, map, key), setMeta, transact(doc, fn, origin)), so engine
// can keep its records without touching Y.Map." New code for this spike
// (not copied from an earlier one), following the shape spike 3's
// docsync.ts and spike 5's relay.ts each hand-rolled inline.
import * as Y from 'yjs';

/** Read a JSON value from a named Y.Map. */
export function getMeta<T = unknown>(doc: Y.Doc, mapName: string, key: string): T | undefined {
  return doc.getMap(mapName).get(key) as T | undefined;
}

/** Write a JSON value into a named Y.Map, inside its own transaction. */
export function setMeta(doc: Y.Doc, mapName: string, key: string, value: unknown, origin?: unknown): void {
  doc.transact(() => {
    doc.getMap(mapName).set(key, value);
  }, origin);
}

/** Run `fn` inside a Yjs transaction tagged with `origin`, returning its result. */
export function transact<T>(doc: Y.Doc, fn: () => T, origin?: unknown): T {
  let result!: T;
  doc.transact(() => {
    result = fn();
  }, origin);
  return result;
}
