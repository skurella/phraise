// Gate G2 (brief 03): targeted re-seed measurement, replacing gate G's
// "weak measurement" — gate G's `makeRandomEdits` mutates the raw Markdown
// string at positions picked independently of where any comment actually
// is (comments are picked via `docPlainText` offsets; edits are picked via
// raw-Markdown-string offsets — two unrelated offset spaces), so most edits
// land nowhere near any comment's quote, and gate G's "0% mis-anchored
// under 1 edit" is easy to clear almost by construction. This gate instead
// edits the parsed PM tree directly at each comment's own block and local
// offset (never the raw Markdown string, and never a different occurrence
// of a repeated word — see `planEditsForBlock`'s `claimed` parameter), so
// every edit lands exactly inside the quote or within 20 characters of it,
// for every one of 200 comments.
//
// For 200 comments across the corpus: apply 1 small targeted edit (word
// insert/delete/replace) per comment, then re-seed once; report
// correct/orphaned/mis-anchored rates using an independent ground truth
// (each edited block's own before/after text, diffed in a small window
// around the comment's own position — see `buildPerBlockGroundTruth`). Also
// report a 3-targeted-edits-per-comment row.
//
// As built, this gate does not clear its own "mis-anchored <= 2%" bar
// (observed: ~19% for 1 edit/comment, worse for 3). Root-caused with two
// throwaway debug scripts (not a harness bug — see
// context/logs/2026-09-27-builder-spike-2-yjs-fuzz.md, ~06:07 entry, and
// the README's "Real bugs found" section): `pickPhrases` (inherited
// unchanged from gate G) allows single common short words (4+ letters,
// e.g. "stable", "Date", "from") as a comment's entire quote. Guaranteeing
// a nearby edit for *every* comment (this gate's whole point) reliably
// destroys that specific occurrence when the quote is this short/common —
// and when the exact same word also appears verbatim elsewhere in the
// ~8000-word corpus (common for short words), `reseed`'s selector-only
// fuzzy re-anchoring (there is no shared CRDT history across a re-seed, so
// it cannot fall back to a live position) correctly prefers that other,
// perfectly-matching occurrence over the now-corrupted nearby one. That is
// arguably the *right* fallback behavior for an ambiguous, non-unique
// quote, not an anchoring bug — but it means this gate's strict
// position-based ground truth calls it "mis-anchored" regardless. Gate G's
// far lower edit density (1 random edit across the whole corpus, not one
// per comment) rarely triggers this, which is exactly why it was flagged
// as a "weak measurement" in the first place. Not narrowing `pickPhrases`
// to only multi-word phrases to dodge this (that would be weakening the
// test to force a pass); reporting the true rate instead.
import type { Node as PMNode } from "prosemirror-model";
import { parseMarkdown, serializeMarkdown } from "../markdown.js";
import { seedDoc, type Author } from "../seed.js";
import { reseed } from "../reseed.js";
import { addComment, resolveComment } from "../comments.js";
import { docPlainText, type TextSegment } from "../text.js";
import { flattenTextblocks, nodeWithRuns, plainTextOf, replaceAtPath } from "../fuzz/pmtree.js";
import { mulberry32, iou, buildDiffMapper, type RangeOrNull } from "./gate-g.js";
import { loadCorpusFiles } from "../fuzz/corpus.js";
import type { GateResult } from "./types.js";

const AUTHOR: Author = { name: "Repo Owner", email: "owner@example.com" };
const DOC_ID = "gate-g2-doc";
const COMMENT_COUNT = 200;
const TARGET_WINDOW = 20; // "within 20 characters of it"

interface Candidate {
  start: number;
  end: number;
}

function pickPhrases(text: string, count: number, rnd: () => number): Candidate[] {
  const re = /[A-Za-z]{4,}(?:[ \t]+[A-Za-z]{3,}){0,3}/g;
  const all: Candidate[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    all.push({ start: m.index, end: m.index + m[0].length });
  }
  const out: Candidate[] = [];
  for (let i = 0; i < count; i++) {
    out.push(all[Math.floor(rnd() * all.length)]);
  }
  return out;
}

const REPLACEMENTS = [
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
];

function loadCorpus(): string {
  return loadCorpusFiles()
    .map((f) => f.text)
    .join("\n\n");
}

interface LocalEdit {
  /** Offset within the block's own plain text. */
  localPos: number;
  op: "insert" | "delete" | "replace";
}

/** Plan 1 (or 3) word-boundary edits within [localStart-20, localEnd+20]
 * (clamped to the block's own text), for one comment's quote range.
 * `claimed` holds word-start offsets already used by an *earlier* comment
 * sharing this same block (a dense block, e.g. a Markdown table collapsed
 * into one plain-text block since our schema has no table node, can easily
 * hold several comments) — candidates within 8 characters of an
 * already-claimed offset are excluded, so two comments' edits can never
 * overlap or land inside the same word (found via a throwaway debug
 * script: an overlapping pair — one edit replacing a word, another
 * inserting mid-word inside that same replaced word — corrupted both
 * comments' surrounding text unpredictably, which is exactly the kind of
 * double-edit collision a human's two independent nearby comments should
 * never actually suffer from a single-word edit each). New offsets this
 * call chooses are added to `claimed` before returning.
 */
function planEditsForBlock(
  blockText: string,
  localStart: number,
  localEnd: number,
  editsPerComment: number,
  rnd: () => number,
  claimed: Set<number>
): LocalEdit[] {
  const lo = Math.max(0, localStart - TARGET_WINDOW);
  const hi = Math.min(blockText.length, localEnd + TARGET_WINDOW);
  const wordRe = /\b[A-Za-z]{3,}\b/g;
  const allOffsets: number[] = [];
  let m: RegExpExecArray | null;
  const slice = blockText.slice(lo, hi);
  while ((m = wordRe.exec(slice))) allOffsets.push(lo + m.index);
  const offsets = allOffsets.filter(
    (o) => ![...claimed].some((c) => Math.abs(c - o) < 8)
  );
  if (offsets.length === 0) return [];

  const chosen = new Set<number>();
  const want = Math.min(editsPerComment, offsets.length);
  while (chosen.size < want) {
    chosen.add(offsets[Math.floor(rnd() * offsets.length)]);
  }
  for (const c of chosen) claimed.add(c);
  const ops: Array<"insert" | "delete" | "replace"> = ["insert", "delete", "replace"];
  return [...chosen].map((localPos) => ({ localPos, op: ops[Math.floor(rnd() * ops.length)] }));
}

/** Apply all of one block's planned edits to its own plain text, processed
 * in descending offset order so earlier offsets stay valid. Marks are
 * dropped from the block (a documented simplification, consistent with the
 * fuzz harness's own upstream word mutations in src/fuzz/mutate.ts). */
function applyLocalEdits(blockText: string, edits: LocalEdit[]): string {
  const byPos = new Map<number, LocalEdit>();
  for (const e of edits) byPos.set(e.localPos, e); // last write wins on exact collisions
  const sorted = [...byPos.values()].sort((a, b) => b.localPos - a.localPos);

  let text = blockText;
  for (const edit of sorted) {
    const rest = /\b[A-Za-z]{3,}\b/.exec(text.slice(edit.localPos));
    if (!rest || rest.index !== 0) continue;
    const word = rest[0];
    const start = edit.localPos;
    const end = start + word.length;
    if (edit.op === "replace") {
      const replacement = REPLACEMENTS[(start + word.length) % REPLACEMENTS.length];
      text = text.slice(0, start) + replacement + text.slice(end);
    } else if (edit.op === "delete") {
      let s = start;
      let e = end;
      if (text[e] === " ") e++;
      else if (s > 0 && text[s - 1] === " ") s--;
      text = text.slice(0, s) + text.slice(e);
    } else {
      const insertion = REPLACEMENTS[(start + word.length) % REPLACEMENTS.length];
      text = text.slice(0, end) + " " + insertion + text.slice(end);
    }
  }
  return text;
}

// Generous enough to always contain the targeted edit (which never lands
// more than TARGET_WINDOW + one word away from the quote) with margin to
// spare, while narrow enough to exclude unrelated repeats of a short/common
// quote word elsewhere in a large block (see below).
const GROUND_TRUTH_WINDOW = 80;

/**
 * Per-comment ground truth via a *local window* diff, not a whole-block or
 * whole-document one: some blocks in this corpus are large (a Markdown
 * table without a table node in our schema collapses into one long
 * plain-text block), and a short, common quote (a single 4-6 letter word
 * like "stable" or "Date") can recur several times within the same block.
 * Diffing the *entire* block's old/new text is still ambiguous in that
 * case — `Diff.diffChars` can align the wrong nearby repeat to the
 * comment's own position (found via two throwaway debug scripts while
 * building this gate: `resolveComment`'s actual result was consistently
 * the sensible, correct-looking text, e.g. quote "stable" resolving to
 * "stable", while the whole-block ground truth read "lantern lante" for
 * the same comment — the *ground truth* was wrong, not the anchoring).
 * Restricting the diff to a small window around the comment's own local
 * position — which, by construction, is the only place its own edit can
 * land — removes the far-away repeats from the diff input entirely, so
 * there's nothing left to misalign against.
 */
function buildPerBlockGroundTruth(oldSegments: TextSegment[], newSegments: TextSegment[]) {
  function segmentIndexAt(segments: TextSegment[], offset: number): number {
    return segments.findIndex((s) => offset >= s.start && offset <= s.end);
  }
  return {
    mapRange(start: number, end: number): RangeOrNull | null {
      const idx = segmentIndexAt(oldSegments, start);
      if (idx < 0 || idx >= newSegments.length) return null;
      const oldSeg = oldSegments[idx];
      const newSeg = newSegments[idx];
      const localStart = Math.max(0, start - oldSeg.start);
      const localEnd = Math.max(localStart, Math.min(end, oldSeg.end) - oldSeg.start);

      const winLo = Math.max(0, localStart - GROUND_TRUTH_WINDOW);
      const winHi = Math.min(oldSeg.text.length, localEnd + GROUND_TRUTH_WINDOW, newSeg.text.length);
      if (winHi <= winLo) return null;
      const oldWindow = oldSeg.text.slice(winLo, winHi);
      const newWindow = newSeg.text.slice(winLo, winHi);
      const mapper = buildDiffMapper(oldWindow, newWindow);

      const local = mapper.mapRange(localStart - winLo, localEnd - winLo);
      if (local === null) return null;
      return { start: newSeg.start + winLo + local.start, end: newSeg.start + winLo + local.end };
    },
  };
}

export interface GateG2Row {
  editsPerComment: number;
  correct: number;
  orphaned: number;
  misAnchored: number;
  total: number;
  editedComments: number;
}

export function runGateG2Detailed(): { rows: GateG2Row[]; pass: boolean } {
  const corpus = loadCorpus();
  const rows: GateG2Row[] = [];

  for (const editsPerComment of [1, 3]) {
    const rnd = mulberry32(1000 + editsPerComment);
    const originalDoc = seedDoc(DOC_ID, corpus, "A", AUTHOR);
    const { text: originalText, segments: oldSegments } = docPlainText(originalDoc);

    const phrases = pickPhrases(originalText, COMMENT_COUNT, rnd);
    const ids = phrases.map((p, i) =>
      addComment(originalDoc, p.start, p.end, `comment ${i}`, { userId: "srv", name: "server" })
    );

    // Group each comment's planned edits by the block it falls in (found
    // via the *same* segment layout `addComment` used), so a block with
    // more than one nearby comment gets all of its edits applied together.
    const pmDoc = parseMarkdown(corpus);
    const flat = flattenTextblocks(pmDoc);
    const editsByBlock = new Map<number, LocalEdit[]>();
    const claimedByBlock = new Map<number, Set<number>>();
    let editedComments = 0;
    for (let i = 0; i < phrases.length; i++) {
      const segIdx = oldSegments.findIndex(
        (s) => phrases[i].start >= s.start && phrases[i].start <= s.end
      );
      if (segIdx < 0 || segIdx >= flat.length) continue;
      const seg = oldSegments[segIdx];
      const localStart = phrases[i].start - seg.start;
      const localEnd = Math.min(phrases[i].end, seg.end) - seg.start;
      const claimed = claimedByBlock.get(segIdx) ?? new Set<number>();
      claimedByBlock.set(segIdx, claimed);
      const edits = planEditsForBlock(
        plainTextOf(flat[segIdx].node),
        localStart,
        localEnd,
        editsPerComment,
        rnd,
        claimed
      );
      if (edits.length === 0) continue;
      editedComments++;
      const existing = editsByBlock.get(segIdx) ?? [];
      existing.push(...edits);
      editsByBlock.set(segIdx, existing);
    }

    let editedPmDoc: PMNode = pmDoc;
    for (const [segIdx, edits] of editsByBlock) {
      const ref = flat[segIdx];
      const newText = applyLocalEdits(plainTextOf(ref.node), edits);
      const mutated = nodeWithRuns(ref.node, [{ text: newText, marks: [] }]);
      editedPmDoc = replaceAtPath(editedPmDoc, ref.path, mutated);
    }
    const editedMarkdown = serializeMarkdown(editedPmDoc);

    const report = reseed(originalDoc, DOC_ID, editedMarkdown, `A-targeted${editsPerComment}`, AUTHOR);
    const { segments: newSegments } = docPlainText(report.doc);
    const mapper = buildPerBlockGroundTruth(oldSegments, newSegments);

    let correct = 0;
    let orphaned = 0;
    let misAnchored = 0;
    for (let i = 0; i < ids.length; i++) {
      const groundTruth = mapper.mapRange(phrases[i].start, phrases[i].end);
      const actual = resolveComment(report.doc, ids[i]);
      if (groundTruth === null) {
        if (actual.method === "orphaned") correct++;
        else misAnchored++;
        continue;
      }
      if (actual.method === "orphaned" || actual.start === undefined || actual.end === undefined) {
        orphaned++;
        continue;
      }
      const score = iou(groundTruth, { start: actual.start, end: actual.end });
      if (score >= 0.5) correct++;
      else misAnchored++;
    }

    rows.push({ editsPerComment, correct, orphaned, misAnchored, total: ids.length, editedComments });
  }

  const oneEditRow = rows[0];
  const pass = oneEditRow.misAnchored / oneEditRow.total <= 0.02;
  return { rows, pass };
}

export function runGateG2(): GateResult {
  const { rows, pass } = runGateG2Detailed();
  const detail = rows
    .map(
      (r) =>
        `edits/comment=${r.editsPerComment} (${r.editedComments}/${r.total} had a nearby word to edit): ` +
        `correct=${r.correct}/${r.total} orphaned=${r.orphaned} misAnchored=${r.misAnchored} ` +
        `(${((r.misAnchored / r.total) * 100).toFixed(1)}%)`
    )
    .join("; ");
  return {
    name: "G2: targeted re-seed anchoring (mis-anchored <= 2% for 1 edit/comment near its quote; 3 reported)",
    pass,
    detail,
  };
}

