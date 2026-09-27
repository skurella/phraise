// Two-way tree diff, pmA -> pmB, applied in place to a Y fragment (plan
// section 3). All ops are deterministic for identical input: same inputs
// produce the same sequence of Yjs mutations (and hence, given a
// deterministic peer, byte-identical updates on any replica).
import * as Y from "yjs";
import { updateYFragment } from "@tiptap/y-tiptap";
import type { Node as PMNode, Mark } from "prosemirror-model";
import * as Diff from "diff";

export type Granularity = "word" | "char" | "block" | "yprosemirror";

const TEXTBLOCK_NAMES = new Set(["paragraph", "heading", "code_block"]);

function isTextblockName(name: string): boolean {
  return TEXTBLOCK_NAMES.has(name);
}

function nodeChildren(node: PMNode): PMNode[] {
  const out: PMNode[] = [];
  node.forEach((child) => out.push(child));
  return out;
}

// Mirrors y-prosemirror's `marksToAttributes` for our schema: every mark type
// here (em, strong, code, link) excludes its own type by default (none of
// them declare a custom `excludes`), so none is "overlapping" and the plain
// mark name is always the attribute key (no `--hash` suffix). Exercised by
// the mark-add/remove and link-attribute-change cases in test/rebase.spec.ts
// (via test/fixtures-ab.ts), which compare the diffed result against
// y-prosemirror's own encoding through `docToPM`.
function attrsForMarks(marks: readonly Mark[]): Record<string, any> {
  const attrs: Record<string, any> = {};
  for (const m of marks) {
    attrs[m.type.name] = m.attrs;
  }
  return attrs;
}

interface TextRun {
  insert: string;
  attributes: Record<string, any>;
}

// Y.XmlText's own `toString()`/`toJSON()` serialize to an XML-ish string with
// mark tags (e.g. `<link href="...">the docs</link>`), not plain text — using
// it for a plain-text diff would treat tag markup as real characters. Plain
// text is the concatenation of the delta's insert strings.
function plainText(yText: Y.XmlText): string {
  return yText
    .toDelta()
    .map((d: any) => d.insert)
    .join("");
}

function textRuns(node: PMNode): TextRun[] {
  return nodeChildren(node).map((n) => ({
    insert: n.text as string,
    attributes: attrsForMarks(n.marks),
  }));
}

// --- structural equality (step 1: exact-match LCS) ---------------------

function structuralHash(node: PMNode): string {
  return JSON.stringify(node.toJSON());
}

function lcsMatches(a: string[], b: string[]): Array<[number, number]> {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array(m + 1).fill(0)
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        a[i] === b[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
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

// --- fuzzy pairing within an unmatched run (step 2) ---------------------

function wordBag(text: string): Map<string, number> {
  const bag = new Map<string, number>();
  for (const w of text.split(/\s+/).filter(Boolean)) {
    bag.set(w, (bag.get(w) ?? 0) + 1);
  }
  return bag;
}

// Word-level Dice coefficient.
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

  const dp: number[][] = Array.from({ length: aLen + 1 }, () =>
    new Array(bLen + 1).fill(0)
  );
  for (let i = aLen - 1; i >= 0; i--) {
    for (let j = bLen - 1; j >= 0; j--) {
      dp[i][j] = canPair(i, j)
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
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
  ops.push(
    ...planGapOps(
      aChildren,
      bChildren,
      prevA,
      aChildren.length,
      prevB,
      bChildren.length
    )
  );
  return ops;
}

// --- building brand-new Y subtrees for inserts ---------------------------

function buildYText(runs: TextRun[]): Y.XmlText {
  const yText = new Y.XmlText();
  if (runs.length > 0) {
    yText.applyDelta(
      runs.map((r) => ({ insert: r.insert, attributes: r.attributes }))
    );
  }
  return yText;
}

function buildYNode(node: PMNode): Y.XmlElement {
  const el = new Y.XmlElement(node.type.name);
  for (const key in node.attrs) {
    const val = (node.attrs as any)[key];
    if (val !== null && val !== undefined) {
      el.setAttribute(key, val);
    }
  }
  if (isTextblockName(node.type.name)) {
    const runs = textRuns(node);
    if (runs.length > 0) {
      el.insert(0, [buildYText(runs)]);
    }
  } else {
    const children = nodeChildren(node).map(buildYNode);
    if (children.length > 0) {
      el.insert(0, children);
    }
  }
  return el;
}

// --- text-level diff at the configured granularity (step 3, textblocks) --

// Re-formats the whole of `yText` (which must already contain exactly the
// concatenation of `bRuns`' text) to carry exactly `bRuns`' attributes. Uses
// a single `applyDelta` call with `retain` ops rather than piecemeal
// `format()` calls: `applyDelta` threads one cursor through all ops in
// sequence, which is the same mechanism y-prosemirror's own `updateYText`
// relies on, and avoids boundary ambiguity between independent `format()`
// calls when adjacent runs both carry (different) values for the same mark.
function reformatToMatch(yText: Y.XmlText, bRuns: TextRun[]): void {
  if (bRuns.length === 0) return;
  const allKeys = new Set<string>();
  for (const r of bRuns) {
    for (const k in r.attributes) allKeys.add(k);
  }
  for (const d of yText.toDelta()) {
    if (d.attributes) {
      for (const k in d.attributes) allKeys.add(k);
    }
  }
  const retainOps = bRuns.map((run) => {
    const attrs: Record<string, any> = {};
    for (const k of allKeys) {
      attrs[k] = k in run.attributes ? run.attributes[k] : null;
    }
    return { retain: run.insert.length, attributes: attrs };
  });
  yText.applyDelta(retainOps);
}

function applyCharOrWordDiff(
  yText: Y.XmlText,
  bText: string,
  granularity: "char" | "word"
): void {
  const aText = plainText(yText);
  if (aText === bText) return;
  const parts =
    granularity === "char"
      ? Diff.diffChars(aText, bText)
      : Diff.diffWordsWithSpace(aText, bText);
  let cursor = 0;
  for (const part of parts) {
    if (part.removed) {
      yText.delete(cursor, part.value.length);
    } else if (part.added) {
      yText.insert(cursor, part.value);
      cursor += part.value.length;
    } else {
      cursor += part.value.length;
    }
  }
}

function updateTextblockContent(
  yNode: Y.XmlElement,
  bNode: PMNode,
  granularity: Granularity
): void {
  const bRuns = textRuns(bNode);
  const bText = bRuns.map((r) => r.insert).join("");
  const existing = yNode.toArray();
  let yText: Y.XmlText;
  if (existing.length === 0) {
    yText = new Y.XmlText();
    yNode.insert(0, [yText]);
  } else {
    yText = existing[0] as Y.XmlText;
  }

  if (granularity === "block") {
    if (yText.length > 0) yText.delete(0, yText.length);
    if (bText.length > 0) yText.insert(0, bText);
  } else {
    // "yprosemirror" never reaches here (handled at the top level).
    applyCharOrWordDiff(yText, bText, granularity as "char" | "word");
  }
  reformatToMatch(yText, bRuns);
}

function updateAttrs(yNode: Y.XmlElement, bNode: PMNode): void {
  const yAttrs = yNode.getAttributes();
  for (const key in bNode.attrs) {
    const val = (bNode.attrs as any)[key];
    if (val !== null && val !== undefined) {
      if (yAttrs[key] !== val) yNode.setAttribute(key, val);
    } else if (key in yAttrs) {
      yNode.removeAttribute(key);
    }
  }
  for (const key in yAttrs) {
    if (!(key in bNode.attrs)) {
      yNode.removeAttribute(key);
    }
  }
}

function updatePairedNode(
  yNode: Y.XmlElement,
  aNode: PMNode,
  bNode: PMNode,
  granularity: Granularity
): void {
  updateAttrs(yNode, bNode);
  if (isTextblockName(bNode.type.name)) {
    updateTextblockContent(yNode, bNode, granularity);
  } else {
    const aChildren = nodeChildren(aNode);
    const bChildren = nodeChildren(bNode);
    const ops = planChildOps(aChildren, bChildren);
    applyChildOps(yNode, ops, aChildren, bChildren, granularity);
  }
}

function applyChildOps(
  yParent: Y.XmlFragment | Y.XmlElement,
  ops: Op[],
  aChildren: PMNode[],
  bChildren: PMNode[],
  granularity: Granularity
): void {
  let cursor = 0;
  for (const op of ops) {
    switch (op.kind) {
      case "skip":
        cursor++;
        break;
      case "update": {
        const yChild = yParent.toArray()[cursor] as Y.XmlElement;
        updatePairedNode(
          yChild,
          aChildren[op.aIdx],
          bChildren[op.bIdx],
          granularity
        );
        cursor++;
        break;
      }
      case "delete":
        yParent.delete(cursor, 1);
        break;
      case "insert": {
        const yNode = buildYNode(bChildren[op.bIdx]);
        yParent.insert(cursor, [yNode]);
        cursor++;
        break;
      }
    }
  }
}

/**
 * Diff pmA -> pmB and mutate `fragment` (the fork's root Y.XmlFragment) in
 * place so that afterwards its content equals pmB exactly. `pmA` must be the
 * PM-equivalent of fragment's current content (the caller derives it with
 * `docToPM`, so the diff always starts from the CRDT's actual state, not a
 * possibly-stale copy).
 */
export function applyTreeDiff(
  fragment: Y.XmlFragment,
  pmA: PMNode,
  pmB: PMNode,
  granularity: Granularity
): void {
  if (granularity === "yprosemirror") {
    const y = fragment.doc;
    if (!y) throw new Error("fragment must be attached to a Y.Doc");
    updateYFragment(y, fragment, pmB, {
      mapping: new Map(),
      isOMark: new Map(),
    } as any);
    return;
  }
  const aChildren = nodeChildren(pmA);
  const bChildren = nodeChildren(pmB);
  const ops = planChildOps(aChildren, bChildren);
  applyChildOps(fragment, ops, aChildren, bChildren, granularity);
}
