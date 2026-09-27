import { describe, it, expect } from "vitest";
import { seedDoc, docToPM } from "../src/seed.js";
import { computeRebaseUpdate } from "../src/rebase.js";
import { addComment, resolveComment } from "../src/comments.js";
import { listAttribution } from "../src/attribution.js";
import { docPlainText } from "../src/text.js";

const AUTHOR = { name: "Repo Owner", email: "owner@example.com" };

describe("comments", () => {
  it("resolves via crdt for an untouched quote after a rebase", () => {
    const mdA = "# Title\n\nThe quick brown fox jumps.\n\nOther paragraph here.\n";
    const mdB = "# Title\n\nThe quick brown fox jumps.\n\nOther paragraph changed now.\n";
    const doc = seedDoc("docA", mdA, "commitA", AUTHOR);
    const { text } = docPlainText(doc);
    const idx = text.indexOf("quick brown");
    const id = addComment(doc, idx, idx + "quick brown".length, "nice phrase", {
      userId: "u1",
      name: "Alice",
    });
    const before = resolveComment(doc, id);
    expect(before.method).toBe("crdt");
    expect(before.text).toBe("quick brown");

    const { update } = computeRebaseUpdate(doc, {
      docId: "docA",
      targetMarkdown: mdB,
      targetCommit: "commitB",
      author: { name: "Contributor Two", email: "c2@example.com" },
      granularity: "word",
    });
    doc.import(update);
    doc.commit();

    const after = resolveComment(doc, id);
    expect(after.method).toBe("crdt");
    expect(after.text).toBe("quick brown");
  });

  it("falls back to fuzzy/orphaned when the CRDT anchor is destroyed", () => {
    const mdA = "# Title\n\nA short paragraph to delete.\n\nKeep me.\n";
    const mdB = "# Title\n\nKeep me.\n";
    const doc = seedDoc("docA", mdA, "commitA", AUTHOR);
    const { text } = docPlainText(doc);
    const idx = text.indexOf("paragraph to delete");
    const id = addComment(doc, idx, idx + "paragraph to delete".length, "will be deleted", {
      userId: "u1",
      name: "Alice",
    });
    const { update } = computeRebaseUpdate(doc, {
      docId: "docA",
      targetMarkdown: mdB,
      targetCommit: "commitB",
      author: { name: "Contributor Two", email: "c2@example.com" },
      granularity: "word",
    });
    doc.import(update);
    doc.commit();
    const after = resolveComment(doc, id);
    expect(after.method).toBe("orphaned");
    expect(after.quote?.exact).toBe("paragraph to delete");
  });
});

describe("attribution", () => {
  it("attributes seed text to the seed git author and rebase text to the rebase peer", () => {
    const mdA = "# Title\n\nHello world.\n";
    const mdB = "# Title\n\nHello brave new world.\n";
    const doc = seedDoc("docA", mdA, "commitA", AUTHOR);
    const { update } = computeRebaseUpdate(doc, {
      docId: "docA",
      targetMarkdown: mdB,
      targetCommit: "commitB",
      author: { name: "Contributor Two", email: "c2@example.com" },
      granularity: "word",
    });
    doc.import(update);
    doc.commit();
    const runs = listAttribution(doc);
    const names = new Set(runs.map((r) => r.author.name));
    expect(names.has("Repo Owner")).toBe(true);
    expect(names.has("Contributor Two")).toBe(true);
    const brave = runs.find((r) => r.text.includes("brave"));
    expect(brave?.author.name).toBe("Contributor Two");
  });
});
