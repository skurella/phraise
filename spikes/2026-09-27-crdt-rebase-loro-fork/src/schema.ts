// Copied verbatim from spikes/2026-09-27-crdt-rebase-yjs-fork/src/schema.ts
// (brief instruction: copy what you need, no relative imports across spikes).
//
// Own ProseMirror schema per plan section 2: doc, paragraph, heading(level),
// bullet_list, ordered_list(order), list_item, blockquote, code_block(params),
// horizontal_rule, text; marks em, strong, code, link(href, title).
// No inline nodes other than text, so every textblock maps to exactly one
// LoroText child in loro-prosemirror's encoding (verified in this spike).
import { Schema } from "prosemirror-model";

export const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      content: "inline*",
      group: "block",
    },
    heading: {
      attrs: { level: { default: 1 } },
      content: "inline*",
      group: "block",
      defining: true,
    },
    blockquote: {
      content: "block+",
      group: "block",
    },
    code_block: {
      content: "text*",
      group: "block",
      code: true,
      defining: true,
      marks: "",
      attrs: { params: { default: "" } },
    },
    horizontal_rule: {
      group: "block",
    },
    ordered_list: {
      content: "list_item+",
      group: "block",
      attrs: { order: { default: 1 }, tight: { default: false } },
    },
    bullet_list: {
      content: "list_item+",
      group: "block",
      attrs: { tight: { default: false } },
    },
    list_item: {
      content: "block+",
      defining: true,
    },
    text: {
      group: "inline",
    },
  },
  marks: {
    em: {},
    strong: {},
    code: { code: true },
    link: {
      attrs: { href: {}, title: { default: null } },
      inclusive: false,
    },
  },
});

export type PMSchema = typeof schema;
