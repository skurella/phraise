// Extra gate row: "rebase idempotent on two replicas" -- two replicas
// computing the *same* rebase (one with an extra unsynced local edit)
// produce byte-identical updates, and applying either twice never
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
  const fragment2 = replica2.get(PM_FRAGMENT);
  // Second top-level child ("Beta two.") -- unlike stack13's Y.XmlElement
  // tree, this stack's paragraph Y.Node holds text directly (no nested
  // Y.XmlText), so the extra local edit goes straight on it.
  let item = (fragment2 as any)._start;
  let idx = 0;
  let paragraph2: any = null;
  while (item) {
    if (!item.deleted && item.content && item.content.type) {
      if (idx === 1) {
        paragraph2 = item.content.type;
        break;
      }
      idx++;
    }
    item = item.right;
  }
  if (!paragraph2) throw new Error("gate-idempotent: could not find the second paragraph");
  replica2.transact(() => {
    paragraph2.insert(paragraph2.length, " extra local edit");
  }, "local-user");

  const r1 = computeRebaseUpdate(replica1, {
    docId: DOC_ID,
    targetMarkdown: B,
    targetCommit: "commit-b",
    author: AUTHOR,
  });
  const r2 = computeRebaseUpdate(replica2, {
    docId: DOC_ID,
    targetMarkdown: B,
    targetCommit: "commit-b",
    author: AUTHOR,
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
