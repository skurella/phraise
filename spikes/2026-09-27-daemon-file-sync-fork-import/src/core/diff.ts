// Two-way tree diff, pmA -> pmB, applied in place to a Y fragment (plan
// section 3.4). All ops are deterministic for identical input.
//
// Copied from spike 2's `src/diff.ts` at commit 88bd85c
// (spikes/2026-09-27-crdt-rebase-yjs-fork/src/diff.ts, branch
// spike/2026-09-26-crdt-rebase-yjs-fork) and extended for spike 1's schema
// (src/md/schema.ts):
//   - the top-level exact-match step now keys on `stripMeta(child).toJSON()`
//     (semantic equality) instead of the raw `toJSON()` spike 2 used, because
//     this schema has meta attrs (`src`, `gap`, `*Hint`, `leafMarks`) that
//     spike 2's schema never had. A "matched" pair can therefore still
//     differ in meta attrs (typically `src`/`gap` after a whitespace- or
//     syntax-only change), so instead of a true no-op it gets a recursive
//     attr-only sync (`syncMatchedPair`), counted as `attrOnly`.
//   - `TEXTBLOCK_NAMES` gains `table_cell` and `raw_block`.
//   - attribute comparison (`updateAttrs`) is by value (JSON-stable) rather
//     than `!==`, to handle array-valued attrs such as `table.align`.
//   - the textblock diff (`updateTextblockContent`) is inline-leaf aware:
//     it classifies a textblock's children into alternating text-groups and
//     inline leaves (image, hard_break, raw_inline), mirroring y-prosemirror's
//     own grouping (`normalizePNodeContent`), and only takes the word-level
//     diff fast path when the leaf-type sequence matches on both sides and
//     the Y side has no two adjacent `Y.XmlText` children; otherwise it
//     falls back to `updateYFragment` for that one textblock and counts
//     `coarseTextblocks`. Spike 2 had no inline leaves and no such fallback
//     at sub-document granularity (only "yprosemirror" for the whole doc).
//   - `buildYNode` builds inline leaves as nested `Y.XmlElement`s inside a
//     freshly-built textblock, not just plain text runs.
//   - Spike 2's `Granularity` parameter is gone: the word-level diff is the
//     only textblock strategy here: it is uniformly what plan 3.4 specifies
//     (with the coarse `updateYFragment` fallback), the corpus/gate variance
//     spike 2 measured for other granularities doesn't apply to this schema.
import * as Y from 'yjs';
import { updateYFragment } from 'y-prosemirror';
import type { Node as PMNode, Mark } from 'prosemirror-model';
import * as Diff from 'diff';
import { stripMeta } from '../md/compare.js';

const TEXTBLOCK_NAMES = new Set(['paragraph', 'heading', 'code_block', 'table_cell', 'raw_block']);

function isTextblockName(name: string): boolean {
  return TEXTBLOCK_NAMES.has(name);
}

export interface DiffCounters {
  /** Textblocks whose Y/B shape did not admit the word-level diff and fell back to `updateYFragment`. */
  coarseTextblocks: number;
  /** Paired-but-not-equal nodes (textblock word-diffed, or container recursed into). */
  pairedUpdates: number;
  /** Whole new Y subtrees built for a B-only child. */
  inserts: number;
  /** Y children removed because they have no counterpart in B. */
  deletes: number;
  /** Nodes (matched or paired) where only attributes needed syncing. */
  attrOnly: number;
}

function newCounters(): DiffCounters {
  return { coarseTextblocks: 0, pairedUpdates: 0, inserts: 0, deletes: 0, attrOnly: 0 };
}

function nodeChildren(node: PMNode): PMNode[] {
  const out: PMNode[] = [];
  node.forEach((child) => out.push(child));
  return out;
}

// Mirrors y-prosemirror's `marksToAttributes` for our schema: every mark
// type here (em, strong, strike, code, link) excludes its own type by
// default, so none is "overlapping" and the plain mark name is always the
// attribute key (no `--hash` suffix).
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
// mark tags, not plain text. Plain text is the concatenation of the delta's
// insert strings.
function plainText(yText: Y.XmlText): string {
  return yText
    .toDelta()
    .map((d: any) => d.insert)
    .join('');
}

// --- semantic equality (step 1: exact-match LCS) --------------------------

// Meta attrs (src/gap/*Hint/leafMarks) are ignored here: two nodes that
// differ only in those are still a "matched pair" (step 2), not an
// unmatched run.
function semanticHash(node: PMNode): string {
  return JSON.stringify(stripMeta(node).toJSON());
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

// --- fuzzy pairing within an unmatched run (step 3) -----------------------

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
  | { kind: 'skip'; aIdx: number; bIdx: number }
  | { kind: 'update'; aIdx: number; bIdx: number }
  | { kind: 'delete'; aIdx: number }
  | { kind: 'insert'; bIdx: number };

function planGapOps(
  aChildren: PMNode[],
  bChildren: PMNode[],
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
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
      ops.push({ kind: 'update', aIdx: aStart + i, bIdx: bStart + j });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ kind: 'delete', aIdx: aStart + i });
      i++;
    } else {
      ops.push({ kind: 'insert', bIdx: bStart + j });
      j++;
    }
  }
  while (i < aLen) {
    ops.push({ kind: 'delete', aIdx: aStart + i });
    i++;
  }
  while (j < bLen) {
    ops.push({ kind: 'insert', bIdx: bStart + j });
    j++;
  }
  return ops;
}

function planChildOps(aChildren: PMNode[], bChildren: PMNode[]): Op[] {
  const aHashes = aChildren.map(semanticHash);
  const bHashes = bChildren.map(semanticHash);
  const matches = lcsMatches(aHashes, bHashes);

  const ops: Op[] = [];
  let prevA = 0;
  let prevB = 0;
  for (const [ma, mb] of matches) {
    ops.push(...planGapOps(aChildren, bChildren, prevA, ma, prevB, mb));
    ops.push({ kind: 'skip', aIdx: ma, bIdx: mb });
    prevA = ma + 1;
    prevB = mb + 1;
  }
  ops.push(...planGapOps(aChildren, bChildren, prevA, aChildren.length, prevB, bChildren.length));
  return ops;
}

// --- classifying a textblock's children into text-groups and leaves ------

type ContentGroup = { kind: 'text'; runs: TextRun[] } | { kind: 'leaf'; node: PMNode };

// Mirrors y-prosemirror's own `normalizePNodeContent`: consecutive text
// nodes merge into one group, everything else (image, hard_break,
// raw_inline) is its own entry. There is never an empty text group: PM
// content never contains an empty text node.
function classifyChildren(children: PMNode[]): ContentGroup[] {
  const groups: ContentGroup[] = [];
  let runs: TextRun[] = [];
  for (const child of children) {
    if (child.isText) {
      runs.push({ insert: (child.text as string) ?? '', attributes: attrsForMarks(child.marks) });
    } else {
      if (runs.length > 0) {
        groups.push({ kind: 'text', runs });
        runs = [];
      }
      groups.push({ kind: 'leaf', node: child });
    }
  }
  if (runs.length > 0) groups.push({ kind: 'text', runs });
  return groups;
}

// --- building brand-new Y subtrees for inserts ----------------------------

function buildYText(runs: TextRun[]): Y.XmlText {
  const yText = new Y.XmlText();
  if (runs.length > 0) {
    yText.applyDelta(runs.map((r) => ({ insert: r.insert, attributes: r.attributes })));
  }
  return yText;
}

function buildTextblockChildren(node: PMNode): (Y.XmlText | Y.XmlElement)[] {
  const groups = classifyChildren(nodeChildren(node));
  return groups.map((g) => (g.kind === 'text' ? buildYText(g.runs) : buildYNode(g.node)));
}

function setAllAttrs(el: Y.XmlElement, node: PMNode): void {
  for (const key in node.attrs) {
    const val = (node.attrs as any)[key];
    if (val !== null && val !== undefined) {
      el.setAttribute(key, val);
    }
  }
}

function buildYNode(node: PMNode): Y.XmlElement {
  const el = new Y.XmlElement(node.type.name);
  setAllAttrs(el, node);
  if (isTextblockName(node.type.name)) {
    const children = buildTextblockChildren(node);
    if (children.length > 0) el.insert(0, children);
  } else {
    const children = nodeChildren(node).map(buildYNode);
    if (children.length > 0) el.insert(0, children);
  }
  return el;
}

// --- attribute sync (value-equal, so array-valued attrs like table.align
// compare correctly rather than by reference) ------------------------------

function attrValuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Sets/removes yNode's attributes to match bNode's. Returns true if anything changed. */
function updateAttrs(yNode: Y.XmlElement, bNode: PMNode): boolean {
  let changed = false;
  const yAttrs = yNode.getAttributes();
  for (const key in bNode.attrs) {
    const val = (bNode.attrs as any)[key];
    if (val !== null && val !== undefined) {
      if (!attrValuesEqual(yAttrs[key], val)) {
        yNode.setAttribute(key, val);
        changed = true;
      }
    } else if (key in yAttrs) {
      yNode.removeAttribute(key);
      changed = true;
    }
  }
  for (const key in yAttrs) {
    if (!(key in bNode.attrs)) {
      yNode.removeAttribute(key);
      changed = true;
    }
  }
  return changed;
}

// --- matched pairs (step 2): semantically equal, meta attrs may still
// differ. Sync attrs recursively; never touch text. ------------------------

function syncMatchedPair(yNode: Y.XmlElement | Y.XmlText, bNode: PMNode, counters: DiffCounters): void {
  if (yNode instanceof Y.XmlText) return;
  if (updateAttrs(yNode, bNode)) counters.attrOnly++;

  if (isTextblockName(bNode.type.name)) {
    // A textblock's Y children are NOT index-parallel to its PM children:
    // y-prosemirror merges consecutive text PM nodes (one per distinct
    // mark-run) into a single Y.XmlText, while inline leaves (image,
    // hard_break, raw_inline) stay their own Y.XmlElement. Naively zipping
    // `yNode.toArray()` against `nodeChildren(bNode)` by index pairs a
    // merged XmlText against a lone PM text/mark-run node, and later pairs
    // a leaf element against the WRONG PM node entirely -- silently
    // stripping that leaf's own attrs (e.g. a hard_break's `breakHint`)
    // because the wrongly-paired node has no such attr. Classify B's
    // children the same way Y groups them instead, and only sync leaf
    // elements' own attrs (text runs are covered by "never touch text").
    const groups = classifyChildren(nodeChildren(bNode));
    let gi = 0;
    for (const yChild of yNode.toArray()) {
      if (isXmlText(yChild)) {
        if (groups[gi]?.kind === 'text') gi++;
        continue;
      }
      while (groups[gi] && groups[gi].kind !== 'leaf') gi++;
      const group = groups[gi];
      gi++;
      if (group && group.kind === 'leaf') {
        syncMatchedPair(yChild as Y.XmlElement, group.node, counters);
      }
    }
    return;
  }

  const yChildren = yNode.toArray();
  const bChildren = nodeChildren(bNode);
  const n = Math.min(yChildren.length, bChildren.length);
  for (let i = 0; i < n; i++) {
    syncMatchedPair(yChildren[i] as Y.XmlElement | Y.XmlText, bChildren[i], counters);
  }
}

// --- textblock diff (step 5), inline-leaf aware ---------------------------

function isXmlText(n: unknown): n is Y.XmlText {
  return n instanceof Y.XmlText;
}

// Re-formats the whole of `yText` to carry exactly `bRuns`' attributes, via
// a single `applyDelta` call with `retain` ops (see spike 2's comment: this
// threads one cursor through all ops in sequence and avoids boundary
// ambiguity between independent `format()` calls).
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

function applyWordDiff(yText: Y.XmlText, bText: string): void {
  const aText = plainText(yText);
  if (aText === bText) return;
  const parts = Diff.diffWordsWithSpace(aText, bText);
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

function hasAdjacentXmlText(children: unknown[]): boolean {
  for (let i = 1; i < children.length; i++) {
    if (isXmlText(children[i - 1]) && isXmlText(children[i])) return true;
  }
  return false;
}

// Word-level diff aware of inline leaves (image/hard_break/raw_inline).
// Falls back to `updateYFragment` on this one textblock when the leaf
// shapes don't line up cleanly between Y and B (e.g. a leaf was added,
// removed, or the Y side is in a malformed state with adjacent text runs).
function updateTextblockContent(yNode: Y.XmlElement, bNode: PMNode, counters: DiffCounters): void {
  const bChildren = nodeChildren(bNode);
  const bGroups = classifyChildren(bChildren);
  const yChildren = yNode.toArray();

  const yLeafPositions: number[] = [];
  yChildren.forEach((c, i) => {
    if (!isXmlText(c)) yLeafPositions.push(i);
  });
  const bLeafGroups = bGroups.filter((g): g is { kind: 'leaf'; node: PMNode } => g.kind === 'leaf');

  const leafShapeMatches =
    yLeafPositions.length === bLeafGroups.length &&
    yLeafPositions.every((pos, i) => (yChildren[pos] as Y.XmlElement).nodeName === bLeafGroups[i].node.type.name);

  if (!leafShapeMatches || hasAdjacentXmlText(yChildren)) {
    const y = yNode.doc;
    if (!y) throw new Error('updateTextblockContent: node is not attached to a Y.Doc');
    updateYFragment(y, yNode, bNode, { mapping: new Map(), isOMark: new Map() } as any);
    counters.coarseTextblocks++;
    return;
  }

  // Sync each leaf's own attrs (e.g. its `leafMarks` encoding, or `src`/`alt`).
  yLeafPositions.forEach((pos, i) => {
    if (updateAttrs(yChildren[pos] as Y.XmlElement, bLeafGroups[i].node)) counters.attrOnly++;
  });

  // B's text runs, one bucket per boundary (before leaf 0, between leaf i-1
  // and i, after the last leaf) -- there are always leafCount + 1 boundaries.
  const numBoundaries = yLeafPositions.length + 1;
  const bBoundaryRuns: TextRun[][] = Array.from({ length: numBoundaries }, () => [] as TextRun[]);
  {
    let boundary = 0;
    for (const g of bGroups) {
      if (g.kind === 'text') bBoundaryRuns[boundary] = g.runs;
      else boundary++;
    }
  }

  // Process boundaries right to left so indices computed from the original
  // `yChildren` snapshot stay valid: a boundary's own gap position is always
  // strictly left of every later boundary's gap, so mutating a later
  // boundary first never shifts an earlier boundary's indices.
  for (let k = numBoundaries - 1; k >= 0; k--) {
    const start = k === 0 ? 0 : yLeafPositions[k - 1] + 1;
    const gapEnd = k === yLeafPositions.length ? yChildren.length : yLeafPositions[k];
    const gapLen = gapEnd - start; // 0 or 1, guaranteed by the no-adjacent-text check above
    const runs = bBoundaryRuns[k];
    const bText = runs.map((r) => r.insert).join('');

    if (gapLen > 0) {
      const yText = yChildren[start] as Y.XmlText;
      if (bText.length === 0) {
        if (yText.length > 0) yText.delete(0, yText.length);
        // Remove the now-empty text node: y-prosemirror's own encoding never
        // has an empty text group, so keep that invariant for later diffs.
        const idx = yNode.toArray().indexOf(yText);
        if (idx >= 0) yNode.delete(idx, 1);
      } else {
        applyWordDiff(yText, bText);
        reformatToMatch(yText, runs);
      }
    } else if (bText.length > 0) {
      yNode.insert(start, [buildYText(runs)]);
    }
  }
}

// --- paired, not equal (step 4) -------------------------------------------

function updatePairedNode(yNode: Y.XmlElement, aNode: PMNode, bNode: PMNode, counters: DiffCounters): void {
  updateAttrs(yNode, bNode);
  if (isTextblockName(bNode.type.name)) {
    updateTextblockContent(yNode, bNode, counters);
  } else {
    const aChildren = nodeChildren(aNode);
    const bChildren = nodeChildren(bNode);
    const ops = planChildOps(aChildren, bChildren);
    applyChildOps(yNode, ops, aChildren, bChildren, counters);
  }
  counters.pairedUpdates++;
}

function applyChildOps(
  yParent: Y.XmlFragment | Y.XmlElement,
  ops: Op[],
  aChildren: PMNode[],
  bChildren: PMNode[],
  counters: DiffCounters,
): void {
  let cursor = 0;
  for (const op of ops) {
    switch (op.kind) {
      case 'skip': {
        const yChild = yParent.toArray()[cursor] as Y.XmlElement | Y.XmlText;
        syncMatchedPair(yChild, bChildren[op.bIdx], counters);
        cursor++;
        break;
      }
      case 'update': {
        const yChild = yParent.toArray()[cursor] as Y.XmlElement;
        updatePairedNode(yChild, aChildren[op.aIdx], bChildren[op.bIdx], counters);
        cursor++;
        break;
      }
      case 'delete':
        yParent.delete(cursor, 1);
        counters.deletes++;
        break;
      case 'insert': {
        const yNode = buildYNode(bChildren[op.bIdx]);
        yParent.insert(cursor, [yNode]);
        counters.inserts++;
        cursor++;
        break;
      }
    }
  }
}

/**
 * Diff aChildren -> bChildren (both the direct children of some PM node,
 * typically the doc) and mutate `yParent` (the corresponding Y.XmlFragment
 * or Y.XmlElement, already holding aChildren's Y encoding) in place so that
 * afterwards its content equals bChildren exactly.
 */
export function applyDiff(yParent: Y.XmlFragment, aChildren: PMNode[], bChildren: PMNode[]): DiffCounters {
  const counters = newCounters();
  const ops = planChildOps(aChildren, bChildren);
  applyChildOps(yParent, ops, aChildren, bChildren, counters);
  return counters;
}
