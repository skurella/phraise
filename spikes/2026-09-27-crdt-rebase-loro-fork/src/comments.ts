// Comments with CRDT plus selector anchoring (plan section 6), Loro version.
// `fuzzyAnchor` (the Hypothesis-style scored fuzzy match + context-only
// fallback, including its ambiguity guard) is copied verbatim from
// spikes/2026-09-27-crdt-rebase-yjs-fork/src/comments.ts: it is pure string
// matching over `docPlainText`'s output and has no CRDT dependency at all.
// The CRDT half is rewritten: Loro's `LoroText.getCursor(pos, side)` +
// `doc.getCursorPos(cursor)` replace Yjs's `RelativePosition`/
// `AbsolutePosition`. A `Cursor` is a small opaque handle
// (`cursor.encode()`/`Cursor.decode()`, ~9 bytes for a short doc) bound to a
// specific character in a specific container; `getCursorPos` returns the
// live offset within that container (or `undefined` if the container/
// position no longer resolves), which we then map back to a global
// doc-plain-text offset via `docPlainText`'s segments, matched by container
// id (Loro containers don't retain reference identity across
// `getContainerById` calls -- compare `.id` strings instead, see README).
import { LoroDoc, Cursor, type Side } from "loro-crdt";
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
  start: string | null; // base64 Cursor.encode(), side 0
  end: string | null; // base64 Cursor.encode(), side -1
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

export function newCommentId(seedText: string): string {
  return `cmt-${hash32(`${seedText}:${Math.random()}:${Date.now()}`)}-${Math.floor(
    Math.random() * 1e9
  )}`;
}

function base64ToUint8(str: string): Uint8Array {
  return new Uint8Array(Buffer.from(str, "base64"));
}
function uint8ToBase64(arr: Uint8Array): string {
  return Buffer.from(arr).toString("base64");
}

/**
 * Anchor a new comment on [fromOffset, toOffset) of docPlainText(doc).text.
 * Stores a Loro Cursor pair (side 0 / side -1, base64-encoded) plus quote
 * selectors (exact, 32-char prefix/suffix) and the offsets at creation time.
 */
export function addComment(
  doc: LoroDoc,
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
  const startCursor = startPos.loroText.getCursor(startPos.index, 0);
  const endCursor = endPos.loroText.getCursor(endPos.index, -1 as Side);
  const quote = buildQuoteSelectors(text, fromOffset, toOffset);
  const id = newCommentId(quote.exact);
  const record: CommentRecord = {
    id,
    author,
    body,
    start: startCursor ? uint8ToBase64(startCursor.encode()) : null,
    end: endCursor ? uint8ToBase64(endCursor.encode()) : null,
    quote,
    pos: { start: fromOffset, end: toOffset },
  };
  doc.getMap(COMMENTS_MAP).set(id, record);
  doc.commit({ origin: "comment" });
  return id;
}

/**
 * Search `text` for `quote`, scoring candidates Hypothesis-style (quote
 * similarity weight 50, prefix 20, suffix 20, position proximity 2 against
 * `approxPos`), and accept the best candidate only if its quote similarity
 * is at least 0.75 AND its context agrees (or the quote is long and
 * unambiguous), else fall back to a context-only match, else null (orphan).
 * Copied verbatim from the Yjs fork's comments.ts (orchestrator revision,
 * 2026-09-27): pure string matching, no CRDT dependency.
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

  let best: { start: number; end: number; quoteSim: number; ctxSim: number; score: number } | null = null;
  const strong = matches.filter((m) => m.errors <= maxErrors);
  const scored: Array<{ start: number; end: number; score: number }> = [];
  for (const m of strong) {
    const quoteSim = 1 - m.errors / Math.max(exact.length, 1);
    const prefixSim = contextSimilarity(
      text.slice(Math.max(0, m.start - PREFIX_SUFFIX_LEN), m.start),
      quote.prefix,
      "prefix"
    );
    const suffixSim = contextSimilarity(text.slice(m.end, m.end + PREFIX_SUFFIX_LEN), quote.suffix, "suffix");
    const posProximity = Math.max(0, 1 - Math.abs(m.start - approxPos) / Math.max(text.length, 1));
    const score = quoteSim * 50 + prefixSim * 20 + suffixSim * 20 + posProximity * 2;
    scored.push({ start: m.start, end: m.end, score });
    if (!best || score > best.score) {
      best = { start: m.start, end: m.end, quoteSim, ctxSim: Math.max(prefixSim, suffixSim), score };
    }
  }
  if (best && best.quoteSim >= 0.75) {
    const distinctive = exact.length >= MIN_STANDALONE_QUOTE && countNear(strong, best) === 1;
    const b = best;
    const runnerUp = Math.max(
      -Infinity,
      ...scored.filter((c) => c.end <= b.start || c.start >= b.end).map((c) => c.score)
    );
    const ambiguous = best.score - runnerUp < AMBIGUITY_MARGIN;
    if (!ambiguous && (best.ctxSim >= MIN_CONTEXT_SIM || distinctive)) {
      return { start: best.start, end: best.end, quoteSim: best.quoteSim };
    }
  }
  return contextOnlyAnchor(text, quote, approxPos);
}

const AMBIGUITY_MARGIN = 8;
const MIN_STANDALONE_QUOTE = 24;
const MIN_CONTEXT_SIM = 0.5;
const MIN_CONTEXT_ONLY_SIM = 0.75;

function countNear(
  matches: Array<{ start: number; end: number; errors: number }>,
  best: { start: number; end: number }
): number {
  let n = 0;
  let lastEnd = -1;
  for (const m of [...matches].sort((a, b) => a.start - b.start)) {
    if (m.start >= lastEnd) n++;
    lastEnd = Math.max(lastEnd, m.end);
  }
  return n;
}

function contextSimilarity(actual: string, stored: string, side: "prefix" | "suffix"): number {
  if (stored.length === 0) return actual.length === 0 ? 1 : 0.5;
  const a = side === "prefix" ? actual.slice(-stored.length) : actual.slice(0, stored.length);
  return charSimilarity(a, stored);
}

function contextOnlyAnchor(
  text: string,
  quote: QuoteSelector,
  approxPos: number
): { start: number; end: number; quoteSim: number } | null {
  const pre = quote.prefix.slice(-16);
  const suf = quote.suffix.slice(0, 16);
  if (pre.length < 8 || suf.length < 8) return null;
  const preMatches = search(text, pre, Math.floor(pre.length * (1 - MIN_CONTEXT_ONLY_SIM)));
  if (preMatches.length === 0) return null;
  const maxGap = quote.exact.length * 2 + 16;
  let best: { start: number; end: number; score: number } | null = null;
  for (const p of preMatches) {
    const window = text.slice(p.end, p.end + maxGap + suf.length);
    const sufMatches = search(window, suf, Math.floor(suf.length * (1 - MIN_CONTEXT_ONLY_SIM)));
    for (const s of sufMatches) {
      const start = p.end;
      const end = p.end + s.start;
      if (end <= start) continue;
      const errs = p.errors + s.errors;
      const posProximity = Math.max(0, 1 - Math.abs(start - approxPos) / Math.max(text.length, 1));
      const lenPenalty = Math.abs(end - start - quote.exact.length) / Math.max(quote.exact.length, 1);
      const score = -errs * 10 - lenPenalty * 5 + posProximity * 2;
      if (!best || score > best.score) best = { start, end, score };
    }
  }
  if (!best) return null;
  const quoteSim = charSimilarity(text.slice(best.start, best.end), quote.exact);
  return { start: best.start, end: best.end, quoteSim };
}

function fuzzyResolve(doc: LoroDoc, record: CommentRecord): ResolvedRange {
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

function resolveRecord(doc: LoroDoc, record: CommentRecord): ResolvedRange {
  if (record.start == null || record.end == null) {
    return fuzzyResolve(doc, record);
  }
  const startCursor = Cursor.decode(base64ToUint8(record.start));
  const endCursor = Cursor.decode(base64ToUint8(record.end));
  const startRes = doc.getCursorPos(startCursor);
  const endRes = doc.getCursorPos(endCursor);
  if (
    startRes &&
    endRes &&
    startCursor.containerId() === endCursor.containerId() &&
    startRes.offset < endRes.offset
  ) {
    const { segments } = docPlainText(doc);
    const seg = segments.find((s) => s.loroText && s.loroText.id === startCursor.containerId());
    if (seg) {
      const text = seg.text.slice(startRes.offset, endRes.offset);
      return {
        method: "crdt",
        text,
        start: seg.start + startRes.offset,
        end: seg.start + endRes.offset,
      };
    }
  }
  return fuzzyResolve(doc, record);
}

/** Resolve one comment. Pure function of the doc's current state. */
export function resolveComment(doc: LoroDoc, id: string): ResolvedRange {
  const record = doc.getMap(COMMENTS_MAP).get(id) as CommentRecord | undefined;
  if (!record) throw new Error(`resolveComment: no such comment ${id}`);
  return resolveRecord(doc, record);
}

export function getComment(doc: LoroDoc, id: string): CommentRecord | undefined {
  return doc.getMap(COMMENTS_MAP).get(id) as CommentRecord | undefined;
}

export function listComments(doc: LoroDoc): CommentRecord[] {
  const out: CommentRecord[] = [];
  for (const [, v] of doc.getMap(COMMENTS_MAP).entries()) out.push(v as unknown as CommentRecord);
  return out;
}

/** Resolve every comment in the doc. */
export function resolveAll(doc: LoroDoc): Map<string, ResolvedRange> {
  const out = new Map<string, ResolvedRange>();
  for (const [id, v] of doc.getMap(COMMENTS_MAP).entries()) {
    out.set(id, resolveRecord(doc, v as unknown as CommentRecord));
  }
  return out;
}
