import { describe, expect, it } from "vitest";
import * as Y from "@y/y";

// Task 4, brief 05: Yjs 14 attribution probe.
//
// No `attributing-content.md` ships in the `@y/y`@14.0.0-rc.26 npm tarball
// (only LICENSE/README.md/package.json/global.d.ts at the package root); it
// may exist only in the yjs/yjs repo's working tree at a later commit than
// this pre-release. What ships instead is a genuinely new "attribution
// manager" surface: `AttributionsRenderer` / `createAttributionsRenderer`
// (node_modules/@y/y/src/utils/Renderer.js) and the `ContentIds`/`ContentMap`
// helpers (`src/utils/meta.js`, `src/utils/ids.js`): `createContentIds`,
// `createContentIdsFromDoc`, `createContentIdsFromDocDiff`,
// `createContentAttribute`, `IdSet`/`IdMap`.
//
// Reading Renderer.js and renderer-helpers.js: `AttributionsRenderer` takes
// an *explicit* `attributions` ContentMap you construct yourself (an
// `{ inserts, deletes }` pair of IdMaps mapping id ranges to attribution
// values you choose, e.g. via `createContentAttribute`). It is built for
// suggestion-mode/version-diff rendering (turning a diff into
// `y-attributed-*` marks, see @y/prosemirror's task-3 tests) - it does not
// *automatically* derive "which client inserted this" the way this probe
// needed. That answer is still exactly where it was in Yjs 13: every Item
// carries `id.client`, the numeric peer id of whoever created it, and the
// struct store is fundamentally partitioned per client. Two ways to read
// that partition, both verified below:
//  1. Walk a Y.Node's `_start`/`.right` item chain directly (same technique
//     y-prosemirror 1.x / this spike's own core plan section 7 use for
//     Yjs 13) - gives ordered, position-preserving runs.
//  2. `createInsertSetFromStructStore(doc.store, true)` -> an `IdSet`, whose
//     public `forEach((range, client) => ...)` yields exactly the
//     (client, clock-range) pairs the struct store holds - unordered by
//     position but needs no internal-field access.
// Both agree in the test below.

/** Walk a Y.Node's item chain in document order, grouping consecutive
 * characters by the client that inserted them. */
function attributionRuns(node: any): Array<{ client: number; text: string }> {
  const runs: Array<{ client: number; text: string }> = [];
  let item = node._start;
  while (item !== null) {
    if (!item.deleted && item.content && typeof item.content.str === "string") {
      const text = item.content.str as string;
      const client = item.id.client as number;
      const last = runs[runs.length - 1];
      if (last && last.client === client) {
        last.text += text;
      } else {
        runs.push({ client, text });
      }
    }
    item = item.right;
  }
  return runs;
}

describe("Yjs 14 attribution probe", () => {
  it("lists which client inserted which range, two clients", () => {
    const docA = new Y.Doc({ gc: false });
    const textA = docA.get("text");
    textA.insert(0, "hello ");

    const docB = new Y.Doc();
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    const textB = docB.get("text");
    textB.insert(textB.length, "world");

    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB, Y.encodeStateVector(docA)));

    expect(textA.toString()).toBe("hello world");
    const runs = attributionRuns(textA);
    expect(runs).toEqual([
      { client: docA.clientID, text: "hello " },
      { client: docB.clientID, text: "world" },
    ]);
  });

  it("still works for a doc forked at an earlier state, edited by a third client, and merged back (this spike's rebase shape)", () => {
    const docA = new Y.Doc({ gc: false });
    const textA = docA.get("text");
    textA.insert(0, "hello ");

    const docB = new Y.Doc();
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    const textB = docB.get("text");
    textB.insert(textB.length, "world");
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB, Y.encodeStateVector(docA)));

    // Fork at the current state (requires gc:false on the origin, same
    // requirement as this spike's Yjs-13 fork-at-base rebase).
    const forkStateVector = Y.encodeStateVector(docA);
    const snapshot = Y.snapshot(docA);
    const docC = Y.createDocFromSnapshot(docA, snapshot, new Y.Doc({ gc: false }));
    const textC = docC.get("text");
    expect(textC.toString()).toBe(textA.toString());

    // A third client edits the fork.
    textC.insert(0, "[edited] ");

    // Merge the fork's edit back into the live doc.
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docC, forkStateVector));

    expect(textA.toString()).toBe("[edited] hello world");
    const runs = attributionRuns(textA);
    expect(runs).toEqual([
      { client: docC.clientID, text: "[edited] " },
      { client: docA.clientID, text: "hello " },
      { client: docB.clientID, text: "world" },
    ]);

    // Cross-check against the public IdSet surface (no internal-field
    // access): same three (client, length) pairs, in some order.
    const insertSet = Y.createInsertSetFromStructStore(docA.store, true);
    const perClient: Array<{ client: number; len: number }> = [];
    insertSet.forEach((range: { clock: number; len: number }, client: number) => {
      perClient.push({ client, len: range.len });
    });
    perClient.sort((a, b) => a.client - b.client);
    const expected = [
      { client: docA.clientID, len: 6 },
      { client: docB.clientID, len: 5 },
      { client: docC.clientID, len: 9 },
    ].sort((a, b) => a.client - b.client);
    expect(perClient).toEqual(expected);
  });
});
