// Deterministic seeding (plan section 2 / section 4), ported to Yjs 14.
//
// `@y/y`'s Doc has no more getMap/getXmlFragment: every shared type is
// `doc.get(name)`, a unified Y.Node (see src/yjs.ts's and
// src/attribution.ts's own headers, brief 04). A Y.Node used purely as an
// attribute bag (no children, only setAttr/getAttr/forEachAttr) replaces
// stack13's PHRAISE_MAP/AUTHORS_MAP Y.Map -- confirmed working (including
// enumeration) in scratch/probe-rebase-primitives.ts before writing this.
import * as Y from "yjs";
import { pmnodeToDelta, ynodeToPmnode } from "@y/prosemirror";
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
 * Seed a fresh Y.Doc from a commit's Markdown, deterministically: two
 * independent seeds of the same (docId, commit) produce byte-identical
 * `Y.encodeStateAsUpdate` output (verified in scratch/probe-rebase-primitives.ts).
 * Same base-pointer design as stack13: the commit hash is both id and
 * commit for the seed and for every later rebase's resulting base.
 */
export function seedDoc(docId: string, markdown: string, commit: string, author: Author): Y.Doc {
  const doc = new Y.Doc({ gc: false });
  const peer = seedPeerId(docId, commit);
  doc.clientID = peer;

  const pmDoc = parseMarkdown(markdown);
  const ytype = doc.get(PM_FRAGMENT);

  doc.transact(() => {
    ytype.applyDelta(pmnodeToDelta(pmDoc));

    const phraise = doc.get(PHRAISE_MAP);
    phraise.setAttr("base", { id: commit, commit });

    const authors = doc.get(AUTHORS_MAP);
    authors.setAttr(String(peer), {
      kind: "git",
      name: author.name,
      email: author.email,
      commit,
    });
  }, "seed");

  // Second transaction, by the same deterministic peer, after content + base
  // are committed and the snapshot has been taken (plan section 4, same as
  // stack13).
  const snap = Y.encodeSnapshot(Y.snapshot(doc));
  doc.transact(() => {
    doc.get(PHRAISE_MAP).setAttr(`snapshot:${commit}`, uint8ToBase64(snap));
  }, "seed");

  return doc;
}

export function docToPM(doc: Y.Doc): PMNode {
  return ynodeToPmnode(doc.get(PM_FRAGMENT), schema) as unknown as PMNode;
}
