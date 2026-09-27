// Brief 06 (comments, gate F), tasks 1/2/6: the anchor record (D3, as
// amended after spike 2) and its resolution order: CRDT relative position,
// then a quote-selector fuzzy match, then orphaned.
//
// The fuzzy-matching algorithm (scoring weights, the ambiguity guard, the
// context-only fallback) is ported from spike 2's `src/rebase/comments.ts`
// (`origin/spike/2026-09-27-collab-stack` at `eeb3fe2`,
// `fuzzyAnchor`/`contextOnlyAnchor`/`contextSimilarity`/`levenshtein`/
// `charSimilarity`), which itself carries the lead's post-gate-G2 revision
// (see the architecture decisions doc, "D3: the comment anchor record is
// fixed"). It is not a byte-for-byte copy: spike 2 resolved offsets
// through its own `docPlainText`/`offsetToPosition` (one `Y.XmlText` per
// textblock, guaranteed by its toy schema); this port resolves them through
// `textProjection.ts`'s PM-`Node`-tree projection instead, and positions
// are PM positions, not raw `Y.XmlText` character indices -- see that
// file's own comment for why.
import * as Y from 'yjs';
import type { Node as PMNode } from 'prosemirror-model';
import search from 'approx-string-match';
import { absolutePositionToRelativePosition, relativePositionToAbsolutePosition, initProseMirrorDoc } from '@tiptap/y-tiptap';
import { schema } from '../model/schema.js';
import { FRAGMENT_NAME } from '../model/yjs.js';
import { projectDocText, offsetToPos, posToOffset, type DocTextProjection } from './textProjection.js';

export interface QuoteSelector {
  exact: string;
  prefix: string;
  suffix: string;
}

/** A CRDT position pair (assoc 0 / assoc -1, as JSON via
 * `Y.relativePositionToJSON`) plus the D3 quote selector and the character
 * offsets at creation time. Stored verbatim as a thread's `anchor` field
 * (`model.ts`); never mutated in place -- a fuzzy re-anchor is ephemeral
 * (recomputed on every resolution), matching spike 2's `resolveComment`. */
export interface AnchorRecord {
  start: unknown;
  end: unknown;
  quote: QuoteSelector;
  offsetStart: number;
  offsetEnd: number;
}

const PREFIX_SUFFIX_LEN = 32;

export function buildQuoteSelectors(text: string, start: number, end: number): QuoteSelector {
  return {
    exact: text.slice(start, end),
    prefix: text.slice(Math.max(0, start - PREFIX_SUFFIX_LEN), start),
    suffix: text.slice(end, end + PREFIX_SUFFIX_LEN),
  };
}

/** Everything anchor building/resolution needs: the Y fragment + its live
 * ProsemirrorMapping, and a plain-text projection of the corresponding PM
 * doc. Built two ways:
 *  - `contextFromYDoc`: headless, via `@tiptap/y-tiptap`'s own
 *    `initProseMirrorDoc` -- no EditorView, no DOM. Used by unit tests and
 *    anywhere else only a `Y.Doc` is at hand.
 *  - live, in `web/src/comments/liveContext.ts`: from the editor's own
 *    `ySyncPlugin` binding's `doc`/`type`/`mapping` (the same fields
 *    `src/collab/workarounds/localCaretFollow.ts` reads) and the editor's
 *    current `EditorState.doc` -- "resolve through the binding's mapping",
 *    literally.
 * Both shapes are structurally identical, so `buildAnchorRecord`/
 * `resolveAnchor` below don't need to know or care which one they were
 * given. */
export interface AnchoringContext {
  ydoc: Y.Doc;
  fragment: Y.XmlFragment;
  mapping: Parameters<typeof relativePositionToAbsolutePosition>[3];
  doc: PMNode;
  /** Computed once when the context is built (see `buildContext` below), not
   * cached globally -- a caller resolving several threads against the same
   * document snapshot builds the context once and reuses it, and a
   * subsequent document change means building a new context, not mutating
   * this one. */
  projection: DocTextProjection;
}

function buildContext(ydoc: Y.Doc, fragment: Y.XmlFragment, mapping: AnchoringContext['mapping'], doc: PMNode): AnchoringContext {
  return { ydoc, fragment, mapping, doc, projection: projectDocText(doc) };
}

/** Headless context: rebuilds a fresh PM doc + mapping from the current Y
 * state via `initProseMirrorDoc`. Cheap enough at spike scale to call once
 * per resolution rather than maintain incrementally (no live binding
 * exists in this path -- there is no EditorView to maintain one). */
export function contextFromYDoc(ydoc: Y.Doc): AnchoringContext {
  const fragment = ydoc.getXmlFragment(FRAGMENT_NAME);
  const { doc, mapping } = initProseMirrorDoc(fragment, schema);
  return buildContext(ydoc, fragment, mapping, doc);
}

/** Live context: from the editor's own `ySyncPlugin` binding's `doc` (a
 * `Y.Doc`), `type` (the bound `Y.XmlFragment`) and `mapping`, plus the
 * editor's current `EditorState.doc` -- see `web/src/comments/
 * liveContext.ts`, which reads those three binding fields the same way
 * `src/collab/workarounds/localCaretFollow.ts` already does. Exported here
 * (rather than duplicated) so both call sites share one constructor. */
export function contextFromBinding(ydoc: Y.Doc, fragment: Y.XmlFragment, mapping: AnchoringContext['mapping'], doc: PMNode): AnchoringContext {
  return buildContext(ydoc, fragment, mapping, doc);
}

/** Build a fresh anchor record for the PM range `[fromPos, toPos)` (a plain
 * text selection; see the brief's "not in scope" note on comments spanning
 * two blocks beyond what falls out naturally -- this builds whatever
 * quote/offsets the range actually has, including a `BLOCK_SEPARATOR`
 * inside `quote.exact` if the selection does cross a block boundary). */
export function buildAnchorRecord(ctx: AnchoringContext, fromPos: number, toPos: number): AnchorRecord {
  const projection = ctx.projection;
  const offsetStart = posToOffset(projection, fromPos);
  const offsetEnd = posToOffset(projection, toPos);
  if (offsetStart == null || offsetEnd == null || offsetEnd <= offsetStart) {
    throw new Error(`buildAnchorRecord: range [${fromPos}, ${toPos}) does not resolve to inline text`);
  }
  const startRel = absolutePositionToRelativePosition(fromPos, ctx.fragment, ctx.mapping);
  const endRel = absolutePositionToRelativePosition(toPos, ctx.fragment, ctx.mapping);
  return {
    start: Y.relativePositionToJSON(startRel),
    end: Y.relativePositionToJSON(endRel),
    quote: buildQuoteSelectors(projection.text, offsetStart, offsetEnd),
    offsetStart,
    offsetEnd,
  };
}

export type ResolveMethod = 'crdt' | 'fuzzy' | 'orphaned';

export interface ResolvedRange {
  method: ResolveMethod;
  /** PM positions, present for 'crdt' and 'fuzzy'. */
  start?: number;
  end?: number;
  /** Fuzzy match's quote similarity (0..1), present only for 'fuzzy'. */
  score?: number;
}

/** Resolve one anchor record against the current document: CRDT relative
 * position first; if that range has collapsed or cannot be resolved, the
 * quote-selector fuzzy match; if that also fails, orphaned. */
export function resolveAnchor(ctx: AnchoringContext, anchor: AnchorRecord): ResolvedRange {
  const startRel = Y.createRelativePositionFromJSON(anchor.start as ReturnType<typeof Y.relativePositionToJSON>);
  const endRel = Y.createRelativePositionFromJSON(anchor.end as ReturnType<typeof Y.relativePositionToJSON>);
  const startPos = relativePositionToAbsolutePosition(ctx.ydoc, ctx.fragment, startRel, ctx.mapping);
  const endPos = relativePositionToAbsolutePosition(ctx.ydoc, ctx.fragment, endRel, ctx.mapping);
  if (startPos != null && endPos != null && startPos < endPos) {
    return { method: 'crdt', start: startPos, end: endPos };
  }
  return fuzzyResolve(ctx, anchor);
}

function fuzzyResolve(ctx: AnchoringContext, anchor: AnchorRecord): ResolvedRange {
  const projection = ctx.projection;
  const anchored = fuzzyAnchor(projection.text, anchor.quote, anchor.offsetStart);
  if (!anchored) return { method: 'orphaned' };
  const start = offsetToPos(projection, anchored.start);
  const end = offsetToPos(projection, anchored.end);
  if (start == null || end == null) return { method: 'orphaned' };
  return { method: 'fuzzy', start, end, score: anchored.quoteSim };
}

// --- Ported from spike 2's src/rebase/comments.ts (eeb3fe2), adapted to
// operate on this file's own plain-text projection. See this file's header
// comment for what changed and why. ---

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

/** Minimum score lead over the best non-overlapping alternative (score scale: quote 50, prefix 20, suffix 20, position 2). */
const AMBIGUITY_MARGIN = 8;
/** Quotes at least this long may anchor without context agreement when unique. */
const MIN_STANDALONE_QUOTE = 24;
/** Required similarity of the better of prefix or suffix for a quote match. */
const MIN_CONTEXT_SIM = 0.5;
/** Context-only anchoring needs this similarity on both sides. */
const MIN_CONTEXT_ONLY_SIM = 0.75;

function contextSimilarity(actual: string, stored: string, side: 'prefix' | 'suffix'): number {
  if (stored.length === 0) return actual.length === 0 ? 1 : 0.5;
  const a = side === 'prefix' ? actual.slice(-stored.length) : actual.slice(0, stored.length);
  return charSimilarity(a, stored);
}

function countNear(matches: Array<{ start: number; end: number; errors: number }>, best: { start: number; end: number }): number {
  let n = 0;
  let lastEnd = -1;
  for (const m of [...matches].sort((a, b) => a.start - b.start)) {
    if (m.start >= lastEnd) n++;
    lastEnd = Math.max(lastEnd, m.end);
  }
  return n;
}

/**
 * Fallback anchor when the quote itself no longer matches well enough: find
 * the stored prefix and suffix close together and anchor to whatever now
 * sits between them (the quoted text was edited in place).
 *
 * Brief 06 finding (not in spike 2's original, which never exercised this
 * path against two candidates at once): the original port scored each
 * prefix/suffix candidate on its own tiny scale (`-errors*10 -
 * lenPenalty*5 + posProximity*2`) and simply picked the best one, with no
 * guard against a second, equally plausible gap -- so two structurally
 * identical paragraphs (e.g. a duplicated section) each containing the
 * comment's own context would let a comment silently jump to the wrong
 * copy once the quoted text in one of them changes. Fixed by scoring every
 * candidate gap with the SAME weighted formula the quote-search path uses
 * (quote similarity of the gap's own text, prefix/suffix similarity,
 * position proximity) and applying the same `AMBIGUITY_MARGIN` guard
 * against the best non-overlapping alternative -- see
 * `test/comments/anchor.spec.ts`'s "rejects a match when a second,
 * non-overlapping location scores nearly as well" for the reproduction
 * (two verbatim-duplicate paragraphs, far enough apart that their 32-char
 * context windows never leak into each other) that exposed this.
 */
function contextOnlyAnchor(text: string, quote: QuoteSelector, approxPos: number): { start: number; end: number; quoteSim: number } | null {
  const pre = quote.prefix.slice(-16);
  const suf = quote.suffix.slice(0, 16);
  if (pre.length < 8 || suf.length < 8) return null;
  const preMatches = search(text, pre, Math.floor(pre.length * (1 - MIN_CONTEXT_ONLY_SIM)));
  if (preMatches.length === 0) return null;
  const maxGap = quote.exact.length * 2 + 16;
  const candidates: Array<{ start: number; end: number; score: number; quoteSim: number }> = [];
  for (const p of preMatches) {
    const window = text.slice(p.end, p.end + maxGap + suf.length);
    const sufMatches = search(window, suf, Math.floor(suf.length * (1 - MIN_CONTEXT_ONLY_SIM)));
    for (const s of sufMatches) {
      const start = p.end;
      const end = p.end + s.start;
      if (end <= start) continue;
      const quoteSim = charSimilarity(text.slice(start, end), quote.exact);
      const prefixSim = contextSimilarity(text.slice(Math.max(0, start - PREFIX_SUFFIX_LEN), start), quote.prefix, 'prefix');
      const suffixSim = contextSimilarity(text.slice(end, end + PREFIX_SUFFIX_LEN), quote.suffix, 'suffix');
      const posProximity = Math.max(0, 1 - Math.abs(start - approxPos) / Math.max(text.length, 1));
      const score = quoteSim * 50 + prefixSim * 20 + suffixSim * 20 + posProximity * 2;
      candidates.push({ start, end, score, quoteSim });
    }
  }
  if (candidates.length === 0) return null;
  let best = candidates[0];
  for (const c of candidates) if (c.score > best.score) best = c;
  const runnerUp = Math.max(-Infinity, ...candidates.filter((c) => c.end <= best.start || c.start >= best.end).map((c) => c.score));
  if (best.score - runnerUp < AMBIGUITY_MARGIN) return null;
  return { start: best.start, end: best.end, quoteSim: best.quoteSim };
}

/**
 * Search `text` for `quote`, scoring candidates Hypothesis-style (quote
 * similarity weight 50, prefix 20, suffix 20, position proximity 2 against
 * `approxPos`), and accept the best candidate only if its quote similarity
 * is at least 0.75, its context agrees (or the quote is long and unique
 * enough to stand alone), and no other non-overlapping location scores
 * nearly as well (the ambiguity guard: a second location scoring almost as
 * well means context does not discriminate, and orphaning is better than
 * mis-anchoring). Falls back to a context-only anchor (prefix+suffix found,
 * whatever now sits between them) when the quote itself doesn't match well
 * enough.
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
