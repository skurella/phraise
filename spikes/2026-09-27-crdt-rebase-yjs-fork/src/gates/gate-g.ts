// Gate G: re-seed. With unchanged text, 100% of comments (>= 50 random
// comments across fixtures/corpus/) re-anchor to the identical text. With 1,
// 3 and 10 random small word edits applied before re-seeding, report
// correct/orphaned/mis-anchored rates, where ground truth comes from mapping
// the original range through the edits (IoU >= 0.5 counts as correct; an
// orphan is correct when the ground-truth range was fully deleted). Pass
// criterion: 100% correct unchanged, zero mis-anchored under 1 edit; the
// 3- and 10-edit rows are reported, not gated.
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as Diff from "diff";
import { seedDoc, type Author } from "../seed.js";
import { reseed } from "../reseed.js";
import { addComment, resolveComment } from "../comments.js";
import { docPlainText } from "../text.js";
import type { GateResult } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CORPUS_DIR = path.resolve(__dirname, "..", "..", "fixtures", "corpus");
const AUTHOR: Author = { name: "Repo Owner", email: "owner@example.com" };
const DOC_ID = "gate-g-doc";
const COMMENT_COUNT = 50;

function mulberry32(seed: number): () => number {
  let s = seed;
  return function () {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function loadCorpus(): string {
  const files = fs
    .readdirSync(CORPUS_DIR)
    .filter((f) => f.endsWith(".md"))
    .sort();
  return files.map((f) => fs.readFileSync(path.join(CORPUS_DIR, f), "utf8")).join("\n\n");
}

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

/** Replace `count` random whole-word (>=4 letters) occurrences in `markdown` with a different random word, processed in descending offset order so earlier offsets stay valid. */
function makeRandomEdits(markdown: string, count: number, rnd: () => number): string {
  const wordRe = /\b[A-Za-z]{4,}\b/g;
  const offsets: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = wordRe.exec(markdown))) offsets.push(m.index);
  if (count === 0 || offsets.length === 0) return markdown;

  const chosen = new Set<number>();
  while (chosen.size < Math.min(count, offsets.length)) {
    chosen.add(offsets[Math.floor(rnd() * offsets.length)]);
  }
  const positions = [...chosen].sort((a, b) => b - a);

  let md = markdown;
  for (const start of positions) {
    const rest = /\b[A-Za-z]{4,}\b/.exec(md.slice(start));
    if (!rest || rest.index !== 0) continue;
    const word = rest[0];
    const replacement = REPLACEMENTS[Math.floor(rnd() * REPLACEMENTS.length)];
    md = md.slice(0, start) + replacement + md.slice(start + word.length);
  }
  return md;
}

interface RangeOrNull {
  start: number;
  end: number;
}

/** Maps a range in `oldText` to its ground-truth range in `newText` via a
 * character diff, independent of how the edits were produced. Returns null
 * if the range is fully contained in deleted text. */
function buildDiffMapper(oldText: string, newText: string) {
  const parts = Diff.diffChars(oldText, newText);
  interface Seg {
    oldStart: number;
    oldEnd: number;
    newStart: number;
    newEnd: number;
    removed?: boolean;
  }
  const segs: Seg[] = [];
  let oldPos = 0;
  let newPos = 0;
  for (const part of parts) {
    const len = part.value.length;
    if (part.removed) {
      segs.push({ oldStart: oldPos, oldEnd: oldPos + len, newStart: newPos, newEnd: newPos, removed: true });
      oldPos += len;
    } else if (part.added) {
      segs.push({ oldStart: oldPos, oldEnd: oldPos, newStart: newPos, newEnd: newPos + len });
      newPos += len;
    } else {
      segs.push({ oldStart: oldPos, oldEnd: oldPos + len, newStart: newPos, newEnd: newPos + len });
      oldPos += len;
      newPos += len;
    }
  }

  function mapPoint(oldOffset: number, preferRight: boolean): number {
    for (const seg of segs) {
      if (oldOffset > seg.oldStart && oldOffset < seg.oldEnd) {
        if (seg.removed) return preferRight ? seg.newEnd : seg.newStart;
        return seg.newStart + (oldOffset - seg.oldStart);
      }
      if (oldOffset === seg.oldStart) {
        return preferRight ? seg.newStart : seg.newStart;
      }
    }
    return newPos;
  }

  return {
    mapRange(start: number, end: number): RangeOrNull | null {
      let coveredByRemoval = 0;
      const totalLen = end - start;
      for (const seg of segs) {
        if (seg.removed && seg.oldEnd > start && seg.oldStart < end) {
          const overlapStart = Math.max(seg.oldStart, start);
          const overlapEnd = Math.min(seg.oldEnd, end);
          coveredByRemoval += Math.max(0, overlapEnd - overlapStart);
        }
      }
      if (totalLen > 0 && coveredByRemoval >= totalLen) return null;
      const mappedStart = mapPoint(start, false);
      const mappedEnd = mapPoint(end, true);
      return { start: mappedStart, end: Math.max(mappedStart, mappedEnd) };
    },
  };
}

function iou(a: RangeOrNull, b: RangeOrNull): number {
  const interStart = Math.max(a.start, b.start);
  const interEnd = Math.min(a.end, b.end);
  const inter = Math.max(0, interEnd - interStart);
  const union = a.end - a.start + (b.end - b.start) - inter;
  if (union <= 0) return inter <= 0 ? 1 : 0;
  return inter / union;
}

export interface GateGRow {
  edits: number;
  correct: number;
  orphaned: number;
  misAnchored: number;
  total: number;
}

export function runGateGDetailed(): { rows: GateGRow[]; pass: boolean } {
  const corpus = loadCorpus();
  const rows: GateGRow[] = [];

  for (const editCount of [0, 1, 3, 10]) {
    const rnd = mulberry32(42 + editCount);
    const originalDoc = seedDoc(DOC_ID, corpus, "A", AUTHOR);
    const originalText = docPlainText(originalDoc).text;

    const phrases = pickPhrases(originalText, COMMENT_COUNT, rnd);
    const ids = phrases.map((p, i) =>
      addComment(originalDoc, p.start, p.end, `comment ${i}`, { userId: "srv", name: "server" })
    );

    const editedMarkdown = makeRandomEdits(corpus, editCount, rnd);
    const report = reseed(originalDoc, DOC_ID, editedMarkdown, `A-edit${editCount}`, AUTHOR);
    const editedText = docPlainText(report.doc).text;
    const mapper = buildDiffMapper(originalText, editedText);

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

    rows.push({ edits: editCount, correct, orphaned, misAnchored, total: ids.length });
  }

  const unchangedRow = rows[0];
  const oneEditRow = rows[1];
  const pass = unchangedRow.correct === unchangedRow.total && oneEditRow.misAnchored === 0;
  return { rows, pass };
}

export function runGateG(): GateResult {
  const { rows, pass } = runGateGDetailed();
  const detail = rows
    .map(
      (r) =>
        `edits=${r.edits}: correct=${r.correct}/${r.total} orphaned=${r.orphaned} misAnchored=${r.misAnchored}`
    )
    .join("; ");
  return {
    name: "G: re-seed anchoring (100% unchanged, zero mis-anchored under 1 edit; 3/10 reported)",
    pass,
    detail,
  };
}
