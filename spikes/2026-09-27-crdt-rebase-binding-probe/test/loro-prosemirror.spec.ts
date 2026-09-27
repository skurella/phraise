/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import { LoroDoc } from "loro-crdt";
import {
  updateLoroToPmState,
  createNodeFromLoroObj,
  LoroSyncPlugin,
  ROOT_DOC_KEY,
} from "loro-prosemirror";
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { schema } from "../src/schema.js";
import { buildFixtureDoc, fixtureImageMarks } from "../src/fixture.js";

// Task 2, brief 05: loro-prosemirror 0.4.4 + loro-crdt 1.16.3.
//
// Source read: node_modules/loro-prosemirror/src/lib.ts and sync-plugin.ts
// (see log for line references). Structural facts that drive the results:
//  - The document root is stored the *same way* as every other node: a
//    LoroMap with "nodeName" / "attributes" (LoroMap) / "children" (LoroList)
//    keys (`doc.getMap(ROOT_DOC_KEY)`, ROOT_DOC_KEY = "doc"). There is no
//    special fragment type for the root the way y-prosemirror has
//    Y.XmlFragment, so root attrs go through the exact same
//    `updateLoroMapAttributes`/`getLoroMapAttributes` path as any other
//    node's attrs — nothing structurally prevents the root from keeping
//    them.
//  - `createLoroMap`/`updateLoroMapAttributes` (lib.ts:532, 583) copy only
//    `node.attrs`; they never read `node.marks`. `createNodeFromLoroObj`
//    (lib.ts:107) reconstructs an element-backed node via
//    `schema.node(nodeName, attributes.toJSON(), mappedChildren)` — again no
//    marks argument. Marks are only captured for LoroText delta runs
//    (`nodeMarksToAttributes`, used by `createLoroText`/`updateLoroText`),
//    which covers plain inline text but not an atom node's own marks.

describe("loro-prosemirror 0.4.4: root doc attrs and atom-node marks", () => {
  it("headless: updateLoroToPmState -> createNodeFromLoroObj", () => {
    const fixture = buildFixtureDoc();
    const loroDoc = new LoroDoc();
    const seedState = EditorState.create({ doc: fixture, schema });
    // loro-prosemirror's public types (`LoroDocType`, `LoroNode`) are not
    // exported by name (see log); `LoroDoc`'s default generic doesn't
    // structurally match them, so a cast is required at this boundary.
    updateLoroToPmState(loroDoc as any, new Map(), seedState);

    const innerDoc = loroDoc.getMap(ROOT_DOC_KEY);
    const rebuilt = createNodeFromLoroObj(schema, innerDoc as any, new Map());

    // Root attrs: kept. Unlike y-prosemirror's Y.XmlFragment, the loro root
    // is a plain LoroMap with the same attributes slot every node gets.
    expect(fixture.attrs.frontmatter).not.toBeNull();
    expect(rebuilt.attrs.frontmatter).toEqual(fixture.attrs.frontmatter);

    // Atom marks: lost. Same structural gap as y-prosemirror: element-node
    // serialization only walks `node.attrs`, never `node.marks`.
    expect(fixtureImageMarks(fixture)).toEqual(["link"]);
    expect(fixtureImageMarks(rebuilt)).toEqual([]);

    expect(rebuilt.textContent).toBe(fixture.textContent);
  });

  it("through LoroSyncPlugin in an EditorView under jsdom, edited then re-synced through a second doc", async () => {
    const fixture = buildFixtureDoc();
    const withoutLink = schema.node("doc", fixture.attrs, [
      schema.node("paragraph", null, [
        schema.text("see "),
        schema.node("image", { src: "badge.svg", alt: "ci" }),
        schema.text(" now"),
      ]),
    ]);

    // Seed the Loro doc first (same reasoning as the y-prosemirror probe:
    // LoroSyncPlugin's `view()` hook schedules an async `init(view)` via
    // `setTimeout(0)` that *replaces* the editor's whole doc with whatever
    // is already in the Loro doc, so the editor's initial content must come
    // from there, not from `EditorState.create({ doc })`).
    const loroDocA = new LoroDoc();
    const seedState = EditorState.create({ doc: withoutLink, schema });
    updateLoroToPmState(loroDocA as any, new Map(), seedState);

    const state0 = EditorState.create({
      schema,
      plugins: [LoroSyncPlugin({ doc: loroDocA as any })],
    });
    const view = new EditorView(document.createElement("div"), {
      state: state0,
    });

    // Let the scheduled init() run: it replaces view.state.doc from Loro.
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Root attrs: lost here too, but for a *different* reason than in the
    // headless test above. `init()` (sync-plugin.ts) builds the rebuilt
    // node correctly (with `frontmatter` intact — see the headless test)
    // but then does `view.state.tr.replace(0, size, new Slice(Fragment.from(node), 0, 0))`.
    // `Fragment.from(node)` wraps a single Node — including a "doc"-typed
    // node — as-is; `Transform.replace` only ever substitutes *content*
    // between two positions, so the wrapped node's own attrs can never
    // reach the live doc through a plain `replace` step, no matter what
    // they are. ProseMirror does have a dedicated API for this
    // (`Transform.prototype.setDocAttribute`, confirmed present in this
    // prosemirror-transform version), but the plugin's `init()` and
    // `updateNodeOnLoroEvent()` never call it. So: attrs are stored
    // correctly in Loro (previous test) but the *live binding* still drops
    // them on every read-back, a plugin-side gap rather than a data-model
    // one.
    expect(view.state.doc.attrs.frontmatter).toBeNull();
    expect(view.state.doc.textContent).toBe(withoutLink.textContent);

    let imagePos = -1;
    view.state.doc.descendants((node, pos) => {
      if (node.type.name === "image") imagePos = pos;
    });
    expect(imagePos).toBeGreaterThanOrEqual(0);
    const linkMark = schema.marks.link.create({ href: "https://ci" });
    const tr = view.state.tr.addMark(imagePos, imagePos + 1, linkMark);
    view.dispatch(tr);

    let liveMarks: string[] = [];
    view.state.doc.descendants((node) => {
      if (node.type.name === "image") liveMarks = node.marks.map((m) => m.type.name);
    });
    expect(liveMarks).toEqual(["link"]);

    // Export loroDocA's updates and apply to a fresh doc B (another
    // replica), then read doc B back into ProseMirror headlessly.
    const update = loroDocA.export({ mode: "update" });
    const loroDocB = new LoroDoc();
    loroDocB.import(update);
    const innerDocB = loroDocB.getMap(ROOT_DOC_KEY);
    const rebuilt = createNodeFromLoroObj(schema, innerDocB as any, new Map());

    // Worse than a display-only bug: the mark-adding edit above went
    // through `appendTransaction` -> `updateLoroToPmState(state.doc, ...,
    // newEditorState, ...)`, which writes `newEditorState.doc.attrs` (the
    // *live* view's doc, whose `frontmatter` was already nulled by the
    // `init()` gap above) back into Loro. `updateLoroMapAttributes` deletes
    // any attribute whose PM value is `null`, so this single edit actively
    // deletes `frontmatter` from loroDocA's stored attributes map — data
    // loss in the CRDT itself, not just in the view. Doc B, which only ever
    // saw the update *after* that edit, never had a chance to see it.
    expect(rebuilt.attrs.frontmatter).toBeNull();
    expect(fixtureImageMarks(rebuilt)).toEqual([]);
    expect(rebuilt.textContent).toBe(withoutLink.textContent);

    view.destroy();
  });
});
