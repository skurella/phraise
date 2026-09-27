// F-violation (brief 03, section 1, checks): "a textblock element visible at
// the latest base snapshot and not touched by any human ... is missing or
// differs from its base-snapshot content, compared as PM node JSON so marks
// count." Existing gate F only compares plain text (see gate-f.ts); this
// reconstructs an actual PM node from a block's Y content at a given
// snapshot, using the same delta-attributes-as-mark-name encoding
// `diff.ts`'s `attrsForMarks`/`reformatToMatch` already document and rely
// on (verified empirically: `y-prosemirror`'s `toDelta()` attaches mark
// attrs under the plain mark name, e.g. `{ strong: {} }`, `{ link: {href,
// title} }` — no schema in this project has an "excludes" declaration that
// would trigger y-prosemirror's `--hash`-suffixed overlapping-mark keys).
import * as Y from "yjs";
import { Fragment, type Mark, type Node as PMNode } from "prosemirror-model";
import { schema } from "../schema.js";
import { getXmlText, isVisibleAt, type BlockRef } from "../integrate.js";

function marksFromDeltaAttrs(attrs: Record<string, any> | undefined): Mark[] {
  if (!attrs) return [];
  const marks: Mark[] = [];
  for (const name in attrs) {
    const markType = (schema.marks as Record<string, any>)[name];
    if (!markType) continue; // unknown mark name: ignore rather than throw
    const val = attrs[name];
    marks.push(markType.create(val && typeof val === "object" ? val : undefined));
  }
  return marks;
}

/** Reconstruct the block's content as a PM node at `snapshot` (current doc
 * state if omitted), or null if not visible there. Textblocks only
 * (paragraph/heading/code_block — the only element types `collectBlocks`
 * returns). */
export function blockPMNodeAt(block: BlockRef, snapshot: Y.Snapshot | undefined): PMNode | null {
  if (!isVisibleAt(block.item, snapshot)) return null;
  const nodeName = block.element.nodeName;
  const nodeType = (schema.nodes as Record<string, any>)[nodeName];
  if (!nodeType) return null;
  const attrs = block.element.getAttributes();
  const xmlText = getXmlText(block.element);
  const delta = xmlText ? (xmlText.toDelta(snapshot) as any[]) : [];
  const children = delta
    .filter((d) => typeof d.insert === "string" && d.insert.length > 0)
    .map((d) => schema.text(d.insert, marksFromDeltaAttrs(d.attributes)));
  const content = children.length > 0 ? Fragment.fromArray(children) : Fragment.empty;
  return nodeType.create(attrs, content);
}

/** Deep-equal PM node comparison (JSON, so marks count). */
export function pmNodesEqual(a: PMNode | null, b: PMNode | null): boolean {
  if (a === null || b === null) return a === b;
  return a.eq(b);
}
