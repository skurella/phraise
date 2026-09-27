// Copied verbatim from spikes/2026-09-27-crdt-rebase-yjs-fork/src/markdown.ts
// (brief instruction: copy what you need, no relative imports across spikes).
// Nothing here is Yjs-specific: it is pure Markdown <-> ProseMirror, shared
// as-is by both CRDT approaches.
import MarkdownIt from "markdown-it";
import type { Node as PMNode } from "prosemirror-model";
import {
  MarkdownParser,
  MarkdownSerializer,
  defaultMarkdownSerializer,
} from "prosemirror-markdown";
import { schema } from "./schema.js";

function listIsTight(tokens: any[], i: number): boolean {
  while (++i < tokens.length) {
    if (tokens[i].type !== "list_item_open") return tokens[i].hidden;
  }
  return false;
}

const tokenizer = MarkdownIt("commonmark", { html: false });

export const markdownParser = new MarkdownParser(schema, tokenizer, {
  blockquote: { block: "blockquote" },
  paragraph: { block: "paragraph" },
  list_item: { block: "list_item" },
  bullet_list: {
    block: "bullet_list",
    getAttrs: (_tok: any, tokens: any[], i: number) => ({
      tight: listIsTight(tokens, i),
    }),
  },
  ordered_list: {
    block: "ordered_list",
    getAttrs: (tok: any, tokens: any[], i: number) => ({
      order: +(tok.attrGet("start")) || 1,
      tight: listIsTight(tokens, i),
    }),
  },
  heading: {
    block: "heading",
    getAttrs: (tok: any) => ({ level: +tok.tag.slice(1) }),
  },
  code_block: { block: "code_block", noCloseToken: true },
  fence: {
    block: "code_block",
    getAttrs: (tok: any) => ({ params: tok.info || "" }),
    noCloseToken: true,
  },
  hr: { ignore: true, noCloseToken: true },
  image: { ignore: true, noCloseToken: true },
  hardbreak: { ignore: true, noCloseToken: true },
  em: { mark: "em" },
  strong: { mark: "strong" },
  link: {
    mark: "link",
    getAttrs: (tok: any) => ({
      href: tok.attrGet("href"),
      title: tok.attrGet("title") || null,
    }),
  },
  code_inline: { mark: "code", noCloseToken: true },
} as any);

export function parseMarkdown(md: string): PMNode {
  return markdownParser.parse(md);
}

export const markdownSerializer = new MarkdownSerializer(
  {
    blockquote: defaultMarkdownSerializer.nodes.blockquote,
    code_block: defaultMarkdownSerializer.nodes.code_block,
    heading: defaultMarkdownSerializer.nodes.heading,
    horizontal_rule: defaultMarkdownSerializer.nodes.horizontal_rule,
    bullet_list: defaultMarkdownSerializer.nodes.bullet_list,
    ordered_list: defaultMarkdownSerializer.nodes.ordered_list,
    list_item: defaultMarkdownSerializer.nodes.list_item,
    paragraph: defaultMarkdownSerializer.nodes.paragraph,
    text: defaultMarkdownSerializer.nodes.text,
  },
  {
    em: defaultMarkdownSerializer.marks.em,
    strong: defaultMarkdownSerializer.marks.strong,
    link: defaultMarkdownSerializer.marks.link,
    code: defaultMarkdownSerializer.marks.code,
  }
);

export function serializeMarkdown(doc: PMNode): string {
  return markdownSerializer.serialize(doc);
}
