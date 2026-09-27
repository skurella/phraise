// Comments with CRDT plus selector anchoring (plan section 6).
import * as Y from "yjs";
import search from "approx-string-match";
import { docPlainText, offsetToPosition } from "./text.js";
import { hash32 } from "./ids.js";

export const COMMENTS_MAP = "comments";

export interface CommentAuthor {
  userId: string;
  name: string;
}

export interface QuoteSelector {
  exact: string;
  prefix: string;
  suffix: string;
}

export interface CommentRecord {
  id: string;
  author: CommentAuthor;
  body: string;
  start: unknown; // RelativePosition JSON, assoc 0
  end: unknown; // RelativePosition JSON, assoc -1
  quote: QuoteSelector;
  pos: { start: number; end: number };
  resolved?: boolean;
}

export type ResolveMethod = "crdt" | "fuzzy" | "orphaned";

export interface ResolvedRange {
  method: ResolveMethod;
  text?: string;
  start?: number;
  end?: number;
  score?: number;
  quote?: QuoteSelector;
}

const PREFIX_SUFFIX_LEN = 32;

export function buildQuoteSelectors(text: string, start: number, end: number): QuoteSelector {
  return {
    exact: text.slice(start, end),
    prefix: text.slice(Math.max(0, start - PREFIX_SUFFIX_LEN), start),
    suffix: text.slice(end, end + PREFIX_SUFFIX_LEN),
  };
}

function levenshtein(a: string, b: string): number {
  const n = a.length;
  const m = b.length;
  if (n === 0) return m;
  if (m === 0) return n;
  let prev = new Array(m + 1);
  let curr = new Array(m + 1);
  for (let j = 0; j <= m; j++) prev[j] = j;
  for (let i = 1; i <= n; i++) {
    curr[0] = i;
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[m];
}

function charSimilarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length, 1);
  return 1 - levenshtein(a, b) / maxLen;
}

/** Generate a fresh id for a new comment. Not deterministic; comments are keyed by this id going forward. */
export function newCommentId(seedText: string): string {
  return `cmt-${hash32(`${seedText}:${Math.random()}:${Date.now()}`)}-${Math.floor(
    Math.random() * 1e9
  )}`;
}

/**
 * Anchor a new comment on [fromOffset, toOffset) of docPlainText(doc).text.
 * Stores a CRDT RelativePosition pair (assoc 0 / assoc -1) plus quote
 * selectors (exact, 32-char prefix/suffix) and the offsets at creation time.
 */
export function addComment(
  doc: Y.Doc,
  fromOffset: number,
  toOffset: number,
  body: string,
  author: CommentAuthor
): string {
  const { text, segments } = docPlainText(doc);
  const startPos = offsetToPosition(segments, fromOffset);
  const endPos = offsetToPosition(segments, toOffset);
  if (!startPos || !endPos) {
    throw new Error(`addComment: range [${fromOffset}, ${toOffset}) out of bounds`);
  }
  const startRel = Y.createRelativePositionFromTypeIndex(startPos.xmlText, startPos.index, 0);
  const endRel = Y.createRelativePositionFromTypeIndex(endPos.xmlText, endPos.index, -1);
  const quote = buildQuoteSelectors(text, fromOffset, toOffset);
  const id = newCommentId(quote.exact);
  const record: CommentRecord = {
    id,
    author,
    body,
    start: Y.relativePositionToJSON(startRel),
    end: Y.relativePositionToJSON(endRel),
    quote,
    pos: { start: fromOffset, end: toOffset },
  };
  doc.transact(() => {
    doc.getMap(COMMENTS_MAP).set(id, record);
  }, "comment");
  return id;
}

function mapXmlTextRangeToGlobal(
  doc: Y.Doc,
  xmlText: Y.XmlText,
  startIdx: number,
  endIdx: number
): { start: number; end: number } {
  const { segments } = docPlainText(doc);
  const seg = segments.find((s) => s.xmlText === xmlText);
  if (!seg) return { start: -1, end: -1 };
  return { start: seg.start + startIdx, end: seg.start + endIdx };
}

/**
 * Search `text` for `quote`, scoring candidates Hypothesis-style (quote
 * similarity weight 50, prefix 20, suffix 20, position proximity 2 against
 * `approxPos`), and accept the best candidate only if its quote similarity
 * is at least 0.75. Shared by `resolveComment`'s fuzzy fallback and
 * `reseed`'s selector-only anchoring.
 */
export function fuzzyAnchor(
  text: string,
  quote: QuoteSelector,
  approxPos: number
): { start: number; end: number; quoteSim: number } | null {
  const exact = quote.exact;
  if (exact.length === 0) return null;
  const maxErrors = Math.min(64, Math.ceil(0.25 * exact.length));
  const matches = search(text, exact, maxErrors);
  if (matches.length === 0) return null;

  let best: { start: number; end: number; quoteSim: number; score: number } | null = null;
  for (const m of matches) {
    const quoteSim = 1 - m.errors / Math.max(exact.length, 1);
    const prefixSim = charSimilarity(
      text.slice(Math.max(0, m.start - PREFIX_SUFFIX_LEN), m.start),
      quote.prefix
    );
    const suffixSim = charSimilarity(text.slice(m.end, m.end + PREFIX_SUFFIX_LEN), quote.suffix);
    const posProximity = Math.max(0, 1 - Math.abs(m.start - approxPos) / Math.max(text.length, 1));
    const score = quoteSim * 50 + prefixSim * 20 + suffixSim * 20 + posProximity * 2;
    if (!best || score > best.score) {
      best = { start: m.start, end: m.end, quoteSim, score };
    }
  }
  if (!best || best.quoteSim < 0.75) return null;
  return { start: best.start, end: best.end, quoteSim: best.quoteSim };
}

function fuzzyResolve(doc: Y.Doc, record: CommentRecord): ResolvedRange {
  const { text } = docPlainText(doc);
  const anchored = fuzzyAnchor(text, record.quote, record.pos.start);
  if (!anchored) return { method: "orphaned", quote: record.quote };
  return {
    method: "fuzzy",
    text: text.slice(anchored.start, anchored.end),
    start: anchored.start,
    end: anchored.end,
    score: anchored.quoteSim,
  };
}

function resolveRecord(doc: Y.Doc, record: CommentRecord): ResolvedRange {
  // A re-seeded comment that failed to anchor by selectors has no CRDT
  // position at all (see reseed.ts); go straight to the fuzzy fallback.
  if (record.start == null || record.end == null) {
    return fuzzyResolve(doc, record);
  }
  const startRel = Y.createRelativePositionFromJSON(record.start as any);
  const endRel = Y.createRelativePositionFromJSON(record.end as any);
  const startAbs = Y.createAbsolutePositionFromRelativePosition(startRel, doc);
  const endAbs = Y.createAbsolutePositionFromRelativePosition(endRel, doc);
  if (startAbs && endAbs && startAbs.type === endAbs.type && startAbs.index < endAbs.index) {
    const xmlText = startAbs.type as Y.XmlText;
    const delta = xmlText.toDelta() as any[];
    const plain = delta.map((d) => d.insert).join("");
    const text = plain.slice(startAbs.index, endAbs.index);
    const { start, end } = mapXmlTextRangeToGlobal(doc, xmlText, startAbs.index, endAbs.index);
    return { method: "crdt", text, start, end };
  }
  return fuzzyResolve(doc, record);
}

/** Resolve one comment. Pure function of the doc's current state. */
export function resolveComment(doc: Y.Doc, id: string): ResolvedRange {
  const record = doc.getMap(COMMENTS_MAP).get(id) as CommentRecord | undefined;
  if (!record) throw new Error(`resolveComment: no such comment ${id}`);
  return resolveRecord(doc, record);
}

export function getComment(doc: Y.Doc, id: string): CommentRecord | undefined {
  return doc.getMap(COMMENTS_MAP).get(id) as CommentRecord | undefined;
}

export function listComments(doc: Y.Doc): CommentRecord[] {
  const out: CommentRecord[] = [];
  doc.getMap(COMMENTS_MAP).forEach((v) => out.push(v as CommentRecord));
  return out;
}

/** Resolve every comment in the doc. */
export function resolveAll(doc: Y.Doc): Map<string, ResolvedRange> {
  const out = new Map<string, ResolvedRange>();
  doc.getMap(COMMENTS_MAP).forEach((v, id) => {
    out.set(id, resolveRecord(doc, v as CommentRecord));
  });
  return out;
}

