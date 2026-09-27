// Generic ProseMirror-tree helpers shared by the fuzz harness's upstream
// mutation generator (mutate.ts): flattening textblocks in document order
// (to correlate with `collectBlocks`' Y-side DFS, see trial.ts), and
// immutable path-based rebuild (replace/delete/insert a child at a path).
import { Fragment, type Mark, type Node as PMNode } from "prosemirror-model";
import { schema } from "../schema.js";

export const TEXTBLOCK_TYPES = new Set(["paragraph", "heading", "code_block"]);

export interface FlatRef {
  path: number[];
  node: PMNode;
}

/**
 * Every textblock (paragraph/heading/code_block) in document order,
 * recursing into any container (blockquote, list_item, bullet_list,
 * ordered_list). Same DFS order as `collectBlocks` in `../integrate.ts`
 * (both are a plain preorder walk over the same document), so the same
 * index into this array and into `collectBlocks(...)` refers to the same
 * logical block, as long as both start from equivalent content — this is
 * how trial.ts correlates Y block ids with PM tree positions.
 */
export function flattenTextblocks(doc: PMNode): FlatRef[] {
  const out: FlatRef[] = [];
  function walk(node: PMNode, path: number[]): void {
    node.forEach((child, _offset, index) => {
      const childPath = [...path, index];
      if (TEXTBLOCK_TYPES.has(child.type.name)) {
        out.push({ path: childPath, node: child });
      } else {
        walk(child, childPath);
      }
    });
  }
  walk(doc, []);
  return out;
}

function childrenOf(node: PMNode): PMNode[] {
  const out: PMNode[] = [];
  node.forEach((child) => out.push(child));
  return out;
}

/** Replace the node at `path` with `newChild`, rebuilding ancestors. */
export function replaceAtPath(doc: PMNode, path: number[], newChild: PMNode): PMNode {
  if (path.length === 0) return newChild;
  const [idx, ...rest] = path;
  const children = childrenOf(doc);
  children[idx] = rest.length === 0 ? newChild : replaceAtPath(children[idx], rest, newChild);
  return doc.copy(Fragment.fromArray(children));
}

/** Delete the node at `path` (path must be non-empty). */
export function deleteAtPath(doc: PMNode, path: number[]): PMNode {
  const [idx, ...rest] = path;
  const children = childrenOf(doc);
  if (rest.length === 0) {
    children.splice(idx, 1);
  } else {
    children[idx] = deleteAtPath(children[idx], rest);
  }
  return doc.copy(Fragment.fromArray(children));
}

/** Insert `newChild` at `index` among the children of the node at `parentPath` (empty path = doc's own top-level children). */
export function insertAtPath(
  doc: PMNode,
  parentPath: number[],
  index: number,
  newChild: PMNode
): PMNode {
  if (parentPath.length === 0) {
    const children = childrenOf(doc);
    children.splice(index, 0, newChild);
    return doc.copy(Fragment.fromArray(children));
  }
  const [idx, ...rest] = parentPath;
  const children = childrenOf(doc);
  children[idx] = insertAtPath(children[idx], rest, index, newChild);
  return doc.copy(Fragment.fromArray(children));
}

export interface TextRun {
  text: string;
  marks: readonly Mark[];
}

export function textRunsOf(node: PMNode): TextRun[] {
  const out: TextRun[] = [];
  node.forEach((child) => out.push({ text: child.text ?? "", marks: child.marks }));
  return out;
}

export function plainTextOf(node: PMNode): string {
  return textRunsOf(node)
    .map((r) => r.text)
    .join("");
}

/** Rebuild a textblock's content from `runs` (dropping empty ones). */
export function nodeWithRuns(node: PMNode, runs: TextRun[]): PMNode {
  const children = runs
    .filter((r) => r.text.length > 0)
    .map((r) => schema.text(r.text, r.marks as Mark[]));
  return node.copy(Fragment.fromArray(children));
}
