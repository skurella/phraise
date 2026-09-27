// Fast sanity checks for replica.ts/integrate.ts/comments.ts/reseed.ts
// before the full gate suite exercises them in combination.
import { describe, it, expect } from "vitest";
import { Replica, deliver } from "../src/replica.js";
import { needsReview } from "../src/integrate.js";
import { addComment, resolveComment, listComments } from "../src/comments.js";
import { reseed } from "../src/reseed.js";
import { AUTHOR } from "./helpers.js";

const DOC = "smoke-doc";
const A_MD = "# Title\n\nFirst paragraph here.\n\nSecond paragraph here.\n";

function makeServer(): Replica {
  return new Replica("server", DOC, A_MD, "A", AUTHOR);
}

describe("smoke", () => {
  it("seeds, edits, rebases, and integrates a concurrent-edit flag", () => {
    const server = makeServer();
    const alice = new Replica("alice", DOC, A_MD, "A", AUTHOR, { userId: "alice", name: "Alice" });
    server.link(alice);

    const globalText = "Title\nFirst paragraph here.\nSecond paragraph here.";
    const idx = globalText.indexOf("Second");
    alice.insertText(idx, "EDITED ");

    const B_MD = "# Title\n\nFirst paragraph here.\n\nSecond paragraph HERE changed.\n";
    const rebaseId = server.runRebase(B_MD, "B", AUTHOR, "word");
    expect(rebaseId).toBe("B");

    deliver(server, alice); // server -> alice: rebase result
    deliver(alice, server); // alice -> server: her edit + her review flag

    const flagsAlice = needsReview(alice.doc);
    const flagsServer = needsReview(server.doc);
    expect(flagsAlice.length).toBeGreaterThan(0);
    expect(flagsServer.length).toBe(flagsAlice.length);
  });

  it("comments resolve via crdt and survive an unrelated rebase", () => {
    const server = makeServer();
    const globalText = "Title\nFirst paragraph here.\nSecond paragraph here.";
    const start = globalText.indexOf("First paragraph");
    const end = start + "First paragraph".length;
    const id = addComment(server.doc, start, end, "nice", { userId: "bob", name: "Bob" });

    const before = resolveComment(server.doc, id);
    expect(before.method).toBe("crdt");
    expect(before.text).toBe("First paragraph");

    const B_MD = "# Title\n\nFirst paragraph here.\n\nSecond paragraph CHANGED.\n";
    server.runRebase(B_MD, "B", AUTHOR, "word");

    const after = resolveComment(server.doc, id);
    expect(after.method).toBe("crdt");
    expect(after.text).toBe("First paragraph");
  });

  it("reseed anchors an unchanged comment by selectors", () => {
    const server = makeServer();
    const globalText = "Title\nFirst paragraph here.\nSecond paragraph here.";
    const start = globalText.indexOf("Second paragraph");
    const end = start + "Second paragraph".length;
    const id = addComment(server.doc, start, end, "hi", { userId: "bob", name: "Bob" });

    const report = reseed(server.doc, DOC, A_MD, "A2", AUTHOR);
    expect(report.outcomes.get(id)).toBe("anchored");
    const comments = listComments(report.doc);
    expect(comments.find((c) => c.id === id)).toBeTruthy();
  });
});
