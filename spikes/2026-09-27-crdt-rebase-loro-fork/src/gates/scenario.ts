// Shared fixture for gates A, C, D, E, F (brief 4 item 6). Adapted from
// spikes/2026-09-27-crdt-rebase-yjs-fork/src/gates/scenario.ts: the same
// realistic multi-block document and cast (server rebases A->B while bob
// (offline) and alice (online) make concurrent edits), trimmed to fewer
// blocks to fit the remaining time budget -- a deliberate, logged scope cut
// relative to the Yjs fork's fuller 10-block/3-list-item scenario. Comments
// are planted on commit A for gates A and C.
import { Replica, deliver } from "../replica.js";
import { collectBlocks, type BlockSnapshot } from "../integrate.js";
import { addComment } from "../comments.js";
import { docPlainText } from "../text.js";
import type { Author } from "../seed.js";

export const DOC_ID = "gates-scenario-doc";

export const AUTHOR_SEED: Author = { name: "Repo Owner", email: "owner@example.com" };
export const AUTHOR_B: Author = { name: "Contributor Two", email: "c2@example.com" };

export const MD_A = `# Project Notes

This introductory paragraph is never touched by anyone during the rebase.

## Background

The background paragraph explains the original plan for the rollout in careful detail.

This paragraph about the old lighthouse keeper will be removed entirely in the next commit.

The lighthouse by the harbor stayed lit every night that whole winter season.

Paragraph P holds bobs offline draft notes before anyone else changes it.

Paragraph Q holds alices online draft notes before anyone else changes it.
`;

export const MD_B = `# Project Notes

This introductory paragraph is never touched by anyone during the rebase.

## Background

The background paragraph explains the revised plan for the rollout in careful, thorough detail.

The lighthouse by the harbor stayed lit every night that whole winter season.

Paragraph P holds the servers revised draft notes before anyone else changes it.

Paragraph Q holds the servers revised draft notes before anyone else changes it too.
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
}

export interface Scenario {
  server: Replica;
  alice: Replica;
  bob: Replica;
  comments: CommentIds;
  labels: Labels;
  rebaseId: string;
}

function labelBlocks(server: Replica): Labels {
  const blocks = collectBlocks(server.doc);
  const byText = (needle: string): BlockSnapshot => {
    const found = blocks.find((b) => b.text.includes(needle));
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
  };
}

/** Build a fresh scenario: server + alice (online) + bob (offline) with
 * concurrent edits queued and the rebase already computed+applied on the
 * server, but nothing yet delivered. Deterministic: every call reproduces
 * byte-identical replicas and updates. */
export function buildScenario(): Scenario {
  const server = new Replica("server", DOC_ID, MD_A, "A", AUTHOR_SEED);
  const alice = new Replica("alice", DOC_ID, MD_A, "A", AUTHOR_SEED, { userId: "alice", name: "Alice" });
  const bob = new Replica("bob", DOC_ID, MD_A, "A", AUTHOR_SEED, { userId: "bob", name: "Bob" });
  server.link(alice);
  server.link(bob);

  const labels = labelBlocks(server);

  const textA = docPlainText(server.doc).text;
  const untouchedStart = findOffset(textA, "never touched by anyone");
  const untouched = addComment(
    server.doc,
    untouchedStart,
    untouchedStart + "never touched by anyone".length,
    "looks good",
    { userId: "srv", name: "server" }
  );
  const deletedStart = findOffset(textA, "old lighthouse keeper");
  const deleted = addComment(
    server.doc,
    deletedStart,
    deletedStart + "old lighthouse keeper".length,
    "this needs a source",
    { userId: "srv", name: "server" }
  );

  bob.setOnline(false);
  const pOffsetBob = findOffset(docPlainText(bob.doc).text, "Paragraph P holds");
  bob.insertText(pOffsetBob, "BOB EDIT: ");

  const qOffsetAlice = findOffset(docPlainText(alice.doc).text, "Paragraph Q holds");
  alice.insertText(qOffsetAlice, "ALICE EDIT: ");

  const rebaseId = server.runRebase(MD_B, "B", AUTHOR_B, "word");

  return { server, alice, bob, comments: { untouched, deleted }, labels, rebaseId };
}

/** Deliver everything currently queued between server/alice/bob, repeatedly, until no queue has anything left (relay fixpoint). */
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
