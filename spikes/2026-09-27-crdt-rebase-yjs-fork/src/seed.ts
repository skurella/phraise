// Deterministic seeding (plan section 2 / section 4). Two replicas seeding
// the same commit, with the same docId, produce byte-identical Y.Docs.
import * as Y from "yjs";
import {
  prosemirrorToYXmlFragment,
  yXmlFragmentToProseMirrorRootNode,
} from "y-prosemirror";
import type { Node as PMNode } from "prosemirror-model";
import { parseMarkdown } from "./markdown.js";
import { schema } from "./schema.js";
import { seedPeerId } from "./ids.js";

export interface Author {
  name: string;
  email: string;
}

export const PM_FRAGMENT = "pm";
export const PHRAISE_MAP = "phraise";
export const AUTHORS_MAP = "authors";

export function uint8ToBase64(arr: Uint8Array): string {
  return Buffer.from(arr).toString("base64");
}

export function base64ToUint8(str: string): Uint8Array {
  return new Uint8Array(Buffer.from(str, "base64"));
}

/**
 * Seed a fresh Y.Doc from a commit's Markdown. The doc's own base pointer
 * treats this commit as base id and commit (git commits are unique, so using
 * the commit hash as the base "id" throughout — for the seed base and for
 * every later rebase's resulting base — gives every `phraise` map entry a
 * natural, collision-free key without inventing a separate id scheme).
 */
export function seedDoc(
  docId: string,
  markdown: string,
  commit: string,
  author: Author
): Y.Doc {
  const doc = new Y.Doc({ gc: false });
  const peer = seedPeerId(docId, commit);
  doc.clientID = peer;

  const pmDoc = parseMarkdown(markdown);
  const fragment = doc.getXmlFragment(PM_FRAGMENT);

  doc.transact(() => {
    prosemirrorToYXmlFragment(pmDoc, fragment);

    const phraise = doc.getMap(PHRAISE_MAP);
    phraise.set("base", { id: commit, commit });

    const authors = doc.getMap(AUTHORS_MAP);
    authors.set(String(peer), {
      kind: "git",
      name: author.name,
      email: author.email,
      commit,
    });
  }, "seed");

  // Second transaction, by the same deterministic peer, after content + base
  // are committed and the snapshot has been taken (plan section 4: "written
  // in a second transaction ... after the snapshot is taken").
  const snap = Y.encodeSnapshot(Y.snapshot(doc));
  doc.transact(() => {
    const phraise = doc.getMap(PHRAISE_MAP);
    phraise.set(`snapshot:${commit}`, uint8ToBase64(snap));
  }, "seed");

  return doc;
}

export function docToPM(doc: Y.Doc): PMNode {
  const fragment = doc.getXmlFragment(PM_FRAGMENT);
  return yXmlFragmentToProseMirrorRootNode(fragment, schema);
}
