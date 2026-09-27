import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { seedDoc, docToPM, PM_FRAGMENT } from "../src/seed.js";
import { computeRebaseUpdate } from "../src/rebase.js";
import { DOC_ID, AUTHOR, GRANULARITIES } from "./helpers.js";

const A = "Alpha one.\n\nBeta two.\n\nGamma three.\n";
const B = "Alpha uno.\n\nBeta two.\n\nGamma tres.\n"; // paragraph 2 untouched by B

describe("concurrent edits survive a rebase", () => {
  for (const granularity of GRANULARITIES) {
    it(`granularity: ${granularity}`, () => {
      const live = seedDoc(DOC_ID, A, "commit-a", AUTHOR);

      // An unsynced local edit in paragraph 2 ("Beta two."), which the A->B
      // diff never touches.
      const fragment = live.getXmlFragment(PM_FRAGMENT);
      const paragraph2 = fragment.toArray()[1] as Y.XmlElement;
      const yText2 = paragraph2.toArray()[0] as Y.XmlText;
      live.transact(() => {
        yText2.insert(yText2.length, " extra");
      }, "local-user");

      const { update } = computeRebaseUpdate(live, {
        docId: DOC_ID,
        targetMarkdown: B,
        targetCommit: "commit-b",
        author: AUTHOR,
        granularity,
      });
      Y.applyUpdate(live, update);

      const resultParagraphs = docToPM(live);
      const texts: string[] = [];
      resultParagraphs.forEach((p) => texts.push(p.textContent));

      // B's changes are present in paragraphs 1 and 3.
      expect(texts[0]).toBe("Alpha uno.");
      expect(texts[2]).toBe("Gamma tres.");
      // The concurrent local edit in paragraph 2 survived.
      expect(texts[1]).toBe("Beta two. extra");
    });
  }
});
