import { Node as PMNode } from "prosemirror-model";
import { schema } from "./schema.js";

/**
 * The brief's fixture: a doc with `frontmatter` set (root attr) and a
 * paragraph "see [![ci](badge.svg)](https://ci) now" — an image with a link
 * mark wrapped around it, plus surrounding text. In Markdown that renders as
 * a linked badge; in ProseMirror the `link` mark sits directly in the
 * `image` node's `marks` array (marks apply to individual nodes, including
 * atom/leaf nodes, not just to characters).
 */
export const FRONTMATTER = { title: "probe", tags: ["a", "b"] };

export function buildFixtureDoc(): PMNode {
  return schema.node("doc", { frontmatter: FRONTMATTER }, [
    schema.node("paragraph", null, [
      schema.text("see "),
      schema.node("image", { src: "badge.svg", alt: "ci" }, undefined, [
        schema.mark("link", { href: "https://ci" }),
      ]),
      schema.text(" now"),
    ]),
  ]);
}

export function fixtureJSON(): unknown {
  return buildFixtureDoc().toJSON();
}

/** The image node's marks, as found in the fixture (for assertions). */
export function fixtureImageMarks(doc: PMNode): string[] {
  const marks: string[] = [];
  doc.descendants((node) => {
    if (node.type.name === "image") {
      marks.push(...node.marks.map((m) => m.type.name));
    }
  });
  return marks;
}
