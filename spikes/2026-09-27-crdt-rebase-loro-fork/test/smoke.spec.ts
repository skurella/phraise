import { describe, it, expect } from "vitest";
import { seedDoc, docToPM } from "../src/seed.js";
import { parseMarkdown, serializeMarkdown } from "../src/markdown.js";
import { computeRebaseUpdate } from "../src/rebase.js";
import { PHRAISE_MAP } from "../src/loro-doc.js";

const AUTHOR = { name: "Repo Owner", email: "owner@example.com" };

describe("seed", () => {
  it("round-trips markdown through the Loro tree", () => {
    const md = "# Title\n\nHello **brave** world.\n\n- one\n- two\n";
    const doc = seedDoc("docA", md, "commitA", AUTHOR);
    const pm = docToPM(doc);
    expect(pm.eq(parseMarkdown(md))).toBe(true);
  });

  it("is deterministic across two independent seedings", () => {
    const md = "# T\n\nSome *text* here.\n";
    const d1 = seedDoc("docA", md, "commitA", AUTHOR);
    const d2 = seedDoc("docA", md, "commitA", AUTHOR);
    const u1 = d1.export({ mode: "snapshot" });
    const u2 = d2.export({ mode: "snapshot" });
    expect(Buffer.from(u1).equals(Buffer.from(u2))).toBe(true);
  });
});

describe("rebase", () => {
  it("diffs A -> B and the fork content equals B", () => {
    const mdA = "# Title\n\nHello world.\n\nUnrelated paragraph.\n";
    const mdB = "# Title\n\nHello brave new world.\n\nUnrelated paragraph.\n";
    const live = seedDoc("docA", mdA, "commitA", AUTHOR);
    const { update, rebaseId } = computeRebaseUpdate(live, {
      docId: "docA",
      targetMarkdown: mdB,
      targetCommit: "commitB",
      author: { name: "Contributor Two", email: "c2@example.com" },
      granularity: "word",
    });
    expect(rebaseId).toBe("commitB");
    live.import(update);
    live.commit();
    const pm = docToPM(live);
    expect(pm.eq(parseMarkdown(mdB))).toBe(true);
    expect((live.getMap(PHRAISE_MAP).get("base") as any).commit).toBe("commitB");
  });
});
