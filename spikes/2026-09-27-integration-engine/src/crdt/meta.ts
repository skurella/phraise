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

// Brief 03 addition: engine needs to enumerate namespaced keys in a named
// map (`rebase:*`, `ack:<rebaseId>:*`, `editorsSinceCommit:*`, per plan
// section 4's key-per-user/-record design, which keeps concurrent writers
// from clobbering each other's Y.Map LWW register the way one shared
// array-valued key would) and to remove one. Small, justified extension of
// the "small typed accessor" plan section 3 already calls for -- still
// crdt-only, engine never touches Y.Map directly.

/** Every [key, value] in a named Y.Map whose key starts with `prefix` (default: every entry). */
export function listMetaEntries<T = unknown>(doc: Y.Doc, mapName: string, prefix = ''): Array<[string, T]> {
  const out: Array<[string, T]> = [];
  doc.getMap(mapName).forEach((v, k) => {
    if (k.startsWith(prefix)) out.push([k, v as T]);
  });
  return out;
}

/** Delete one key from a named Y.Map, inside its own transaction. */
export function deleteMeta(doc: Y.Doc, mapName: string, key: string, origin?: unknown): void {
  doc.transact(() => {
    doc.getMap(mapName).delete(key);
  }, origin);
}
