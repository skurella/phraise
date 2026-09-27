// ProseMirror schema for block-preserving Markdown. See brief 02 design.
//
// Attributes come in two kinds:
//  - semantic: compared by semanticEq (src/compare.ts)
//  - meta: ignored by comparison. Meta attrs are `src`, `gap`, and anything
//    whose name ends in `Hint`.
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
  },

  blockquote: {
    content: 'block+',
    group: 'block',
    attrs: { ...srcGapAttrs },
  },

  bullet_list: {
    content: 'list_item+',
    group: 'block',
    attrs: {
      tight: { default: true },
      markerHint: { default: '-' },
      ...srcGapAttrs,
    },
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
  },

  list_item: {
    content: 'block*',
    attrs: {
      checked: { default: null as boolean | null },
    },
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
  },

  horizontal_rule: {
    group: 'block',
    attrs: {
      ruleHint: { default: '---' },
      ...srcGapAttrs,
    },
  },

  table: {
    content: 'table_row+',
    group: 'block',
    attrs: {
      align: { default: [] as (string | null)[] },
      ...srcGapAttrs,
    },
  },

  table_row: {
    content: 'table_cell+',
    attrs: {
      header: { default: false },
    },
  },

  table_cell: {
    content: 'inline*',
    attrs: {},
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
  },

  raw_inline: {
    group: 'inline',
    inline: true,
    attrs: {
      kind: { default: 'html' },
      value: { default: '' },
      leafMarks: { default: null as string | null },
    },
  },
};

const marks: Record<string, MarkSpec> = {
  em: {
    attrs: { markerHint: { default: '*' } },
  },
  strong: {
    attrs: { markerHint: { default: '**' } },
  },
  strike: {
    attrs: {},
  },
  code: {
    attrs: {},
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
  },
};

export const schema = new Schema({ nodes, marks });
