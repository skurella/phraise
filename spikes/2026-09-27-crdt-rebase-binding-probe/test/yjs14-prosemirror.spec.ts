/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import * as Y from "@y/y";
import {
  pmnodeToDelta,
  ynodeToPmnode,
  syncPlugin,
  configureYProsemirror,
} from "@y/prosemirror";
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { schema } from "../src/schema.js";
import { buildFixtureDoc, fixtureImageMarks } from "../src/fixture.js";

// Task 3, brief 05: the Yjs 14 RC binding (@y/y@14.0.0-rc.26, @y/prosemirror@2.0.0-13).
//
// Both `@y/y` and `@y/prosemirror` installed and ran without incident (see
// log for the one API-shape surprise: Yjs 14 has no `Y.Text`/`Y.Map`/
// `Y.XmlFragment`/`Y.XmlElement` any more — every shared type is a single
// unified `Y.Node`, configured by what you call on it (`insert`/`delete` for
// text-like use, `setAttr`/`getAttr` for map-like use, `push` for
// array-like use). This converges structurally with loro-prosemirror's
// uniform "nodeName + attributes + children" node shape (task 2): both
// project the root the same way as every other node.
//
// Source read: node_modules/@y/prosemirror/src/sync-utils.js `nodeToDelta`
// (PM -> Y direction, ~line 501-516): every node's own attrs are captured
// via `d.setAttrs(n.attrs)` unconditionally, root included (`docToDelta`
// calls it with `nodeName = null` for the doc). And, critically,
// `marksToFormattingAttributes(c.marks)` is passed as the delta insert op's
// format for *every* child — text or element — not gated on `c.isText` the
// way y-prosemirror 1.x's and loro-prosemirror's serializers are. So a mark
// on an atom/leaf node's insert op is captured the same way a mark on a
// text run is. Both losses from tasks 1 and 2 are structurally fixed here.

describe("Yjs 14 RC binding (@y/y, @y/prosemirror): root doc attrs and atom-node marks", () => {
  it("headless: pmnodeToDelta -> applyDelta -> ynodeToPmnode", () => {
    const fixture = buildFixtureDoc();
    const doc = new Y.Doc();
    const ytype = doc.get("prosemirror");
    ytype.applyDelta(pmnodeToDelta(fixture));

    const rebuilt = ynodeToPmnode(ytype, schema);

    // Root attrs: kept. `nodeToDelta`/`docToDelta` set attrs on every node
    // uniformly, root included - no separate fragment type without an
    // attribute slot the way y-prosemirror 1.x's Y.XmlFragment has.
    expect(rebuilt.attrs.frontmatter).toEqual(fixture.attrs.frontmatter);

    // Atom marks: kept. `nodeToDelta`'s child loop attaches
    // `marksToFormattingAttributes(c.marks)` to the insert op regardless of
    // whether the child is text or an element - unlike y-prosemirror 1.x
    // and loro-prosemirror, which only capture marks for text runs.
    expect(fixtureImageMarks(rebuilt)).toEqual(["link"]);

    expect(rebuilt.textContent).toBe(fixture.textContent);
  });

  it("through the real syncPlugin in an EditorView under jsdom, edited then re-synced through a second doc", () => {
    const fixture = buildFixtureDoc();
    const withoutLink = schema.node("doc", fixture.attrs, [
      schema.node("paragraph", null, [
        schema.text("see "),
        schema.node("image", { src: "badge.svg", alt: "ci" }),
        schema.text(" now"),
      ]),
    ]);

    const docA = new Y.Doc();
    const ytypeA = docA.get("prosemirror");
    ytypeA.applyDelta(pmnodeToDelta(withoutLink));

    // Per the package README: create the view first (with an empty/default
    // doc), then bind it to the ytype via `configureYProsemirror`, which
    // dispatches a transaction that hydrates the view from Y synchronously
    // (no setTimeout(0) round-trip, unlike y-prosemirror 1.x's
    // `_forceRerender` / loro-prosemirror's `init()`).
    const state0 = EditorState.create({ schema, plugins: [syncPlugin()] });
    const view = new EditorView(document.createElement("div"), {
      state: state0,
    });
    configureYProsemirror({ ytype: ytypeA })(view.state, view.dispatch);

    expect(view.state.doc.attrs.frontmatter).toEqual(fixture.attrs.frontmatter);
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
    // Unlike loro-prosemirror's live binding, the edit does not clobber the
    // root attrs already in the live view.
    expect(view.state.doc.attrs.frontmatter).toEqual(fixture.attrs.frontmatter);

    const update = Y.encodeStateAsUpdate(docA);
    const docB = new Y.Doc();
    Y.applyUpdate(docB, update);
    const ytypeB = docB.get("prosemirror");
    const rebuilt = ynodeToPmnode(ytypeB, schema);

    expect(rebuilt.attrs.frontmatter).toEqual(fixture.attrs.frontmatter);
    expect(fixtureImageMarks(rebuilt)).toEqual(["link"]);
    expect(rebuilt.textContent).toBe(withoutLink.textContent);

    view.destroy();
  });
});
