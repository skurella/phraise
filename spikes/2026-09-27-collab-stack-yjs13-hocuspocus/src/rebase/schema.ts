// Own ProseMirror schema per plan section 2: doc, paragraph, heading(level),
// bullet_list, ordered_list(order), list_item, blockquote, code_block(params),
// horizontal_rule, text; marks em, strong, code, link(href, title).
// No inline nodes other than text, so every textblock maps to exactly one
// Y.XmlText in y-prosemirror's encoding.
//
// Brief 05 task 3 addition: `toDOM`/`parseDOM` on every node and mark.
// Spike 2 only ever parsed/serialized/diffed doc trees headlessly (no real
// `EditorView`), so nothing needed DOM rendering rules before now -- a real
// EditorView throws (`node.type.spec.toDOM is not a function`) the moment
// it tries to render any node without one. Standard prosemirror-schema-basic/
// -list-shaped rules; no behavior change to the schema's content model,
// attrs, or marks (unchanged from spike 2), only rendering/parsing added.
import { Schema } from "prosemirror-model";

export const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      content: "inline*",
      group: "block",
      toDOM: () => ["p", 0],
      parseDOM: [{ tag: "p" }],
    },
    heading: {
      attrs: { level: { default: 1 } },
      content: "inline*",
      group: "block",
      defining: true,
      toDOM: (node) => [`h${node.attrs.level}`, 0],
      parseDOM: [1, 2, 3, 4, 5, 6].map((level) => ({ tag: `h${level}`, attrs: { level } })),
    },
    blockquote: {
      content: "block+",
      group: "block",
      toDOM: () => ["blockquote", 0],
      parseDOM: [{ tag: "blockquote" }],
    },
    code_block: {
      content: "text*",
      group: "block",
      code: true,
      defining: true,
      marks: "",
      attrs: { params: { default: "" } },
      toDOM: () => ["pre", ["code", 0]],
      parseDOM: [{ tag: "pre", preserveWhitespace: "full" as const }],
    },
    horizontal_rule: {
      group: "block",
      toDOM: () => ["hr"],
      parseDOM: [{ tag: "hr" }],
    },
    ordered_list: {
      content: "list_item+",
      group: "block",
      attrs: { order: { default: 1 }, tight: { default: false } },
      toDOM: (node) => (node.attrs.order === 1 ? ["ol", 0] : ["ol", { start: node.attrs.order }, 0]),
      parseDOM: [
        {
          tag: "ol",
          getAttrs: (dom) => ({
            order: (dom as HTMLElement).hasAttribute("start") ? Number((dom as HTMLElement).getAttribute("start")) : 1,
          }),
        },
      ],
    },
    bullet_list: {
      content: "list_item+",
      group: "block",
      attrs: { tight: { default: false } },
      toDOM: () => ["ul", 0],
      parseDOM: [{ tag: "ul" }],
    },
    list_item: {
      content: "block+",
      defining: true,
      toDOM: () => ["li", 0],
      parseDOM: [{ tag: "li" }],
    },
    text: {
      group: "inline",
    },
  },
  marks: {
    em: {
      toDOM: () => ["em", 0],
      parseDOM: [{ tag: "i" }, { tag: "em" }],
    },
    strong: {
      toDOM: () => ["strong", 0],
      parseDOM: [{ tag: "strong" }, { tag: "b" }],
    },
    code: {
      code: true,
      toDOM: () => ["code", 0],
      parseDOM: [{ tag: "code" }],
    },
    link: {
      attrs: { href: {}, title: { default: null } },
      inclusive: false,
      toDOM: (mark) => ["a", { href: mark.attrs.href, title: mark.attrs.title }, 0],
      parseDOM: [
        {
          tag: "a[href]",
          getAttrs: (dom) => ({
            href: (dom as HTMLElement).getAttribute("href"),
            title: (dom as HTMLElement).getAttribute("title"),
          }),
        },
      ],
    },
  },
});

export type PMSchema = typeof schema;
