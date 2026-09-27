// Brief 03 task 5. Comment store in the `comments` map, with the D3 anchor
// record (CRDT relative position pair plus quote selectors) and S2-9's
// fuzzy-match acceptance rule. Origin: spike 2's `comments.ts`
// (collab-stack-yjs13-hocuspocus, branch spike/2026-09-27-collab-stack,
// commit eeb3fe2, src/rebase/comments.ts -- itself spike 2's, with the
// orchestrator's post-gate-G2 fuzzy-match revision already folded in, see
// that file's own comments). The scoring/acceptance logic
// (`fuzzyAnchor`/`contextOnlyAnchor`/similarity helpers) is copied
// essentially verbatim -- it is plain string code, schema-agnostic already
// -- retargeted from spike 2's own `Y.RelativePosition`/`docPlainText`
// plumbing to this spike's crdt anchors (`textProjection`/`anchorAt`/
// `resolveAnchor`, brief 03 task 1), which is the "plain-text projection ...
// defined once in src/crdt/ and used consistently by anchor creation, fuzzy
// matching and resolution" the brief asks for.
import search from 'approx-string-match';
import { textProjection, anchorAt, resolveAnchor, getMeta, setMeta, listMetaEntries, type CrdtDoc } from '../crdt/index.js';

export const COMMENTS_MAP = 'comments';

export interface CommentAuthor {
  userId: string;
  name: string;
}

export interface QuoteSelector {
  exact: string;
  prefix: string;
  suffix: string;
}

export interface Reply {
  body: string;
  author: CommentAuthor;
  at: number;
}

export interface CommentRecord {
  id: string;
  author: CommentAuthor;
  body: string;
  /** Opaque anchors from crdt's `anchorAt` (assoc 0 / assoc -1). */
  start: string;
  end: string;
  quote: QuoteSelector;
  pos: { start: number; end: number };
  replies: Reply[];
  resolved: boolean;
  resolvedBy?: string;
  createdAt: number;
}

export type AnchorMethod = 'crdt' | 'fuzzy' | 'orphaned';

export interface ResolvedAnchor {
  method: AnchorMethod;
  from?: number;
  to?: number;
  quote: QuoteSelector;
}

export interface ListedComment {
  id: string;
  body: string;
  author: CommentAuthor;
  replies: Reply[];
  resolved: boolean;
  anchor: ResolvedAnchor;
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

let commentCounter = 0;

/** A fresh id for a new comment. Not deterministic; comments are keyed by this id going forward. */
export function newCommentId(): string {
  commentCounter += 1;
  return `cmt-${Date.now().toString(36)}-${commentCounter}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

/** Minimum score lead over the best non-overlapping alternative (score scale: quote 50, prefix 20, suffix 20, position 2). */
const AMBIGUITY_MARGIN = 8;
/** Quotes at least this long may anchor without context agreement when unique. */
const MIN_STANDALONE_QUOTE = 24;
/** Required similarity of the better of prefix or suffix for a quote match. */
const MIN_CONTEXT_SIM = 0.5;
/** Context-only anchoring needs this similarity on both sides. */
const MIN_CONTEXT_ONLY_SIM = 0.75;

function countNear(matches: Array<{ start: number; end: number; errors: number }>, best: { start: number; end: number }): number {
  let n = 0;
  let lastEnd = -1;
  for (const m of [...matches].sort((a, b) => a.start - b.start)) {
    if (m.start >= lastEnd) n++;
    lastEnd = Math.max(lastEnd, m.end);
  }
  return n;
}

function contextSimilarity(actual: string, stored: string, side: 'prefix' | 'suffix'): number {
  if (stored.length === 0) return actual.length === 0 ? 1 : 0.5;
  const a = side === 'prefix' ? actual.slice(-stored.length) : actual.slice(0, stored.length);
  return charSimilarity(a, stored);
}

function contextOnlyAnchor(text: string, quote: QuoteSelector, approxPos: number): { start: number; end: number; quoteSim: number } | null {
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

/**
 * Search `text` for `quote`, scoring candidates Hypothesis-style (quote
 * similarity weight 50, prefix 20, suffix 20, position proximity 2 against
 * `approxPos`), and accept the best candidate only if its context agrees or
 * it is long and unique enough to stand on its own (S2-9's acceptance
 * rule). Otherwise try a context-only match (prefix and suffix both found
 * close together: the quote was edited in place). Otherwise `null`
 * (orphaned).
 */
export function fuzzyAnchor(text: string, quote: QuoteSelector, approxPos: number): { start: number; end: number; quoteSim: number } | null {
  const exact = quote.exact;
  if (exact.length === 0) return null;
  const maxErrors = Math.min(64, Math.ceil(0.25 * exact.length));
  const matches = search(text, exact, maxErrors);
  if (matches.length === 0) return contextOnlyAnchor(text, quote, approxPos);

  let best: { start: number; end: number; quoteSim: number; ctxSim: number; score: number } | null = null;
  const strong = matches.filter((m) => m.errors <= maxErrors);
  const scored: Array<{ start: number; end: number; score: number }> = [];
  for (const m of strong) {
    const quoteSim = 1 - m.errors / Math.max(exact.length, 1);
    const prefixSim = contextSimilarity(text.slice(Math.max(0, m.start - PREFIX_SUFFIX_LEN), m.start), quote.prefix, 'prefix');
    const suffixSim = contextSimilarity(text.slice(m.end, m.end + PREFIX_SUFFIX_LEN), quote.suffix, 'suffix');
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
    const runnerUp = Math.max(-Infinity, ...scored.filter((c) => c.end <= b.start || c.start >= b.end).map((c) => c.score));
    const ambiguous = best.score - runnerUp < AMBIGUITY_MARGIN;
    if (!ambiguous && (best.ctxSim >= MIN_CONTEXT_SIM || distinctive)) {
      return { start: best.start, end: best.end, quoteSim: best.quoteSim };
    }
  }
  return contextOnlyAnchor(text, quote, approxPos);
}

function nthIndexOf(text: string, needle: string, occurrence: number): number {
  let idx = -1;
  for (let i = 0; i <= occurrence; i++) {
    idx = text.indexOf(needle, idx + 1);
    if (idx < 0) return -1;
  }
  return idx;
}

export interface CreateCommentOptions {
  from: number;
  to: number;
  body: string;
  author: CommentAuthor;
}

/** Anchor a new comment on `[from, to)` of `textProjection(doc)`. Stores a CRDT relative-position pair (assoc 0 / assoc -1, via crdt's anchorAt) plus quote selectors and the offsets at creation time. */
export function createComment(doc: CrdtDoc, opts: CreateCommentOptions): string {
  const text = textProjection(doc);
  if (opts.from < 0 || opts.to > text.length || opts.from > opts.to) {
    throw new Error(`createComment: range [${opts.from}, ${opts.to}) out of bounds (doc length ${text.length})`);
  }
  const start = anchorAt(doc, opts.from, 0);
  const end = anchorAt(doc, opts.to, -1);
  const quote = buildQuoteSelectors(text, opts.from, opts.to);
  const id = newCommentId();
  const record: CommentRecord = {
    id,
    author: opts.author,
    body: opts.body,
    start,
    end,
    quote,
    pos: { start: opts.from, end: opts.to },
    replies: [],
    resolved: false,
    createdAt: Date.now(),
  };
  setMeta(doc, COMMENTS_MAP, id, record);
  return id;
}

export interface CreateCommentOnQuoteOptions {
  body: string;
  author: CommentAuthor;
  /** Zero-based: the Nth occurrence of `quote` in `textProjection(doc)` (default 0, the first). For tests/tools that address a comment by its text rather than an offset. */
  occurrence?: number;
}

/** Convenience for tests/tools: anchor a new comment on the `occurrence`-th (default 0) exact occurrence of `quote` in the document's current plain text. */
export function createCommentOnQuote(doc: CrdtDoc, quote: string, opts: CreateCommentOnQuoteOptions): string {
  const text = textProjection(doc);
  const idx = nthIndexOf(text, quote, opts.occurrence ?? 0);
  if (idx < 0) throw new Error(`createCommentOnQuote: quote not found (occurrence ${opts.occurrence ?? 0}): ${JSON.stringify(quote)}`);
  return createComment(doc, { from: idx, to: idx + quote.length, body: opts.body, author: opts.author });
}

function getRecord(doc: CrdtDoc, id: string): CommentRecord {
  const record = getMeta<CommentRecord>(doc, COMMENTS_MAP, id);
  if (!record) throw new Error(`no such comment: ${id}`);
  return record;
}

export function getComment(doc: CrdtDoc, id: string): CommentRecord | undefined {
  return getMeta<CommentRecord>(doc, COMMENTS_MAP, id);
}

export function reply(doc: CrdtDoc, id: string, opts: { body: string; author: CommentAuthor }): void {
  const record = getRecord(doc, id);
  const updated: CommentRecord = { ...record, replies: [...record.replies, { body: opts.body, author: opts.author, at: Date.now() }] };
  setMeta(doc, COMMENTS_MAP, id, updated);
}

/** Named `setResolved` (not `resolveComment`) to avoid clashing with anchor resolution (crdt's `resolveAnchor`, this module's own resolution of a comment's CURRENT position). */
export function setResolved(doc: CrdtDoc, id: string, user: string, resolved = true): void {
  const record = getRecord(doc, id);
  setMeta(doc, COMMENTS_MAP, id, { ...record, resolved, resolvedBy: resolved ? user : undefined });
}

function resolveOne(doc: CrdtDoc, record: CommentRecord, text: string): ResolvedAnchor {
  const from = resolveAnchor(doc, record.start);
  const to = resolveAnchor(doc, record.end);
  if (from !== null && to !== null && from < to) {
    return { method: 'crdt', from, to, quote: record.quote };
  }
  const anchored = fuzzyAnchor(text, record.quote, record.pos.start);
  if (!anchored) return { method: 'orphaned', quote: record.quote };
  return { method: 'fuzzy', from: anchored.start, to: anchored.end, quote: record.quote };
}

/** Every comment, each resolved to its current position (CRDT, fuzzy, or orphaned -- S2-9's acceptance rule) as of `doc`'s current state. */
export function listComments(doc: CrdtDoc): ListedComment[] {
  const text = textProjection(doc);
  const out: ListedComment[] = [];
  for (const [, record] of listMetaEntries<CommentRecord>(doc, COMMENTS_MAP)) {
    out.push({
      id: record.id,
      body: record.body,
      author: record.author,
      replies: record.replies,
      resolved: record.resolved,
      anchor: resolveOne(doc, record, text),
    });
  }
  return out;
}
