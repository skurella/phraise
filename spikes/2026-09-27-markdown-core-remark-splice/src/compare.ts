// Semantic equality of PM nodes: same type, same semantic attrs/marks/text,
// children pairwise equal. Meta attrs (src, gap, *Hint) are ignored.
import { Node as PMNode, Mark } from 'prosemirror-model';
import { isMetaAttrName } from './schema.js';

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ak = Object.keys(a as object);
    const bk = Object.keys(b as object);
    if (ak.length !== bk.length) return false;
    return ak.every((k) => deepEqual((a as any)[k], (b as any)[k]));
  }
  return false;
}

function semanticAttrsEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (isMetaAttrName(k)) continue;
    if (!deepEqual(a[k], b[k])) return false;
  }
  return true;
}

function markSemanticEq(a: Mark, b: Mark): boolean {
  return a.type === b.type && semanticAttrsEqual(a.attrs, b.attrs);
}

function marksEqual(a: readonly Mark[], b: readonly Mark[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!markSemanticEq(a[i], b[i])) return false;
  }
  return true;
}

export function semanticEq(a: PMNode, b: PMNode): boolean {
  if (a === b) return true;
  if (a.type !== b.type) return false;
  if (a.isText) {
    if (a.text !== b.text) return false;
  }
  if (!semanticAttrsEqual(a.attrs, b.attrs)) return false;
  if (!marksEqual(a.marks, b.marks)) return false;
  if (a.childCount !== b.childCount) return false;
  for (let i = 0; i < a.childCount; i++) {
    if (!semanticEq(a.child(i), b.child(i))) return false;
  }
  return true;
}

/** Return a copy of `node` with every meta attr reset to its schema default. */
export function stripMeta(node: PMNode): PMNode {
  const attrs: Record<string, unknown> = {};
  for (const k of Object.keys(node.attrs)) {
    attrs[k] = isMetaAttrName(k) ? node.type.spec.attrs?.[k]?.default ?? null : node.attrs[k];
  }
  const marks = node.marks.map((m) => {
    const mattrs: Record<string, unknown> = {};
    for (const k of Object.keys(m.attrs)) {
      mattrs[k] = isMetaAttrName(k) ? m.type.spec.attrs?.[k]?.default ?? null : m.attrs[k];
    }
    return m.type.create(mattrs);
  });
  if (node.isText) {
    return node.type.schema.text(node.text ?? '', marks) as unknown as PMNode;
  }
  const children: PMNode[] = [];
  node.forEach((child) => children.push(stripMeta(child)));
  return node.type.create(attrs, children, marks);
}
