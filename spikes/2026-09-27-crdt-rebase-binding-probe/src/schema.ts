import { Schema } from "prosemirror-model";

/**
 * Tiny probe schema per brief 05. Not the spike-2 production schema (see
 * `../2026-09-27-crdt-rebase-yjs-fork/src/schema.ts` for that) — this one
 * exists only to isolate two specific loss modes:
 *  - a root `doc` attribute (`frontmatter`)
 *  - a mark applied to an inline atom (leaf) node (`link` around `image`)
 */
export const schema = new Schema({
  nodes: {
    doc: {
      content: "paragraph+",
      attrs: { frontmatter: { default: null } },
    },
    paragraph: {
      content: "inline*",
      group: "block",
      toDOM: () => ["p", 0],
      parseDOM: [{ tag: "p" }],
    },
    text: {
      group: "inline",
    },
    image: {
      inline: true,
      group: "inline",
      atom: true,
      attrs: {
        src: {},
        alt: { default: "" },
      },
      toDOM: (node) => [
        "img",
        { src: node.attrs.src as string, alt: node.attrs.alt as string },
      ],
      parseDOM: [
        {
          tag: "img[src]",
          getAttrs(dom) {
            const el = dom as HTMLElement;
            return {
              src: el.getAttribute("src"),
              alt: el.getAttribute("alt") || "",
            };
          },
        },
      ],
    },
  },
  marks: {
    link: {
      attrs: { href: {} },
      inclusive: false,
      toDOM: (mark) => ["a", { href: mark.attrs.href as string }, 0],
      parseDOM: [
        {
          tag: "a[href]",
          getAttrs(dom) {
            const el = dom as HTMLElement;
            return { href: el.getAttribute("href") };
          },
        },
      ],
    },
    strong: {
      toDOM: () => ["strong", 0],
      parseDOM: [{ tag: "strong" }],
    },
  },
});
