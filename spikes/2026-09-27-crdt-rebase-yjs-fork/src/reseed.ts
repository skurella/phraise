// Re-seed (plan section 6, decision D1): builds a fresh doc, resolves each
// comment in the old doc, refreshes its selectors from the old doc's text,
// anchors it in the new doc by selectors only, and writes fresh relative
// positions.
import * as Y from "yjs";
import { seedDoc, type Author } from "./seed.js";
import { docPlainText, offsetToPosition } from "./text.js";
import {
  COMMENTS_MAP,
  listComments,
  resolveComment,
  buildQuoteSelectors,
  fuzzyAnchor,
  type CommentRecord,
} from "./comments.js";

export type ReseedOutcome = "anchored" | "orphaned";

export interface ReseedReport {
  doc: Y.Doc;
  outcomes: Map<string, ReseedOutcome>;
}

/**
 * Re-seed `oldDoc`'s comments onto a fresh doc parsed from `markdown` at
 * `commit`. Comments that no longer resolve in `oldDoc` (already orphaned)
 * keep their existing quote and are left unanchored (`start`/`end`: null) in
 * the new doc. Comments that do resolve get selectors refreshed from
 * `oldDoc`'s current text at the resolved range, then are anchored in the
 * new doc by those selectors alone (never by CRDT position, since the new
 * doc shares no history with the old one).
 */
export function reseed(
  oldDoc: Y.Doc,
  docId: string,
  markdown: string,
  commit: string,
  author: Author
): ReseedReport {
  const newDoc = seedDoc(docId, markdown, commit, author);
  const newPlain = docPlainText(newDoc);
  const oldPlain = docPlainText(oldDoc);
  const oldComments = listComments(oldDoc);
  const outcomes = new Map<string, ReseedOutcome>();

  newDoc.transact(() => {
    const comments = newDoc.getMap(COMMENTS_MAP);
    for (const record of oldComments) {
      const resolved = resolveComment(oldDoc, record.id);
      if (resolved.method === "orphaned" || resolved.start === undefined || resolved.end === undefined) {
        comments.set(record.id, {
          ...record,
          quote: resolved.quote ?? record.quote,
          start: null,
          end: null,
        } satisfies CommentRecord);
        outcomes.set(record.id, "orphaned");
        continue;
      }

      const quote = buildQuoteSelectors(oldPlain.text, resolved.start, resolved.end);
      const anchored = fuzzyAnchor(newPlain.text, quote, resolved.start);
      if (!anchored) {
        comments.set(record.id, { ...record, quote, start: null, end: null } satisfies CommentRecord);
        outcomes.set(record.id, "orphaned");
        continue;
      }

      const startPos = offsetToPosition(newPlain.segments, anchored.start);
      const endPos = offsetToPosition(newPlain.segments, anchored.end);
      if (!startPos || !endPos) {
        comments.set(record.id, { ...record, quote, start: null, end: null } satisfies CommentRecord);
        outcomes.set(record.id, "orphaned");
        continue;
      }

      const startRel = Y.createRelativePositionFromTypeIndex(startPos.xmlText, startPos.index, 0);
      const endRel = Y.createRelativePositionFromTypeIndex(endPos.xmlText, endPos.index, -1);
      comments.set(record.id, {
        ...record,
        quote,
        start: Y.relativePositionToJSON(startRel),
        end: Y.relativePositionToJSON(endRel),
        pos: { start: anchored.start, end: anchored.end },
      } satisfies CommentRecord);
      outcomes.set(record.id, "anchored");
    }
  }, "reseed");

  return { doc: newDoc, outcomes };
}
