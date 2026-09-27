// Origin: spike 3 (daemon-file-sync-fork-import) src/md/compare.ts, commit 9343b62, with the
// compare-by-type-name fix (brief 03/gate D) taken from spike 5 (collab-stack-yjs13-hocuspocus),
// branch spike/2026-09-27-collab-stack, commit eeb3fe2, src/compare.ts.
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
  // Compared by name, not by NodeType/MarkType reference (see semanticEq's
  // comment below for why: brief 03/gate D found this the hard way).
  return a.type.name === b.type.name && semanticAttrsEqual(a.attrs, b.attrs);
}

function marksEqual(a: readonly Mark[], b: readonly Mark[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!markSemanticEq(a[i], b[i])) return false;
  }
  return true;
}

export interface SemanticEqOpts {
  /**
   * Brief 04, task 4 (semantic line breaks): treat a soft line break
   * (a lone `\n`, with any adjacent horizontal whitespace) the same as a
   * single space when comparing text. Only ever passed by serialize.ts's own
   * verification of a `semanticLineBreaks`-reformatted paragraph -- normal
   * callers (gates, tests) never set this, so a genuine, user-authored
   * newline is still a real difference everywhere else.
   */
  equateSoftBreaks?: boolean;
}

function normalizeSoftBreaks(text: string): string {
  return text.replace(/[ \t]*\n[ \t]*/g, ' ');
}

export function semanticEq(a: PMNode, b: PMNode, opts?: SemanticEqOpts): boolean {
  if (a === b) return true;
  // Compared by name, not by NodeType reference. Brief 03/gate D: a live
  // Tiptap editor's doc uses Tiptap's OWN Schema instance (built by
  // `getSchema()` from src/tiptapExtensions.ts's converted extensions),
  // structurally equivalent to src/schema.ts's `schema` (checkSchemaEquivalence
  // proves that) but a genuinely different JS object -- so its NodeTypes are
  // never `===` to the canonical schema's, even for identically-named nodes.
  // This bit serializeDoc's own round-trip verification (which re-parses a
  // candidate serialization with the CANONICAL schema and semanticEq's it
  // against the live, possibly-Tiptap-schema node): every single node
  // compared unequal purely by object identity, regardless of real content,
  // reported as "block 0 (heading) has no serialization that re-parses" even
  // on an untouched heading. Confirmed by testing before this fix: it failed
  // from the very first (pre-edit) check, not from anything the edit script
  // did. Comparing by name is strictly more permissive in exactly the cases
  // that used to be false positives (same node definition, different Schema
  // object) and is exactly as strict as before whenever both sides already
  // share one schema instance (every other gate's raw ProseMirror clients).
  if (a.type.name !== b.type.name) return false;
  if (a.isText) {
    const ta = opts?.equateSoftBreaks ? normalizeSoftBreaks(a.text ?? '') : a.text;
    const tb = opts?.equateSoftBreaks ? normalizeSoftBreaks(b.text ?? '') : b.text;
    if (ta !== tb) return false;
  }
  if (!semanticAttrsEqual(a.attrs, b.attrs)) return false;
  if (!marksEqual(a.marks, b.marks)) return false;
  if (a.childCount !== b.childCount) return false;
  for (let i = 0; i < a.childCount; i++) {
    if (!semanticEq(a.child(i), b.child(i), opts)) return false;
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
