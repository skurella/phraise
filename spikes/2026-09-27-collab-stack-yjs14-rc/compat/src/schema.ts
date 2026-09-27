// Tiny standalone schema for the compat probe only -- deliberately not
// spike 1's full schema (which lives one level up, in ../src/schema.ts, and
// is not imported here per the charter's "never import across spike
// directories" rule, and this is a sibling subpackage of the spike anyway).
// Mirrors spike 2's binding probe schema (root attr `frontmatter`, an
// inline atom `image` that can carry a `link` mark) since that shape is
// exactly what exercises both of stack 13's losses and is enough to check
// whether either binding's format is readable by the other at all.
import { Schema, type NodeSpec, type MarkSpec } from 'prosemirror-model';

const nodes: Record<string, NodeSpec> = {
  doc: {
    content: 'paragraph+',
    attrs: { frontmatter: { default: null as Record<string, unknown> | null } },
  },
  paragraph: {
    content: 'inline*',
    group: 'block',
  },
  text: { group: 'inline' },
  image: {
    group: 'inline',
    inline: true,
    attrs: { src: { default: '' }, alt: { default: '' } },
  },
};

const marks: Record<string, MarkSpec> = {
  link: {
    attrs: { href: { default: '' } },
  },
  strong: {},
};

export const schema = new Schema({ nodes, marks });

export function buildFixtureDoc() {
  return schema.node('doc', { frontmatter: { title: 'compat probe' } }, [
    schema.node('paragraph', null, [
      schema.text('see '),
      schema.node('image', { src: 'badge.svg', alt: 'ci' }, undefined, [schema.marks.link.create({ href: 'https://ci.example' })]),
      schema.text(' now'),
    ]),
  ]);
}
