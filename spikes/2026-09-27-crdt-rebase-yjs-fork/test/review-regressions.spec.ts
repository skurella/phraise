// Regressions for findings of the fresh-context review (brief 06).
import { describe, it, expect } from "vitest";
import { Replica, deliver } from "../src/replica.js";
import { needsReview } from "../src/integrate.js";
import { docPlainText } from "../src/text.js";
import { baseConflicts } from "../src/rebase.js";

const AUTHOR_A = { name: "Repo Owner", email: "owner@example.com" };

describe("review regressions", () => {
  it("flags a block whose only upstream change is a mark, when edited locally", () => {
    const a = `# Title\n\nHello world foo bar baz.\n`;
    const b = `# Title\n\nHello **world** foo bar baz.\n`;
    const server = new Replica("server", "doc1", a, "A", AUTHOR_A);
    const bob = new Replica("bob", "doc1", a, "A", AUTHOR_A, { userId: "bob", name: "Bob" });
    server.link(bob);
    const idx = docPlainText(bob.doc).text.indexOf("foo");
    bob.insertText(idx, "BOBEDIT ");
    server.runRebase(b, "B", { name: "C2", email: "c2@example.com" }, "word");
    for (let i = 0; i < 5; i++) {
      deliver(server, bob);
      deliver(bob, server);
    }
    expect(docPlainText(server.doc).text).toContain("BOBEDIT");
    const flagged = needsReview(server.doc).map((e) => e.text);
    expect(flagged).toEqual(["Hello world BOBEDIT foo bar baz."]);
    expect(needsReview(bob.doc).map((e) => e.text)).toEqual(flagged);
    const para = server.docToPM().child(1).toJSON();
    expect(JSON.stringify(para)).toContain('"strong"');
  });

  it("detects sibling rebases from the same base to different targets", () => {
    const a = `# Title\n\nHello world foo bar baz.\n\nSecond paragraph unchanged.\n`;
    const b1 = `# Title\n\nHello world CHANGED-BY-B1 bar baz.\n\nSecond paragraph unchanged.\n`;
    const b2 = `# Title\n\nHello world foo bar baz.\n\nSecond paragraph CHANGED-BY-B2.\n`;
    const x = new Replica("x", "doc1", a, "A", AUTHOR_A);
    const y = new Replica("y", "doc1", a, "A", AUTHOR_A);
    x.link(y);
    expect(baseConflicts(x.doc)).toEqual([]);
    x.runRebase(b1, "B1", { name: "One", email: "1@example.com" }, "word");
    y.runRebase(b2, "B2", { name: "Two", email: "2@example.com" }, "word");
    for (let i = 0; i < 5; i++) {
      deliver(x, y);
      deliver(y, x);
    }
    expect(docPlainText(x.doc).text).toBe(docPlainText(y.doc).text);
    const conflicts = baseConflicts(x.doc);
    expect(conflicts.length).toBe(1);
    expect(conflicts[0].map((r) => r.id).sort()).toEqual(["B1", "B2"]);
  });
});
