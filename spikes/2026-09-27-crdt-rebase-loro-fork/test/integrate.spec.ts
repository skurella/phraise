import { describe, it, expect } from "vitest";
import { LoroDoc, LoroText } from "loro-crdt";
import { seedDoc, docToPM, type Author } from "../src/seed.js";
import { computeRebaseUpdate } from "../src/rebase.js";
import { integrate, needsReview, collectBlocks } from "../src/integrate.js";
import { serializeMarkdown } from "../src/markdown.js";
import { rebasePeerId } from "../src/ids.js";
import { ROOT_DOC_KEY, getChildren } from "../src/loro-doc.js";

const AUTHOR: Author = { name: "Repo Owner", email: "owner@example.com" };

function editBlockAppend(doc: LoroDoc, blockId: string, suffix: string): void {
  function walk(node: any): boolean {
    for (const child of getChildren(node).toArray() as any[]) {
      if (!child || typeof child.get !== "function") continue; // skip LoroText children
      if (child.id === blockId) {
        const kids = getChildren(child).toArray();
        const text = kids[0] as LoroText;
        text.insert(text.length as unknown as number, suffix);
        return true;
      }
      if (walk(child)) return true;
    }
    return false;
  }
  walk(doc.getMap(ROOT_DOC_KEY) as any);
}

// Mirrors the Yjs fork's gate A/C/D2 scenario in miniature: a paragraph B
// leaves untouched (no flag), a paragraph B deletes outright while a remote
// peer edited it offline (needs resurrection, flagged
// deleted-upstream-edited-locally).
describe("integrate", () => {
  it("resurrects a block deleted upstream but edited locally, flags it, and does not flag the server's own run", () => {
    const mdA = "# T\n\nP one text.\n\nP two text.\n\nUnrelated para.\n";
    const mdB = "# T\n\nP one text.\n\nUnrelated para.\n"; // deletes "P two text." outright

    const server = seedDoc("docA", mdA, "commitA", AUTHOR);
    const bobPeer = "999";
    const bob = server.forkAt(server.frontiers());
    bob.setPeerId(bobPeer);

    const twoBlock = collectBlocks(bob).find((b) => b.text.includes("P two"));
    expect(twoBlock).toBeTruthy();
    editBlockAppend(bob, twoBlock!.id, " EDITED");
    bob.commit();

    const bobUpdate = bob.export({ mode: "update", from: server.version() });
    server.import(bobUpdate);
    server.commit();
    const priorFrontiers = server.frontiers();

    const { update } = computeRebaseUpdate(server, {
      docId: "docA",
      targetMarkdown: mdB,
      targetCommit: "commitB",
      author: { name: "Contributor Two", email: "c2@example.com" },
      granularity: "word",
    });
    server.import(update);
    server.commit();

    const serverPeer = String(rebasePeerId("docA", "commitA", "commitB"));
    integrate(server, priorFrontiers, serverPeer);
    // The server didn't author bob's edit, so it resurrects nothing itself.
    expect(needsReview(server).length).toBe(0);

    const toBob = server.export({ mode: "update", from: bob.version() });
    const bobPriorFrontiers = bob.frontiers();
    bob.import(toBob);
    bob.commit();
    integrate(bob, bobPriorFrontiers, bobPeer);

    const review = needsReview(bob);
    const resurrected = review.find((r) => r.reason === "deleted-upstream-edited-locally");
    expect(resurrected).toBeTruthy();
    expect(resurrected!.text).toContain("EDITED");

    const finalMd = serializeMarkdown(docToPM(bob));
    expect(finalMd).toContain("EDITED");
  });

  it("flags concurrent-edit when the same block is touched both upstream and locally", () => {
    const mdA = "# T\n\nAlpha bravo charlie.\n\nOther.\n";
    const mdB = "# T\n\nAlpha bravo charlie delta.\n\nOther.\n"; // rewrite in place

    const server = seedDoc("docA", mdA, "commitA", AUTHOR);
    const alicePeer = "888";
    const alice = server.forkAt(server.frontiers());
    alice.setPeerId(alicePeer);
    const alphaBlock = collectBlocks(alice).find((b) => b.text.includes("Alpha"));
    editBlockAppend(alice, alphaBlock!.id, " echo");
    alice.commit();

    server.import(alice.export({ mode: "update", from: server.version() }));
    server.commit();
    // P (plan section 5): server's frontiers right before the rebase update
    // batch is applied -- after alice's own concurrent edit is already merged in.
    const priorFrontiers = server.frontiers();

    const { update } = computeRebaseUpdate(server, {
      docId: "docA",
      targetMarkdown: mdB,
      targetCommit: "commitB",
      author: { name: "Contributor Two", email: "c2@example.com" },
      granularity: "word",
    });
    server.import(update);
    server.commit();

    const serverPeer = String(rebasePeerId("docA", "commitA", "commitB"));
    integrate(server, priorFrontiers, serverPeer);
    const review = needsReview(server);
    expect(review.some((r) => r.reason === "concurrent-edit")).toBe(true);
  });
});
