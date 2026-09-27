// Shared constants and small helpers for the Loro document layout (brief 4,
// item 1). Document layout follows loro-prosemirror's own encoding exactly
// (read from node_modules/loro-prosemirror/src/lib.ts, which is not minified
// and ships with the package): root LoroMap "doc" (ROOT_DOC_KEY), each PM
// node a LoroMap with `nodeName` (string), `attributes` (LoroMap) and
// `children` (LoroList of LoroMap | LoroText), and every run of PM text
// siblings collapsed into exactly one LoroText child with marks carried as
// per-key attributes on its delta (LoroText.mark/unmark or applyDelta
// attributes) -- the same "one XmlText per textblock" invariant the Yjs fork
// uses. `getLoroMapAttributes`/`getLoroMapChildren`/`createLoroMap`/
// `createLoroText` in lib.ts implement this, but only `ROOT_DOC_KEY`,
// `NODE_NAME_KEY`, `CHILDREN_KEY`, `ATTRIBUTES_KEY`, `createNodeFromLoroObj`
// and `updateLoroToPmState` are exported from the package's public entry
// point (src/index.ts) -- the lower-level per-container builders are not, so
// this file reimplements the small pieces of them our own diff needs
// (`getChildren`/`getAttrs`/`buildLoroNode`), noting the origin here rather
// than importing an internal path.
import { LoroDoc, LoroList, LoroMap, LoroText } from "loro-crdt";
import {
  ROOT_DOC_KEY,
  NODE_NAME_KEY,
  CHILDREN_KEY,
  ATTRIBUTES_KEY,
  type LoroChildrenListType,
  type LoroNode,
} from "loro-prosemirror";
import type { Mark, Node as PMNode } from "prosemirror-model";
import { schema } from "./schema.js";

export { ROOT_DOC_KEY, NODE_NAME_KEY, CHILDREN_KEY, ATTRIBUTES_KEY };
export const PHRAISE_MAP = "phraise";
export const AUTHORS_MAP = "authors";
export const COMMENTS_MAP = "comments";
export const REVIEW_MAP = "review";

export const TEXTBLOCK_NAMES = new Set(["paragraph", "heading", "code_block"]);

/**
 * Configure Loro's per-mark expand behavior for our 4 marks, mirroring
 * loro-prosemirror's own (unexported) `configLoroTextStyle` in
 * src/text-style.ts: inclusive marks (em, strong, code) expand "after" an
 * insert at the boundary; a non-inclusive mark (link, `inclusive: false` in
 * our schema) does not. Real rough edge found while building this (see
 * README "bugs found"): `LoroText.mark()`/`.unmark()` throw
 * "Style configuration missing for ..." until this is called at least once
 * on the doc -- there is no default. `applyDelta` with attributes does not
 * throw the same way (used only by the seed's initial full-tree build).
 */
export function configureTextStyle(doc: LoroDoc): void {
  const style: Record<string, { expand: "before" | "after" | "none" | "both" }> = {};
  for (const [name, markType] of Object.entries(schema.marks)) {
    style[name] = { expand: markType.spec.inclusive !== false ? "after" : "none" };
  }
  doc.configTextStyle(style);
}

export function getChildren(node: LoroNode): LoroChildrenListType {
  return node.getOrCreateContainer(CHILDREN_KEY, new LoroList()) as LoroChildrenListType;
}

export function getAttrs(node: LoroNode): LoroMap {
  return node.getOrCreateContainer(ATTRIBUTES_KEY, new LoroMap());
}

export function nodeName(node: LoroNode): string {
  return node.get(NODE_NAME_KEY) as string;
}

export function isTextblockName(name: string): boolean {
  return TEXTBLOCK_NAMES.has(name);
}

/** Plain text of a LoroText: the concatenation of its delta's insert strings (its .toString() already returns exactly this for LoroText, unlike Yjs's Y.XmlText -- verified, but we go through toDelta() anyway since we need attributes too). */
export function plainText(text: LoroText): string {
  return text
    .toDelta()
    .map((d: any) => d.insert)
    .join("");
}

export interface TextRun {
  insert: string;
  attributes: Record<string, any>;
}

function nodeChildren(node: PMNode): PMNode[] {
  const out: PMNode[] = [];
  node.forEach((child) => out.push(child));
  return out;
}

function attrsForMarks(marks: readonly Mark[]): Record<string, any> {
  const attrs: Record<string, any> = {};
  for (const m of marks) attrs[m.type.name] = m.attrs;
  return attrs;
}

export function textRuns(node: PMNode): TextRun[] {
  return nodeChildren(node).map((n) => ({
    insert: n.text as string,
    attributes: attrsForMarks(n.marks),
  }));
}

/** Build a brand-new LoroMap subtree for `node` and insert it (as a container) into `parent` at `pos`. Mirrors lib.ts's unexported createLoroMap/createLoroText. */
export function buildLoroNode(
  parent: LoroChildrenListType,
  pos: number,
  node: PMNode
): void {
  if (isTextblockName(node.type.name) === false && node.isText) {
    throw new Error("buildLoroNode: text nodes must be grouped into a run by the caller");
  }
  const map = parent.insertContainer(pos, new LoroMap()) as LoroNode;
  map.set(NODE_NAME_KEY, node.type.name);
  const attrs = getAttrs(map);
  for (const [key, value] of Object.entries(node.attrs)) {
    if (value !== null && value !== undefined) attrs.set(key, value);
  }
  const children = getChildren(map);
  if (isTextblockName(node.type.name)) {
    const runs = textRuns(node);
    if (runs.length > 0) {
      const text = children.insertContainer(0, new LoroText());
      text.applyDelta(runs.map((r) => ({ insert: r.insert, attributes: r.attributes })));
    }
  } else {
    const kids = nodeChildren(node);
    kids.forEach((child, i) => buildLoroNode(children, i, child));
  }
}
