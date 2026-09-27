import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { seedDoc, docToPM, PM_FRAGMENT } from "../src/seed.js";
import { parseMarkdown } from "../src/markdown.js";
import { computeRebaseUpdate } from "../src/rebase.js";
import { DOC_ID, AUTHOR, GRANULARITIES } from "./helpers.js";

const A = "Alpha one.\n\nBeta two.\n\nGamma three.\n";
const B = "Alpha uno.\n\nBeta two.\n\nGamma tres.\n";

describe("rebase idempotence across replicas", () => {
  for (const granularity of GRANULARITIES) {
    it(`granularity: ${granularity}: byte-identical updates, no duplication on re-apply`, () => {
      // Replica 1: clean, no local edits.
      const replica1 = seedDoc(DOC_ID, A, "commit-a", AUTHOR);
      // Replica 2: same seed (deterministic, so byte-identical to replica1
      // before any local edit), plus extra unsynced local edits.
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
        granularity,
      });
      const r2 = computeRebaseUpdate(replica2, {
        docId: DOC_ID,
        targetMarkdown: B,
        targetCommit: "commit-b",
        author: AUTHOR,
        granularity,
      });

      // Byte-identical updates despite replica2's extra local edits: the
      // fork always derives from the same S_A snapshot with the same
      // deterministic peer, so it never sees replica2's extra edit.
      expect(Buffer.from(r1.update)).toEqual(Buffer.from(r2.update));

      // Applying the same update twice to a third replica must not
      // duplicate content (Yjs dedupes by item id).
      const replica3 = seedDoc(DOC_ID, A, "commit-a", AUTHOR);
      Y.applyUpdate(replica3, r1.update);
      const svAfterFirst = Y.encodeStateVector(replica3);
      Y.applyUpdate(replica3, r1.update); // re-apply, same bytes
      const svAfterSecond = Y.encodeStateVector(replica3);
      expect(Buffer.from(svAfterSecond)).toEqual(Buffer.from(svAfterFirst));

      const result = docToPM(replica3);
      expect(result.eq(parseMarkdown(B))).toBe(true);
    });
  }
});
