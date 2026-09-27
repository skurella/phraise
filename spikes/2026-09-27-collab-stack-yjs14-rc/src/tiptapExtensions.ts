// Brief 04, gate D: a generic converter from spike 1's hand-built
// ProseMirror Schema (src/schema.ts) to Tiptap 3 Node/Mark extensions, so
// Tiptap's own generated schema (via `getSchema(buildTiptapExtensions())`)
// is equivalent to `schema`. Copied unchanged in substance from stack 13's
// src/tiptapExtensions.ts (schema-agnostic: it walks `pmSchema.spec`
// generically and doesn't reference anything Yjs-version-specific) -- see
// that file's header for the full rationale.
import { Node, Mark, getSchema } from '@tiptap/core';
import type { NodeSpec, MarkSpec, Schema } from 'prosemirror-model';
import { schema as pmSchema } from './schema.js';

function attrsConfig(specAttrs: NodeSpec['attrs'] | MarkSpec['attrs']): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, attrSpec] of Object.entries(specAttrs ?? {})) {
    out[key] = {
      default: (attrSpec as { default?: unknown }).default,
      renderHTML: () => ({}),
      parseHTML: () => null,
    };
  }
  return out;
}

function nodeExtensionFromSpec(name: string, spec: NodeSpec): Node {
  return Node.create({
    name,
    topNode: name === 'doc',
    content: spec.content,
    group: spec.group,
    inline: spec.inline,
    atom: spec.atom,
    marks: spec.marks,
    code: spec.code,
    addAttributes() {
      return attrsConfig(spec.attrs);
    },
    ...(spec.parseDOM
      ? {
          parseHTML(): unknown {
            return spec.parseDOM;
          },
        }
      : {}),
    ...(spec.toDOM
      ? {
          renderHTML({ node }: { node: import('prosemirror-model').Node }): unknown {
            return spec.toDOM!(node);
          },
        }
      : {}),
  } as Parameters<typeof Node.create>[0]);
}

function markExtensionFromSpec(name: string, spec: MarkSpec): Mark {
  return Mark.create({
    name,
    inclusive: spec.inclusive,
    excludes: spec.excludes,
    group: spec.group,
    addAttributes() {
      return attrsConfig(spec.attrs);
    },
    ...(spec.parseDOM
      ? {
          parseHTML(): unknown {
            return spec.parseDOM;
          },
        }
      : {}),
    ...(spec.toDOM
      ? {
          renderHTML({ mark }: { mark: import('prosemirror-model').Mark }): unknown {
            return spec.toDOM!(mark, false);
          },
        }
      : {}),
  } as Parameters<typeof Mark.create>[0]);
}

/** Every node/mark of src/schema.ts, converted to a Tiptap 3 extension. */
export function buildTiptapExtensions(): (Node | Mark)[] {
  const exts: (Node | Mark)[] = [];
  pmSchema.spec.nodes.forEach((name: string, spec: NodeSpec) => exts.push(nodeExtensionFromSpec(name, spec)));
  pmSchema.spec.marks.forEach((name: string, spec: MarkSpec) => exts.push(markExtensionFromSpec(name, spec)));
  return exts;
}

/** The Tiptap-generated ProseMirror Schema, for gate D's equivalence check and for building live Tiptap editors. */
export function buildTiptapSchema(): Schema {
  return getSchema(buildTiptapExtensions());
}

function attrDefaults(attrs: NodeSpec['attrs'] | MarkSpec['attrs']): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(attrs ?? {})) out[key] = (spec as { default?: unknown }).default;
  return out;
}

/** Same equivalence check as stack 13's, comparing semantically-load-bearing NodeSpec/MarkSpec fields. */
export function checkSchemaEquivalence(a: Schema, b: Schema): { equal: boolean; diffs: string[] } {
  const diffs: string[] = [];
  const namesA = new Set<string>();
  a.spec.nodes.forEach((n: string) => namesA.add(n));
  const namesB = new Set<string>();
  b.spec.nodes.forEach((n: string) => namesB.add(n));
  for (const n of namesA) if (!namesB.has(n)) diffs.push(`node ${n}: missing from b`);
  for (const n of namesB) if (!namesA.has(n)) diffs.push(`node ${n}: missing from a`);

  a.spec.nodes.forEach((name: string, specA: NodeSpec) => {
    const specB = b.spec.nodes.get(name) as NodeSpec | undefined;
    if (!specB) return;
    const fields: (keyof NodeSpec)[] = ['content', 'group', 'inline', 'atom', 'marks', 'code'];
    for (const f of fields) {
      if (JSON.stringify(specA[f] ?? null) !== JSON.stringify(specB[f] ?? null)) {
        diffs.push(`node ${name}.${f}: ${JSON.stringify(specA[f])} != ${JSON.stringify(specB[f])}`);
      }
    }
    const da = attrDefaults(specA.attrs);
    const db = attrDefaults(specB.attrs);
    if (JSON.stringify(da) !== JSON.stringify(db)) {
      diffs.push(`node ${name}.attrs: ${JSON.stringify(da)} != ${JSON.stringify(db)}`);
    }
  });

  a.spec.marks.forEach((name: string, specA: MarkSpec) => {
    const specB = b.spec.marks.get(name) as MarkSpec | undefined;
    if (!specB) {
      diffs.push(`mark ${name}: missing from b`);
      return;
    }
    const fields: (keyof MarkSpec)[] = ['group', 'excludes'];
    for (const f of fields) {
      if (JSON.stringify(specA[f] ?? null) !== JSON.stringify(specB[f] ?? null)) {
        diffs.push(`mark ${name}.${f}: ${JSON.stringify(specA[f])} != ${JSON.stringify(specB[f])}`);
      }
    }
    const incA = specA.inclusive ?? true;
    const incB = specB.inclusive ?? true;
    if (incA !== incB) diffs.push(`mark ${name}.inclusive: ${incA} != ${incB}`);
    const da = attrDefaults(specA.attrs);
    const db = attrDefaults(specB.attrs);
    if (JSON.stringify(da) !== JSON.stringify(db)) {
      diffs.push(`mark ${name}.attrs: ${JSON.stringify(da)} != ${JSON.stringify(db)}`);
    }
  });

  return { equal: diffs.length === 0, diffs };
}
