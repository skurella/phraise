// Deterministic seeding (plan section 2 / section 4), Loro version.
// Adapted from spikes/2026-09-27-crdt-rebase-yjs-fork/src/seed.ts: same
// shape (base pointer + author registration in one transaction/commit, a
// snapshot record written in a second commit by the same peer), but Loro's
// "snapshot" for a base pointer is simply its `frontiers()` -- a small JSON
// array of {peer, counter} pairs `doc.forkAt()` accepts directly. No
// encode/decode-to-bytes step is needed the way Yjs's Y.encodeSnapshot/
// Y.decodeSnapshot round trip requires; frontiers are stored as plain JSON
// in the `phraise` map. This is a real simplification, noted in the README.
import { LoroDoc, type Frontiers } from "loro-crdt";
import { updateLoroToPmState, ROOT_DOC_KEY, type LoroNodeMapping } from "loro-prosemirror";
import type { Node as PMNode } from "prosemirror-model";
import { parseMarkdown } from "./markdown.js";
import { schema } from "./schema.js";
import { seedPeerId } from "./ids.js";
import { configureTextStyle, PHRAISE_MAP, AUTHORS_MAP } from "./loro-doc.js";
import { createNodeFromLoroObj } from "loro-prosemirror";

export interface Author {
  name: string;
  email: string;
}

export interface Base {
  id: string;
  commit: string;
  frontiers: Frontiers;
}

/**
 * Seed a fresh LoroDoc from a commit's Markdown. Two replicas seeding the
 * same commit with the same docId produce byte-identical docs (deterministic
 * peer id, deterministic tree-build order via updateLoroToPmState).
 */
export function seedDoc(
  docId: string,
  markdown: string,
  commit: string,
  author: Author
): LoroDoc {
  const doc = new LoroDoc();
  const peer = seedPeerId(docId, commit);
  doc.setPeerId(peer);
  configureTextStyle(doc);

  const pmDoc = parseMarkdown(markdown);
  const mapping: LoroNodeMapping = new Map();
  // updateLoroToPmState is loro-prosemirror's own public headless entry
  // point: it only reads `editorState.doc`, so a plain `{ doc: pmDoc }`
  // stand-in works with no EditorView / plugin required (brief item 1).
  updateLoroToPmState(doc as any, mapping, { doc: pmDoc } as any);

  const authors = doc.getMap(AUTHORS_MAP);
  authors.set(String(peer), { kind: "git", name: author.name, email: author.email, commit });
  doc.commit({ origin: "seed" });

  // Second commit, same deterministic peer, after the content+author commit
  // above, mirroring the Yjs fork's "snapshot written after the base is
  // committed" (plan section 4). The "snapshot" itself is just the doc's own
  // frontiers here -- see the file header note.
  const frontiers = doc.frontiers();
  const base: Base = { id: commit, commit, frontiers };
  const phraise = doc.getMap(PHRAISE_MAP);
  phraise.set("base", base);
  // Permanent, never-overwritten key (unlike "base"), so any later rebase
  // record's baseId can still be resolved back to its frontiers -- mirrors
  // the Yjs fork's `snapshot:<commit>` map entries.
  phraise.set(`snapshot:${commit}`, frontiers);
  doc.commit({ origin: "seed" });

  return doc;
}

export function docToPM(doc: LoroDoc): PMNode {
  const mapping: LoroNodeMapping = new Map();
  return createNodeFromLoroObj(schema, doc.getMap(ROOT_DOC_KEY) as any, mapping);
}
