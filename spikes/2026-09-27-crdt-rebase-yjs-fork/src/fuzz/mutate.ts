// Upstream mutation generator (brief 03, section 1, step 4): "1 to 6 random
// mutations of pmA: replace, insert or delete words in a textblock; rewrite
// a paragraph; insert or delete a paragraph; delete a list item; add a list
// item; toggle a mark on a word; change a heading level; change a code
// block line." Some mutations must hit blocks humans also edit (biased via
// `touchedFlatIndices`, correlated with Y block ids in trial.ts).
import type { Node as PMNode } from "prosemirror-model";
import { schema } from "../schema.js";
import {
  deleteAtPath,
  flattenTextblocks,
  insertAtPath,
  nodeWithRuns,
  plainTextOf,
  replaceAtPath,
  textRunsOf,
  type FlatRef,
} from "./pmtree.js";
import type { Rng } from "./prng.js";

// Never overlaps a fuzz token (`tok_<replica>_<n>`, see humanEdits.ts), so
// upstream word mutations can never accidentally manufacture or destroy
// something that looks like a human's token by coincidence.
const FILLER_WORDS = [
  "xylophone",
  "wanders",
  "brightly",
  "cactus",
  "umbrella",
  "gigantic",
  "murmurs",
  "lantern",
  "peculiar",
  "meadow",
  "quietly",
  "boulder",
];

const WORD_RE = /\b[A-Za-z]{3,}\b/g;

export type MutationKind =
  | "word-replace"
  | "word-insert"
  | "word-delete"
  | "rewrite-paragraph"
  | "toggle-mark"
  | "heading-level"
  | "code-line"
  | "insert-paragraph"
  | "delete-paragraph"
  | "delete-list-item"
  | "add-list-item";

const TARGETED_KINDS: MutationKind[] = [
  "word-replace",
  "word-insert",
  "word-delete",
  "rewrite-paragraph",
  "toggle-mark",
  "heading-level",
  "code-line",
];

const STRUCTURAL_KINDS: MutationKind[] = [
  "insert-paragraph",
  "delete-paragraph",
  "delete-list-item",
  "add-list-item",
];

export const ALL_MUTATION_KINDS: MutationKind[] = [...TARGETED_KINDS, ...STRUCTURAL_KINDS];

function nodeMatchesKind(node: PMNode, kind: MutationKind): boolean {
  switch (kind) {
    case "heading-level":
      return node.type.name === "heading";
    case "code-line":
      return node.type.name === "code_block" && plainTextOf(node).length > 0;
    case "toggle-mark":
      return (node.type.name === "paragraph" || node.type.name === "heading") && node.childCount > 0;
    case "word-replace":
    case "word-insert":
    case "word-delete":
    case "rewrite-paragraph":
      return WORD_RE.test(plainTextOf(node));
    default:
      return false;
  }
}

// --- single-textblock mutations ------------------------------------------

function wordReplace(node: PMNode, rng: Rng): PMNode | null {
  const runs = textRunsOf(node);
  const candidates = runs
    .map((r, i) => ({ i, matches: [...r.text.matchAll(WORD_RE)] }))
    .filter((c) => c.matches.length > 0);
  if (candidates.length === 0) return null;
  const { i, matches } = rng.pick(candidates);
  const m = rng.pick(matches);
  const start = m.index!;
  const end = start + m[0].length;
  const replacement = rng.pick(FILLER_WORDS);
  const run = runs[i];
  const newRuns = runs.slice();
  newRuns[i] = { ...run, text: run.text.slice(0, start) + replacement + run.text.slice(end) };
  return nodeWithRuns(node, newRuns);
}

function wordInsert(node: PMNode, rng: Rng): PMNode | null {
  const runs = textRunsOf(node);
  const candidates = runs
    .map((r, i) => ({ i, matches: [...r.text.matchAll(WORD_RE)] }))
    .filter((c) => c.matches.length > 0);
  if (candidates.length === 0) return null;
  const { i, matches } = rng.pick(candidates);
  const m = rng.pick(matches);
  const end = m.index! + m[0].length;
  const insertion = " " + rng.pick(FILLER_WORDS);
  const run = runs[i];
  const newRuns = runs.slice();
  newRuns[i] = { ...run, text: run.text.slice(0, end) + insertion + run.text.slice(end) };
  return nodeWithRuns(node, newRuns);
}

function wordDelete(node: PMNode, rng: Rng): PMNode | null {
  const runs = textRunsOf(node);
  const candidates = runs
    .map((r, i) => ({ i, matches: [...r.text.matchAll(WORD_RE)] }))
    .filter((c) => c.matches.length > 0);
  if (candidates.length === 0) return null;
  const { i, matches } = rng.pick(candidates);
  const m = rng.pick(matches);
  let start = m.index!;
  let end = start + m[0].length;
  const run = runs[i];
  if (run.text[end] === " ") end++;
  else if (start > 0 && run.text[start - 1] === " ") start--;
  const newRuns = runs.slice();
  newRuns[i] = { ...run, text: run.text.slice(0, start) + run.text.slice(end) };
  return nodeWithRuns(node, newRuns);
}

/** Keeps roughly the first half of the textblock's words, replaces the rest
 * with filler — similarity lands near the tree diff's 0.5 Dice threshold on
 * purpose, so "rewrite" sometimes pairs as an update and sometimes as a
 * delete+insert, exercising both paths. Drops per-run marks (documented
 * simplification: a full rewrite is modeled as one plain-text run). */
function rewriteParagraph(node: PMNode, rng: Rng): PMNode | null {
  const text = plainTextOf(node);
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  const keep = Math.max(1, Math.floor(words.length / 2));
  const fillerCount = Math.max(1, words.length - keep);
  const filler = Array.from({ length: fillerCount }, () => rng.pick(FILLER_WORDS));
  const newText = [...words.slice(0, keep), ...filler].join(" ");
  return nodeWithRuns(node, [{ text: newText, marks: [] }]);
}

function toggleMark(node: PMNode, rng: Rng): PMNode | null {
  const runs = textRunsOf(node);
  const withWords = runs.map((r, i) => i).filter((i) => runs[i].text.trim().length > 0);
  if (withWords.length === 0) return null;
  const i = rng.pick(withWords);
  const markType = schema.marks.em;
  const run = runs[i];
  const has = markType.isInSet(run.marks);
  const newMarks = has ? markType.removeFromSet(run.marks) : run.marks.concat(markType.create());
  const newRuns = runs.slice();
  newRuns[i] = { ...run, marks: newMarks };
  return nodeWithRuns(node, newRuns);
}

function headingLevel(node: PMNode, rng: Rng): PMNode | null {
  const current = (node.attrs as any).level ?? 1;
  let next = rng.range(1, 6);
  if (next === current) next = (next % 6) + 1;
  return node.type.create({ ...node.attrs, level: next }, node.content, node.marks);
}

function codeLine(node: PMNode, rng: Rng): PMNode | null {
  const text = plainTextOf(node);
  const lines = text.split("\n");
  if (lines.length === 0) return null;
  const li = rng.int(lines.length);
  lines[li] = `${lines[li]} ${rng.pick(FILLER_WORDS)}`;
  const newText = lines.join("\n");
  return nodeWithRuns(node, newText.length > 0 ? [{ text: newText, marks: [] }] : []);
}

function applyTargeted(node: PMNode, kind: MutationKind, rng: Rng): PMNode | null {
  switch (kind) {
    case "word-replace":
      return wordReplace(node, rng);
    case "word-insert":
      return wordInsert(node, rng);
    case "word-delete":
      return wordDelete(node, rng);
    case "rewrite-paragraph":
      return rewriteParagraph(node, rng);
    case "toggle-mark":
      return toggleMark(node, rng);
    case "heading-level":
      return headingLevel(node, rng);
    case "code-line":
      return codeLine(node, rng);
    default:
      return null;
  }
}

// --- structural (top-level-only, documented simplification matching
// Replica.insertBlock/deleteBlock) ----------------------------------------

function newFillerParagraph(rng: Rng, tag: string): PMNode {
  const text = `${tag} ${rng.pick(FILLER_WORDS)} ${rng.pick(FILLER_WORDS)}.`;
  return schema.nodes.paragraph.create(undefined, schema.text(text));
}

function topLevelIndicesOfType(doc: PMNode, typeName: string): number[] {
  const out: number[] = [];
  doc.forEach((child, _o, i) => {
    if (child.type.name === typeName) out.push(i);
  });
  return out;
}

function applyStructural(
  doc: PMNode,
  kind: MutationKind,
  rng: Rng
): PMNode | null {
  const topCount = doc.childCount;
  switch (kind) {
    case "insert-paragraph": {
      const index = rng.range(0, topCount);
      return insertAtPath(doc, [], index, newFillerParagraph(rng, "Upstream inserted paragraph:"));
    }
    case "delete-paragraph": {
      const paraIdx = topLevelIndicesOfType(doc, "paragraph");
      if (paraIdx.length === 0 || topCount <= 1) return null;
      const idx = rng.pick(paraIdx);
      return deleteAtPath(doc, [idx]);
    }
    case "delete-list-item": {
      const listIdx = [...topLevelIndicesOfType(doc, "bullet_list"), ...topLevelIndicesOfType(doc, "ordered_list")];
      if (listIdx.length === 0) return null;
      const li = rng.pick(listIdx);
      const listNode = doc.child(li);
      if (listNode.childCount <= 1) return null;
      const itemIdx = rng.int(listNode.childCount);
      return deleteAtPath(doc, [li, itemIdx]);
    }
    case "add-list-item": {
      const listIdx = [...topLevelIndicesOfType(doc, "bullet_list"), ...topLevelIndicesOfType(doc, "ordered_list")];
      if (listIdx.length === 0) return null;
      const li = rng.pick(listIdx);
      const listNode = doc.child(li);
      const item = schema.nodes.list_item.create(
        undefined,
        newFillerParagraph(rng, "Upstream added item:")
      );
      const index = rng.range(0, listNode.childCount);
      return insertAtPath(doc, [li], index, item);
    }
    default:
      return null;
  }
}

export interface UpstreamMutationLog {
  kind: MutationKind;
  targetFlatIndex?: number;
  biased: boolean;
  applied: boolean;
}

export interface UpstreamMutationResult {
  doc: PMNode;
  log: UpstreamMutationLog[];
  /** Original (pre-mutation) flat textblock indices this trial's upstream
   * mutations touched — used as independent ground truth for
   * missing-flag/spurious-flag/upstream-change-lost metrics. */
  touchedFlatIndices: Set<number>;
}

/**
 * Apply `count` upstream mutations to `pmA`, biasing roughly half of the
 * "targeted" (single-textblock) mutations toward `touchedFlatIndices`
 * (blocks humans also edited this trial, in the *original* flat-textblock
 * numbering — see trial.ts). Targeted mutations are applied first, against
 * paths from `flattenTextblocks(pmA)` (valid because they don't change
 * block count/order); structural mutations are applied afterward, at
 * positions chosen fresh from the document as it stands after the targeted
 * mutations (a documented simplification: structural mutation targets are
 * not bias-correlated with touched blocks).
 */
export function applyUpstreamMutations(
  pmA: PMNode,
  rng: Rng,
  touchedFlatIndices: Set<number>,
  count: number
): UpstreamMutationResult {
  const originalFlat = flattenTextblocks(pmA);
  const log: UpstreamMutationLog[] = [];
  const touched = new Set<number>();

  const kinds: MutationKind[] = [];
  for (let i = 0; i < count; i++) kinds.push(rng.pick(ALL_MUTATION_KINDS));
  const targeted = kinds.filter((k) => TARGETED_KINDS.includes(k));
  const structural = kinds.filter((k) => STRUCTURAL_KINDS.includes(k));

  let doc = pmA;
  const claimed = new Set<number>();
  const mutatedTextByIdx = new Map<number, string>();
  for (const kind of targeted) {
    const biased = touchedFlatIndices.size > 0 && rng.bool(0.5);
    const pool = biased
      ? originalFlat.filter((f, i) => touchedFlatIndices.has(i) && !claimed.has(i) && nodeMatchesKind(f.node, kind))
      : originalFlat.filter((f, i) => !claimed.has(i) && nodeMatchesKind(f.node, kind));
    let candidates = pool;
    if (candidates.length === 0) {
      candidates = originalFlat.filter((f, i) => !claimed.has(i) && nodeMatchesKind(f.node, kind));
    }
    if (candidates.length === 0) {
      log.push({ kind, biased, applied: false });
      continue;
    }
    const chosenIdx = originalFlat.indexOf(rng.pick(candidates));
    const ref = originalFlat[chosenIdx];
    const mutated = applyTargeted(ref.node, kind, rng);
    if (!mutated) {
      log.push({ kind, targetFlatIndex: chosenIdx, biased, applied: false });
      continue;
    }
    doc = replaceAtPath(doc, ref.path, mutated);
    claimed.add(chosenIdx);
    // The real flagging system (integrate.ts) compares blocks by *plain
    // text* only (`blockContentAt`/`plainTextDelta`), not attrs or marks —
    // so an attrs-only change (heading-level) or a marks-only change
    // (toggle-mark) is invisible to it and must not count as "upstream
    // touched" here either, or the missing-flag/spurious-flag ground truth
    // would be inconsistent with what the system under test actually
    // checks (found via the fuzz run itself: heading-level/toggle-mark
    // mutations were responsible for most "missing-flag" reports before
    // this fix — not a bug in the rebase/integrate code, a mismatch in this
    // harness's own independent ground truth).
    // Orchestrator revision after review: integrate.ts now compares attrs
    // and marks too, so any change to the node counts as upstream-touched.
    if (!mutated.eq(ref.node)) {
      touched.add(chosenIdx);
      mutatedTextByIdx.set(chosenIdx, plainTextOf(mutated));
    }
    log.push({ kind, targetFlatIndex: chosenIdx, biased, applied: true });
  }

  for (const kind of structural) {
    const mutated = applyStructural(doc, kind, rng);
    if (!mutated) {
      log.push({ kind, biased: false, applied: false });
      continue;
    }
    doc = mutated;
    // A structural op (paragraph/list-item insert or delete) can remove a
    // block a *targeted* mutation just changed above (e.g. a word-replace
    // on paragraph X, followed by a delete-paragraph that happens to
    // remove X too) — its true final fate is "deleted by upstream", which
    // the real system handles via resurrection (a different `review`
    // reason) rather than "concurrent-edit", so it must not stay in the
    // concurrent-edit ground truth. Detected by checking whether the text
    // we just recorded for each touched index is still present anywhere in
    // the doc's flattened textblocks (found via the fuzz run itself: this
    // was the dominant cause of "missing-flag" reports even after the
    // attrs/marks fix above).
    if (mutatedTextByIdx.size > 0) {
      const survivingTexts = new Set(flattenTextblocks(doc).map((f) => plainTextOf(f.node)));
      for (const [idx, text] of mutatedTextByIdx) {
        if (touched.has(idx) && !survivingTexts.has(text)) touched.delete(idx);
      }
    }
    log.push({ kind, biased: false, applied: true });
  }

  return { doc, log, touchedFlatIndices: touched };
}
