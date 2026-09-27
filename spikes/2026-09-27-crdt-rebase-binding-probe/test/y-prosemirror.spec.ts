/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  prosemirrorToYXmlFragment,
  yXmlFragmentToProseMirrorRootNode,
  updateYFragment,
  initProseMirrorDoc,
  ySyncPlugin,
} from "y-prosemirror";
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { schema } from "../src/schema.js";
import { buildFixtureDoc, fixtureImageMarks } from "../src/fixture.js";

// Task 1, brief 05: y-prosemirror 1.3.7 + yjs 13.6.33.
//
// Source read: node_modules/y-prosemirror/src/lib.js and
// src/plugins/sync-plugin.js (see log for line references). Two structural
// facts drive every result below:
//  - Y.XmlFragment (used for the document root) has no `setAttribute`; only
//    Y.XmlElement (used for every other node type) carries attributes. So
//    the root doc's attrs have nowhere to live in the Yjs model at all.
//  - `createTypeFromElementNode` (PM node -> Y.XmlElement) copies
//    `node.attrs` only; it never reads `node.marks`. `createNodeFromYElement`
//    (Y.XmlElement -> PM node) calls `schema.node(el.nodeName, attrs,
//    children)` with no marks argument either. So marks on an atom/leaf
//    element node are dropped on the way in, not just on the way out.

describe("y-prosemirror 1.3.7: root doc attrs and atom-node marks", () => {
  it("path (i): prosemirrorToYXmlFragment -> yXmlFragmentToProseMirrorRootNode", () => {
    const fixture = buildFixtureDoc();
    // The fragment must be attached to a Y.Doc before it (or its children)
    // can be read back; passing an unattached fragment produces "Invalid
    // access: Add Yjs type to a document before reading data."
    const ydoc = new Y.Doc();
    const fragment = ydoc.get("pm", Y.XmlFragment);
    prosemirrorToYXmlFragment(fixture, fragment);
    const roundTripped = yXmlFragmentToProseMirrorRootNode(fragment, schema);

    // Root attrs: lost. Y.XmlFragment has no attribute storage, so the
    // rebuilt root always falls back to the schema's default (`null`).
    expect(fixture.attrs.frontmatter).not.toBeNull();
    expect(roundTripped.attrs.frontmatter).toBeNull();

    // Atom marks: lost. The link mark around the image never reaches the
    // Y.XmlElement in the first place.
    expect(fixtureImageMarks(fixture)).toEqual(["link"]);
    expect(fixtureImageMarks(roundTripped)).toEqual([]);

    // Everything else round-trips: the paragraph text either side of the
    // image is unaffected.
    expect(roundTripped.textContent).toBe(fixture.textContent);
  });

  it("path (ii): updateYFragment from an empty fragment (the ySyncPlugin path)", () => {
    const fixture = buildFixtureDoc();
    const ydoc = new Y.Doc();
    const fragment = ydoc.get("pm", Y.XmlFragment);
    updateYFragment(ydoc, fragment, fixture, {
      mapping: new Map(),
      isOMark: new Map(),
    });
    const roundTripped = yXmlFragmentToProseMirrorRootNode(fragment, schema);

    expect(roundTripped.attrs.frontmatter).toBeNull();
    expect(fixtureImageMarks(roundTripped)).toEqual([]);
    expect(roundTripped.textContent).toBe(fixture.textContent);
  });

  it("path (iii): real ySyncPlugin in an EditorView under jsdom, edited then re-synced through a second doc", () => {
    const fixture = buildFixtureDoc();

    // Doc A: seed with the fixture minus the link mark (we add the mark via
    // a real transaction below, to exercise the live edit path). The
    // recommended y-prosemirror wiring seeds the Y fragment *first*, then
    // builds the initial EditorState doc from the fragment via
    // `initProseMirrorDoc` — the plugin's `view()` hook force-rerenders the
    // editor from the (at that point still empty) Y content on
    // construction, which silently discards any doc passed to
    // `EditorState.create` that wasn't already mirrored into Y.
    const withoutLink = schema.node("doc", fixture.attrs, [
      schema.node("paragraph", null, [
        schema.text("see "),
        schema.node("image", { src: "badge.svg", alt: "ci" }),
        schema.text(" now"),
      ]),
    ]);

    const ydocA = new Y.Doc();
    const fragmentA = ydocA.get("pm", Y.XmlFragment);
    updateYFragment(ydocA, fragmentA, withoutLink, {
      mapping: new Map(),
      isOMark: new Map(),
    });
    const { doc: initialDoc, mapping } = initProseMirrorDoc(fragmentA, schema);
    // Root attrs already lost at this point (seed path, same as path ii).
    expect(initialDoc.attrs.frontmatter).toBeNull();

    const state0 = EditorState.create({
      doc: initialDoc,
      schema,
      plugins: [ySyncPlugin(fragmentA, { mapping })],
    });
    const view = new EditorView(document.createElement("div"), {
      state: state0,
    });

    // Find the image node's position and dispatch a transaction that adds
    // the link mark around it, the way a real editing session would.
    let imagePos = -1;
    view.state.doc.descendants((node, pos) => {
      if (node.type.name === "image") imagePos = pos;
    });
    expect(imagePos).toBeGreaterThanOrEqual(0);
    const linkMark = schema.marks.link.create({ href: "https://ci" });
    const tr = view.state.tr.addMark(imagePos, imagePos + 1, linkMark);
    view.dispatch(tr);

    // Confirm the live PM view really has the mark before crossing into Yjs.
    let liveMarks: string[] = [];
    view.state.doc.descendants((node) => {
      if (node.type.name === "image") liveMarks = node.marks.map((m) => m.type.name);
    });
    expect(liveMarks).toEqual(["link"]);

    // Now take ydocA's update and apply it to a fresh doc B (simulating
    // another replica), then read doc B back into ProseMirror.
    const update = Y.encodeStateAsUpdate(ydocA);
    const ydocB = new Y.Doc();
    Y.applyUpdate(ydocB, update);
    const fragmentB = ydocB.get("pm", Y.XmlFragment);
    const rebuilt = yXmlFragmentToProseMirrorRootNode(fragmentB, schema);

    expect(fixtureImageMarks(rebuilt)).toEqual([]);
    // The synced plain text is unaffected by the mark loss.
    expect(rebuilt.textContent).toBe(withoutLink.textContent);

    view.destroy();
  });
});
