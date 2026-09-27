// Two-way tree diff, pmA -> pmB, applied in place to a Loro tree (plan
// section 3; brief 4 item 2 asks for "word granularity, marks via
// LoroText.mark/unmark"). The tree-alignment half (structural hash, exact
// LCS, fuzzy word-Dice LCS inside each unmatched run) is pure ProseMirror
// logic with no CRDT dependency, so it is copied verbatim from
// spikes/2026-09-27-crdt-rebase-yjs-fork/src/diff.ts's `structuralHash`,
// `lcsMatches`, `wordBag`, `diceSimilarity`, `planGapOps`, `planChildOps`
// (the `Op` union too). Only the "apply to the CRDT" half is rewritten for
// Loro's LoroMap/LoroList/LoroText instead of Y.XmlElement/Y.XmlText.
//
// A "yprosemirror"-equivalent comparison granularity is included
// (`"loroprosemirror"`): it delegates entirely to loro-prosemirror's own
// public `updateLoroToPmState`, which ships a full two-way tree-diff-and-
// patch of its own (see node_modules/loro-prosemirror/src/lib.ts --
// `updateLoroMapChildren`/`updateLoroText`, an LCS-from-both-ends alignment
// plus a `simpleDiff`-based char-level text patch). That we can compare
// against it without writing a byte of glue code is itself a finding: for a
// production system, loro-prosemirror's own diff-and-patch may already cover
// most of what plan section 3 asks us to hand-roll for Yjs.
import { LoroDoc, LoroMap, LoroText } from "loro-crdt";
import { updateLoroToPmState } from "loro-prosemirror";
import type { Node as PMNode } from "prosemirror-model";
import type { LoroChildrenListType, LoroNode } from "loro-prosemirror";
import * as Diff from "diff";
import {
  ROOT_DOC_KEY,
  getAttrs,
  getChildren,
  isTextblockName,
  plainText,
  textRuns,
  buildLoroNode,
  type TextRun,
} from "./loro-doc.js";
import { schema } from "./schema.js";

export type Granularity = "word" | "loroprosemirror";

function nodeChildren(node: PMNode): PMNode[] {
  const out: PMNode[] = [];
  node.forEach((child) => out.push(child));
  return out;
}

// --- structural equality (step 1: exact-match LCS) — copied from the Yjs
// fork's diff.ts verbatim; pure PMNode logic, no CRDT dependency. ----------

function structuralHash(node: PMNode): string {
  return JSON.stringify(node.toJSON());
}

function lcsMatches(a: string[], b: string[]): Array<[number, number]> {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return pairs;
}

// --- fuzzy pairing within an unmatched run (step 2) — copied verbatim. ----

function wordBag(text: string): Map<string, number> {
  const bag = new Map<string, number>();
  for (const w of text.split(/\s+/).filter(Boolean)) {
    bag.set(w, (bag.get(w) ?? 0) + 1);
  }
  return bag;
}

function diceSimilarity(aText: string, bText: string): number {
  const aWords = aText.split(/\s+/).filter(Boolean);
  const bWords = bText.split(/\s+/).filter(Boolean);
  if (aWords.length === 0 && bWords.length === 0) return 1;
  if (aWords.length === 0 || bWords.length === 0) return 0;
  const bag = wordBag(aText);
  let common = 0;
  for (const w of bWords) {
    const c = bag.get(w) ?? 0;
    if (c > 0) {
      common++;
      bag.set(w, c - 1);
    }
  }
  return (2 * common) / (aWords.length + bWords.length);
}

type Op =
  | { kind: "skip"; aIdx: number; bIdx: number }
  | { kind: "update"; aIdx: number; bIdx: number }
  | { kind: "delete"; aIdx: number }
  | { kind: "insert"; bIdx: number };

function planGapOps(
  aChildren: PMNode[],
  bChildren: PMNode[],
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number
): Op[] {
  const aLen = aEnd - aStart;
  const bLen = bEnd - bStart;
  if (aLen === 0 && bLen === 0) return [];

  const canPair = (i: number, j: number): boolean => {
    const an = aChildren[aStart + i];
    const bn = bChildren[bStart + j];
    if (an.type.name !== bn.type.name) return false;
    return diceSimilarity(an.textContent, bn.textContent) >= 0.5;
  };

  const dp: number[][] = Array.from({ length: aLen + 1 }, () => new Array(bLen + 1).fill(0));
  for (let i = aLen - 1; i >= 0; i--) {
    for (let j = bLen - 1; j >= 0; j--) {
      dp[i][j] = canPair(i, j) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < aLen && j < bLen) {
    if (canPair(i, j)) {
      ops.push({ kind: "update", aIdx: aStart + i, bIdx: bStart + j });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ kind: "delete", aIdx: aStart + i });
      i++;
    } else {
      ops.push({ kind: "insert", bIdx: bStart + j });
      j++;
    }
  }
  while (i < aLen) {
    ops.push({ kind: "delete", aIdx: aStart + i });
    i++;
  }
  while (j < bLen) {
    ops.push({ kind: "insert", bIdx: bStart + j });
    j++;
  }
  return ops;
}

function planChildOps(aChildren: PMNode[], bChildren: PMNode[]): Op[] {
  const aHashes = aChildren.map(structuralHash);
  const bHashes = bChildren.map(structuralHash);
  const matches = lcsMatches(aHashes, bHashes);

  const ops: Op[] = [];
  let prevA = 0;
  let prevB = 0;
  for (const [ma, mb] of matches) {
    ops.push(...planGapOps(aChildren, bChildren, prevA, ma, prevB, mb));
    ops.push({ kind: "skip", aIdx: ma, bIdx: mb });
    prevA = ma + 1;
    prevB = mb + 1;
  }
  ops.push(...planGapOps(aChildren, bChildren, prevA, aChildren.length, prevB, bChildren.length));
  return ops;
}

// --- applying the plan to the Loro tree (Loro-specific half) -------------

/**
 * Reformat the whole of `text` (already containing exactly the concatenation
 * of `bRuns`' text) to carry exactly `bRuns`' marks. Unlike the Yjs fork's
 * single `applyDelta` retain-pass, LoroText.mark/unmark (the API the brief
 * asks us to exercise) work over character ranges rather than a delta
 * sequence, so the equivalent "blunt but simple" approach is: clear every
 * schema mark over the whole range, then reapply each run's marks over its
 * own range. Requires `doc.configTextStyle` to have been called first for
 * every mark name used here -- a real, undocumented-in-the-.d.ts requirement
 * found while building this (see README).
 */
function reformatToMatch(text: LoroText, bRuns: TextRun[]): void {
  const len = text.length as unknown as number; // .length is a getter at runtime despite the .d.ts listing it as length(): number -- see README "bugs found".
  if (len === 0) return;
  for (const markName of Object.keys(schema.marks)) {
    text.unmark({ start: 0, end: len }, markName);
  }
  let cursor = 0;
  for (const run of bRuns) {
    const end = cursor + run.insert.length;
    for (const [key, value] of Object.entries(run.attributes)) {
      if (value !== null && value !== undefined && end > cursor) {
        text.mark({ start: cursor, end }, key, value);
      }
    }
    cursor = end;
  }
}

function applyWordDiff(text: LoroText, bText: string): void {
  const aText = plainText(text);
  if (aText === bText) return;
  const parts = Diff.diffWordsWithSpace(aText, bText);
  let cursor = 0;
  for (const part of parts) {
    if (part.removed) {
      text.delete(cursor, part.value.length);
    } else if (part.added) {
      text.insert(cursor, part.value);
      cursor += part.value.length;
    } else {
      cursor += part.value.length;
    }
  }
}

function updateTextblockContent(loroNode: LoroNode, bNode: PMNode): void {
  const bRuns = textRuns(bNode);
  const bText = bRuns.map((r) => r.insert).join("");
  const children = getChildren(loroNode);
  const existing = children.toArray();
  let text: LoroText;
  if (existing.length === 0 || !(existing[0] instanceof LoroText)) {
    text = children.insertContainer(0, new LoroText());
  } else {
    text = existing[0] as LoroText;
  }
  applyWordDiff(text, bText);
  reformatToMatch(text, bRuns);
}

function updateAttrs(loroNode: LoroNode, bNode: PMNode): void {
  const attrs = getAttrs(loroNode);
  const existingKeys = new Set(attrs.keys() as string[]);
  for (const [key, value] of Object.entries(bNode.attrs)) {
    if (value !== null && value !== undefined) {
      if (attrs.get(key) !== value) attrs.set(key, value);
    } else if (existingKeys.has(key)) {
      attrs.delete(key);
    }
    existingKeys.delete(key);
  }
  for (const key of existingKeys) attrs.delete(key);
}

function updatePairedNode(loroNode: LoroNode, aNode: PMNode, bNode: PMNode): void {
  updateAttrs(loroNode, bNode);
  if (isTextblockName(bNode.type.name)) {
    updateTextblockContent(loroNode, bNode);
  } else {
    const aChildren = nodeChildren(aNode);
    const bChildren = nodeChildren(bNode);
    const ops = planChildOps(aChildren, bChildren);
    applyChildOps(getChildren(loroNode), ops, aChildren, bChildren);
  }
}

function applyChildOps(
  parent: LoroChildrenListType,
  ops: Op[],
  aChildren: PMNode[],
  bChildren: PMNode[]
): void {
  let cursor = 0;
  for (const op of ops) {
    switch (op.kind) {
      case "skip":
        cursor++;
        break;
      case "update": {
        const child = parent.get(cursor) as LoroNode;
        updatePairedNode(child, aChildren[op.aIdx], bChildren[op.bIdx]);
        cursor++;
        break;
      }
      case "delete":
        parent.delete(cursor, 1);
        break;
      case "insert":
        buildLoroNode(parent, cursor, bChildren[op.bIdx]);
        cursor++;
        break;
    }
  }
}

/**
 * Diff pmA -> pmB and mutate the fork's root ("doc") LoroMap in place so
 * that afterwards its content equals pmB exactly. `pmA` must be the
 * PM-equivalent of the root's current content (the caller derives it with
 * `docToPM`).
 */
export function applyTreeDiff(
  doc: LoroDoc,
  pmA: PMNode,
  pmB: PMNode,
  granularity: Granularity
): void {
  if (granularity === "loroprosemirror") {
    const mapping = new Map();
    updateLoroToPmState(doc as any, mapping, { doc: pmB } as any);
    return;
  }
  const root = doc.getMap(ROOT_DOC_KEY) as unknown as LoroNode;
  const aChildren = nodeChildren(pmA);
  const bChildren = nodeChildren(pmB);
  const ops = planChildOps(aChildren, bChildren);
  applyChildOps(getChildren(root), ops, aChildren, bChildren);
}
