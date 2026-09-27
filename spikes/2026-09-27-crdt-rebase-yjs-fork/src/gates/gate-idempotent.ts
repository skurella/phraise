// Extra gate row (brief 02): "rebase idempotent on two replicas" — two
// replicas computing the *same* rebase (one with an extra unsynced local
// edit) produce byte-identical updates, and applying either twice never
// duplicates content.
import * as Y from "yjs";
import { seedDoc, docToPM, PM_FRAGMENT, type Author } from "../seed.js";
import { parseMarkdown } from "../markdown.js";
import { computeRebaseUpdate } from "../rebase.js";
import type { GateResult } from "./types.js";

const DOC_ID = "gate-idempotent-doc";
const AUTHOR: Author = { name: "Repo Owner", email: "owner@example.com" };
const A = "Alpha one.\n\nBeta two.\n\nGamma three.\n";
const B = "Alpha uno.\n\nBeta two.\n\nGamma tres.\n";

export function runGateIdempotent(): GateResult {
  const replica1 = seedDoc(DOC_ID, A, "commit-a", AUTHOR);
  const replica2 = seedDoc(DOC_ID, A, "commit-a", AUTHOR);
  const fragment2 = replica2.getXmlFragment(PM_FRAGMENT);
  const paragraph2 = fragment2.toArray()[1] as Y.XmlElement;
  const yText2 = paragraph2.toArray()[0] as Y.XmlText;
  replica2.transact(() => {
    yText2.insert(yText2.length, " extra local edit");
  }, "local-user");

  const r1 = computeRebaseUpdate(replica1, {
    docId: DOC_ID,
    targetMarkdown: B,
    targetCommit: "commit-b",
    author: AUTHOR,
    granularity: "word",
  });
  const r2 = computeRebaseUpdate(replica2, {
    docId: DOC_ID,
    targetMarkdown: B,
    targetCommit: "commit-b",
    author: AUTHOR,
    granularity: "word",
  });

  const bytesEqual = Buffer.from(r1.update).equals(Buffer.from(r2.update));

  const replica3 = seedDoc(DOC_ID, A, "commit-a", AUTHOR);
  Y.applyUpdate(replica3, r1.update);
  const svAfterFirst = Y.encodeStateVector(replica3);
  Y.applyUpdate(replica3, r1.update);
  const svAfterSecond = Y.encodeStateVector(replica3);
  const noDuplication = Buffer.from(svAfterFirst).equals(Buffer.from(svAfterSecond));
  const contentMatches = docToPM(replica3).eq(parseMarkdown(B));

  const pass = bytesEqual && noDuplication && contentMatches;
  return {
    name: "rebase idempotent on two replicas",
    pass,
    detail: `bytesEqual=${bytesEqual} noDuplicationOnReapply=${noDuplication} contentMatchesB=${contentMatches}`,
  };
}
