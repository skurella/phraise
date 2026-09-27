import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { seedDoc, docToPM } from "../src/seed.js";
import { parseMarkdown } from "../src/markdown.js";
import { computeRebaseUpdate } from "../src/rebase.js";
import { DOC_ID, AUTHOR, GRANULARITIES } from "./helpers.js";

const A = "# Title\n\nAlpha one.\n\nBeta two.\n";
const B = "# Title\n\nAlpha uno.\n\nBeta two.\n\nGamma three.\n";
const C = "# Renamed Title\n\nAlpha uno.\n\nBeta dos.\n\nGamma three.\n";

describe("chained rebase A -> B -> C", () => {
  for (const granularity of GRANULARITIES) {
    it(`granularity: ${granularity}`, () => {
      const live = seedDoc(DOC_ID, A, "commit-a", AUTHOR);

      const rAB = computeRebaseUpdate(live, {
        docId: DOC_ID,
        targetMarkdown: B,
        targetCommit: "commit-b",
        author: AUTHOR,
        granularity,
      });
      Y.applyUpdate(live, rAB.update);
      expect(docToPM(live).eq(parseMarkdown(B))).toBe(true);

      const rBC = computeRebaseUpdate(live, {
        docId: DOC_ID,
        targetMarkdown: C,
        targetCommit: "commit-c",
        author: AUTHOR,
        granularity,
      });
      Y.applyUpdate(live, rBC.update);
      expect(docToPM(live).eq(parseMarkdown(C))).toBe(true);

      // The base pointer advanced to the latest rebase.
      const base = live.getMap("phraise").get("base") as {
        id: string;
        commit: string;
      };
      expect(base.commit).toBe("commit-c");
    });
  }
});
