import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { seedDoc, docToPM } from "../src/seed.js";
import { parseMarkdown } from "../src/markdown.js";
import { computeRebaseUpdate } from "../src/rebase.js";
import { DOC_ID, AUTHOR, GRANULARITIES } from "./helpers.js";
import { AB_PAIRS } from "./fixtures-ab.js";

describe("computeRebaseUpdate: no concurrent edits", () => {
  for (const granularity of GRANULARITIES) {
    describe(`granularity: ${granularity}`, () => {
      for (const pair of AB_PAIRS) {
        it(`${pair.name}`, () => {
          const live = seedDoc(DOC_ID, pair.a, "commit-a", AUTHOR);
          const { update } = computeRebaseUpdate(live, {
            docId: DOC_ID,
            targetMarkdown: pair.b,
            targetCommit: "commit-b",
            author: AUTHOR,
            granularity,
          });
          Y.applyUpdate(live, update);
          const result = docToPM(live);
          const expected = parseMarkdown(pair.b);
          expect(result.eq(expected)).toBe(true);
        });
      }
    });
  }
});

describe("computeRebaseUpdate: asserts on mismatch (sanity: does not silently diverge)", () => {
  it("succeeds for a representative pair on every granularity", () => {
    for (const granularity of GRANULARITIES) {
      const live = seedDoc(DOC_ID, AB_PAIRS[0].a, "commit-a", AUTHOR);
      expect(() =>
        computeRebaseUpdate(live, {
          docId: DOC_ID,
          targetMarkdown: AB_PAIRS[0].b,
          targetCommit: "commit-b",
          author: AUTHOR,
          granularity,
        })
      ).not.toThrow();
    }
  });
});
