// Origin: spike 3 (daemon-file-sync-fork-import) src/md/schema.ts, commit 9343b62, with
// toDOM/parseDOM rules taken from spike 5 (collab-stack-yjs13-hocuspocus), branch
// spike/2026-09-27-collab-stack, commit eeb3fe2, src/schema.ts.
// ProseMirror schema for block-preserving Markdown. See brief 02 design.
//
// Attributes come in two kinds:
//  - semantic: compared by semanticEq (src/compare.ts)
//  - meta: ignored by comparison. Meta attrs are `src`, `gap`, and anything
//    whose name ends in `Hint`.
//
// toDOM/parseDOM below are new for spike 5 (spike 1 never rendered a real
// EditorView, only parsed/serialized/compared doc trees headlessly). They
// exist so a live jsdom EditorView can render this schema and so
// `view.pasteHTML` (gate B's paste step) has parse rules to build a paste
// Slice from. They carry no semantic weight of their own -- semanticEq
// (src/compare.ts) never looks at rendered DOM -- and deliberately don't
// try to round-trip every meta/hint attr through the DOM; a paste is a
// fresh edit, not a re-parse of the original Markdown.
import { Schema, type NodeSpec, type MarkSpec } from 'prosemirror-model';

/** True if an attribute name is meta (ignored by semantic comparison). */
export function isMetaAttrName(name: string): boolean {
  // refType (full, collapsed, shortcut) is reference syntax; the identifier is the semantic target.
  return name === 'src' || name === 'gap' || name === 'refType' || name === 'leafMarks' || /Hint$/.test(name);
}

// Every top-level-capable block node gets `src`/`gap` meta attrs. They are
// null for nodes that are not currently top-level (nested blocks).
const srcGapAttrs = {
  src: { default: null as string | null },
  gap: { default: null as string | null },
};

const nodes: Record<string, NodeSpec> = {
  doc: {
    content: 'block+',
    attrs: {
      lead: { default: '' },
      eol: { default: '\n' },
    },
  },

  paragraph: {
    content: 'inline*',
    group: 'block',
    attrs: { ...srcGapAttrs },
    toDOM: () => ['p', 0],
    parseDOM: [{ tag: 'p' }],
  },

  heading: {
    content: 'inline*',
    group: 'block',
    attrs: {
      level: { default: 1 },
      setextHint: { default: false },
      closeHint: { default: false },
      ...srcGapAttrs,
    },
    toDOM: (node) => [`h${Math.min(Math.max(node.attrs.level, 1), 6)}`, 0],
    parseDOM: [1, 2, 3, 4, 5, 6].map((level) => ({ tag: `h${level}`, attrs: { level } })),
  },

  blockquote: {
    content: 'block+',
    group: 'block',
    attrs: { ...srcGapAttrs },
    toDOM: () => ['blockquote', 0],
    parseDOM: [{ tag: 'blockquote' }],
  },

  bullet_list: {
    content: 'list_item+',
    group: 'block',
    attrs: {
      tight: { default: true },
      markerHint: { default: '-' },
      ...srcGapAttrs,
    },
    toDOM: () => ['ul', 0],
    parseDOM: [{ tag: 'ul' }],
  },

  ordered_list: {
    content: 'list_item+',
    group: 'block',
    attrs: {
      start: { default: 1 },
      tight: { default: true },
      delimHint: { default: '.' },
      ...srcGapAttrs,
    },
    toDOM: (node) => ['ol', node.attrs.start !== 1 ? { start: node.attrs.start } : {}, 0],
    parseDOM: [
      {
        tag: 'ol',
        getAttrs: (dom) => ({
          start: dom.hasAttribute('start') ? Number(dom.getAttribute('start')) : 1,
        }),
      },
    ],
  },

  list_item: {
    content: 'block*',
    attrs: {
      checked: { default: null as boolean | null },
    },
    toDOM: () => ['li', 0],
    parseDOM: [{ tag: 'li' }],
  },

  code_block: {
    content: 'text*',
    marks: '',
    code: true,
    group: 'block',
    attrs: {
      lang: { default: null as string | null },
      meta: { default: null as string | null },
      fenceHint: { default: '`' },
      fenceLenHint: { default: 3 },
      ...srcGapAttrs,
    },
    toDOM: () => ['pre', ['code', 0]],
    parseDOM: [{ tag: 'pre', preserveWhitespace: 'full' }],
  },

  horizontal_rule: {
    group: 'block',
    attrs: {
      ruleHint: { default: '---' },
      ...srcGapAttrs,
    },
    toDOM: () => ['hr'],
    parseDOM: [{ tag: 'hr' }],
  },

  table: {
    content: 'table_row+',
    group: 'block',
    attrs: {
      align: { default: [] as (string | null)[] },
      ...srcGapAttrs,
    },
    toDOM: () => ['table', ['tbody', 0]],
    parseDOM: [{ tag: 'table' }],
  },

  table_row: {
    content: 'table_cell+',
    attrs: {
      header: { default: false },
    },
    toDOM: () => ['tr', 0],
    parseDOM: [{ tag: 'tr' }],
  },

  table_cell: {
    content: 'inline*',
    attrs: {},
    toDOM: () => ['td', 0],
    parseDOM: [{ tag: 'td' }, { tag: 'th' }],
  },

  raw_block: {
    content: 'text*',
    marks: '',
    code: true,
    group: 'block',
    attrs: {
      kind: { default: 'html' },
      ...srcGapAttrs,
    },
    toDOM: (node) => ['pre', { 'data-raw-kind': node.attrs.kind }, 0],
  },

  text: {
    group: 'inline',
  },

  hard_break: {
    group: 'inline',
    inline: true,
    attrs: {
      breakHint: { default: '  \n' },
      leafMarks: { default: null as string | null },
    },
    toDOM: () => ['br'],
    parseDOM: [{ tag: 'br' }],
  },

  image: {
    group: 'inline',
    inline: true,
    attrs: {
      url: { default: '' },
      alt: { default: '' },
      title: { default: null as string | null },
      refType: { default: null as string | null },
      identifier: { default: null as string | null },
      label: { default: null as string | null },
      leafMarks: { default: null as string | null },
    },
    toDOM: (node) => ['img', { src: node.attrs.url, alt: node.attrs.alt, title: node.attrs.title }],
    parseDOM: [
      {
        tag: 'img[src]',
        getAttrs: (dom) => ({
          url: dom.getAttribute('src') || '',
          alt: dom.getAttribute('alt') || '',
          title: dom.getAttribute('title') || null,
        }),
      },
    ],
  },

  raw_inline: {
    group: 'inline',
    inline: true,
    attrs: {
      kind: { default: 'html' },
      value: { default: '' },
      leafMarks: { default: null as string | null },
    },
    toDOM: (node) => ['span', { 'data-raw-kind': node.attrs.kind }, node.attrs.value],
  },
};

const marks: Record<string, MarkSpec> = {
  em: {
    attrs: { markerHint: { default: '*' } },
    toDOM: () => ['em', 0],
    parseDOM: [{ tag: 'em' }, { tag: 'i' }],
  },
  strong: {
    attrs: { markerHint: { default: '**' } },
    toDOM: () => ['strong', 0],
    parseDOM: [{ tag: 'strong' }, { tag: 'b' }],
  },
  strike: {
    attrs: {},
    toDOM: () => ['s', 0],
    parseDOM: [{ tag: 's' }, { tag: 'del' }, { tag: 'strike' }],
  },
  code: {
    attrs: {},
    toDOM: () => ['code', 0],
    parseDOM: [{ tag: 'code' }],
  },
  link: {
    attrs: {
      href: { default: '' },
      title: { default: null as string | null },
      refType: { default: null as string | null },
      identifier: { default: null as string | null },
      label: { default: null as string | null },
      kindHint: { default: 'inline' },
    },
    toDOM: (mark) => ['a', { href: mark.attrs.href, title: mark.attrs.title }, 0],
    parseDOM: [
      {
        tag: 'a[href]',
        getAttrs: (dom) => ({
          href: dom.getAttribute('href') || '',
          title: dom.getAttribute('title') || null,
        }),
      },
    ],
  },
};

export const schema = new Schema({ nodes, marks });
