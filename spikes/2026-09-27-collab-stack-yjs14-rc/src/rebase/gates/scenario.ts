// Shared fixture for gates A, C, D, D2, F: a realistic 10-block document
// (heading, paragraphs, a 3-item list) rebased from commit A to commit B
// while bob (offline) and alice (online) make concurrent edits, plus
// comments planted on commit A for gates A and C.
import type * as Y from "yjs";
import { Replica, deliver } from "../replica.js";
import { collectBlocks, type BlockRef } from "../integrate.js";
import { addComment } from "../comments.js";
import { docPlainText } from "../text.js";
import type { Author } from "../seed.js";
import { PM_FRAGMENT } from "../seed.js";
import { ContentString } from "yjs";

export const DOC_ID = "gates-scenario-doc";

export const AUTHOR_SEED: Author = { name: "Repo Owner", email: "owner@example.com" };
export const AUTHOR_B: Author = { name: "Contributor Two", email: "c2@example.com" };

export const MD_A = `# Project Notes

This introductory paragraph is never touched by anyone during the rebase.

## Background

The background paragraph explains the original plan for the rollout in careful detail.

This paragraph about the old lighthouse keeper will be removed entirely in the next commit.

The lighthouse by the harbor stayed lit every night that whole winter season.

Paragraph P holds bob's offline draft notes before anyone else changes it.

Paragraph Q holds alice's online draft notes before anyone else changes it.

Paragraph P2 holds more of bob's offline notes, later removed upstream.

- The first list item never changes at all.
- The second list item will be reworded by the next commit.
- The third list item never changes at all.
`;

export const MD_B = `# Project Notes

This introductory paragraph is never touched by anyone during the rebase.

## Background

The background paragraph explains the revised plan for the rollout in careful, thorough detail.

The lighthouse by the harbor stayed lit every night that whole winter season.

Paragraph P holds the server's revised draft notes before anyone else changes it.

Paragraph Q holds the server's revised draft notes before anyone else changes it too.

- The first list item never changes at all.
- The second list item has now been reworded by this commit.
- The third list item never changes at all.
`;

function findOffset(text: string, needle: string): number {
  const i = text.indexOf(needle);
  if (i < 0) throw new Error(`fixture text not found: ${JSON.stringify(needle)}`);
  return i;
}

export interface CommentIds {
  untouched: string;
  deleted: string;
}

export interface Labels {
  untouchedId: string;
  rewrittenId: string;
  deletedId: string;
  negControlId: string;
  pId: string;
  qId: string;
  p2Id: string;
  listItem1Id: string;
  listItem2Id: string;
  listItem3Id: string;
}

export interface Scenario {
  server: Replica;
  alice: Replica;
  bob: Replica;
  comments: CommentIds;
  labels: Labels;
  rebaseId: string;
}

function blockPlainText(b: BlockRef): string {
  let out = "";
  let item = (b.node as any)._start;
  while (item) {
    if (!item.deleted && item.content instanceof ContentString) out += (item.content as any).str;
    item = item.right;
  }
  return out;
}

/** Gate F also uses this, on live clients' and the relay's own Y.Docs (none of which are a headless-only Replica) -- it only ever needs a bare Y.Doc. */
export function labelBlocks(doc: Y.Doc): Labels {
  const root = doc.get(PM_FRAGMENT);
  const blocks = collectBlocks(root);
  const byText = (needle: string): BlockRef => {
    const found = blocks.find((b) => blockPlainText(b).includes(needle));
    if (!found) throw new Error(`labelBlocks: no block containing ${JSON.stringify(needle)}`);
    return found;
  };
  return {
    untouchedId: byText("never touched by anyone").id,
    rewrittenId: byText("explains the original plan").id,
    deletedId: byText("old lighthouse keeper").id,
    negControlId: byText("lighthouse by the harbor").id,
    pId: byText("Paragraph P holds").id,
    qId: byText("Paragraph Q holds").id,
    p2Id: byText("Paragraph P2 holds").id,
    listItem1Id: byText("first list item never changes").id,
    listItem2Id: byText("second list item will be reworded").id,
    listItem3Id: byText("third list item never changes").id,
  };
}

/** Build a fresh scenario: server + alice (online) + bob (offline) with
 * concurrent edits queued and the rebase already computed+applied on the
 * server, but nothing yet delivered. Deterministic: every call reproduces
 * byte-identical replicas and updates. */
export function buildScenario(): Scenario {
  const server = new Replica("server", DOC_ID, MD_A, "A", AUTHOR_SEED);
  const alice = new Replica("alice", DOC_ID, MD_A, "A", AUTHOR_SEED, {
    userId: "alice",
    name: "Alice",
  });
  const bob = new Replica("bob", DOC_ID, MD_A, "A", AUTHOR_SEED, {
    userId: "bob",
    name: "Bob",
  });
  server.link(alice);
  server.link(bob);

  const labels = labelBlocks(server.doc);

  // Comments planted on commit A, for gates A and C.
  const textA = docPlainText(server.doc).text;
  const untouchedStart = findOffset(textA, "never touched by anyone");
  const untouched = addComment(server.doc, untouchedStart, untouchedStart + "never touched by anyone".length, "looks good", {
    userId: "srv",
    name: "server",
  });
  const deletedStart = findOffset(textA, "old lighthouse keeper");
  const deleted = addComment(server.doc, deletedStart, deletedStart + "old lighthouse keeper".length, "this needs a source", {
    userId: "srv",
    name: "server",
  });

  bob.setOnline(false);
  const pOffsetBob = findOffset(docPlainText(bob.doc).text, "Paragraph P holds");
  bob.insertText(pOffsetBob, "BOB EDIT: ");
  const p2OffsetBob = findOffset(docPlainText(bob.doc).text, "Paragraph P2 holds");
  bob.insertText(p2OffsetBob, "BOB P2 EDIT: ");

  const qOffsetAlice = findOffset(docPlainText(alice.doc).text, "Paragraph Q holds");
  alice.insertText(qOffsetAlice, "ALICE EDIT: ");

  const rebaseId = server.runRebase(MD_B, "B", AUTHOR_B);

  return {
    server,
    alice,
    bob,
    comments: { untouched, deleted },
    labels,
    rebaseId,
  };
}

/** Deliver everything currently queued between server/alice/bob, repeatedly, until no queue has anything left (relay fixpoint). Uses whole-queue FIFO delivery. */
export function drainAll(server: Replica, alice: Replica, bob: Replica): void {
  const pairs: Array<[Replica, Replica]> = [
    [server, alice],
    [server, bob],
    [alice, server],
    [bob, server],
    [alice, bob],
    [bob, alice],
  ];
  let progress = true;
  let rounds = 0;
  while (progress && rounds < 50) {
    progress = false;
    rounds++;
    for (const [from, to] of pairs) {
      const q = from._queueTo(to.name);
      if (q && q.length > 0) {
        deliver(from, to);
        progress = true;
      }
    }
  }
}
