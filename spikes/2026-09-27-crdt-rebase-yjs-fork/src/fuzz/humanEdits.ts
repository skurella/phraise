// Local (human) edit generator (brief 03, section 1, step 3): "insert a
// unique token word ... at a random word boundary; delete a random run of 1
// to 4 base words (never delete another user's token); insert a new
// paragraph containing a token; delete a whole block; split a paragraph the
// way y-prosemirror does; change a heading level."
import type { Replica } from "../replica.js";
import { docPlainText } from "../text.js";
import type { Rng } from "./prng.js";

export type LocalEditKind =
  | "insert-token"
  | "delete-word-run"
  | "insert-paragraph-token"
  | "delete-block"
  | "split-paragraph"
  | "heading-level";

const LOCAL_EDIT_KINDS: LocalEditKind[] = [
  "insert-token",
  "delete-word-run",
  "insert-paragraph-token",
  "delete-block",
  "split-paragraph",
  "heading-level",
];

const NOT_TOKEN_WORD = /\b(?!tok_)[A-Za-z]{3,}\b/g;

function topLevelTypes(replica: Replica): string[] {
  const doc = replica.docToPM();
  const types: string[] = [];
  doc.forEach((child) => types.push(child.type.name));
  return types;
}

export interface LocalEditLog {
  kind: LocalEditKind;
  applied: boolean;
  token?: string;
  error?: string;
}

/** Insert a token at a random word boundary in the replica's current text. */
function insertToken(replica: Replica, rng: Rng, token: string): boolean {
  const { text, segments } = docPlainText(replica.doc);
  if (segments.length === 0 || text.length === 0) return false;
  const words = [...text.matchAll(/\S+/g)];
  const offset = words.length > 0 ? rng.pick(words).index! : rng.int(text.length + 1);
  replica.insertText(offset, ` ${token} `);
  return true;
}

/** Delete a run of 1-4 non-token words. */
function deleteWordRun(replica: Replica, rng: Rng): boolean {
  const { text } = docPlainText(replica.doc);
  const matches = [...text.matchAll(NOT_TOKEN_WORD)];
  if (matches.length === 0) return false;
  const runLen = rng.range(1, 4);
  const startIdx = rng.int(matches.length);
  const first = matches[startIdx];
  const lastIdx = Math.min(startIdx + runLen - 1, matches.length - 1);
  const last = matches[lastIdx];
  const start = first.index!;
  const end = last.index! + last[0].length;
  if (end <= start || end > text.length) return false;
  replica.deleteText(start, end - start);
  return true;
}

function insertParagraphWithToken(replica: Replica, rng: Rng, token: string): boolean {
  const types = topLevelTypes(replica);
  const index = rng.range(0, types.length);
  replica.insertBlock(index, `New paragraph with ${token} inside it.`, "paragraph");
  return true;
}

function deleteWholeBlock(replica: Replica, rng: Rng): boolean {
  const types = topLevelTypes(replica);
  if (types.length <= 1) return false;
  const index = rng.int(types.length);
  replica.deleteBlock(index);
  return true;
}

function splitParagraph(replica: Replica, rng: Rng): boolean {
  const doc = replica.docToPM();
  const paraIndices: number[] = [];
  doc.forEach((child, _o, i) => {
    if (child.type.name === "paragraph" && child.textContent.trim().length > 1) paraIndices.push(i);
  });
  if (paraIndices.length === 0) return false;
  const idx = rng.pick(paraIndices);
  const para = doc.child(idx);
  // Global offset of a mid-paragraph split point.
  let before = 0;
  doc.forEach((child, _o, i) => {
    if (i < idx) before += child.textContent.length + 1;
  });
  const splitAt = rng.range(1, Math.max(1, para.textContent.length - 1));
  replica.splitParagraphAt(before + splitAt);
  return true;
}

function changeHeadingLevel(replica: Replica, rng: Rng): boolean {
  const doc = replica.docToPM();
  const headingIndices: number[] = [];
  doc.forEach((child, _o, i) => {
    if (child.type.name === "heading") headingIndices.push(i);
  });
  if (headingIndices.length === 0) return false;
  const idx = rng.pick(headingIndices);
  const current = (doc.child(idx).attrs as any).level ?? 1;
  let next = rng.range(1, 6);
  if (next === current) next = (next % 6) + 1;
  replica.setHeadingLevel(idx, next);
  return true;
}

/**
 * Apply `count` local edits to `replica` (its own human, e.g. alice/bob),
 * returning a log and the set of tokens this human inserted (for the
 * `local-text-lost` check). `tokenPrefix` should be unique per replica
 * (e.g. the replica name) so tokens across humans never collide.
 */
export function applyLocalEdits(
  replica: Replica,
  rng: Rng,
  count: number,
  tokenPrefix: string
): { log: LocalEditLog[]; tokens: string[] } {
  const log: LocalEditLog[] = [];
  const tokens: string[] = [];
  let tokenN = 0;

  for (let i = 0; i < count; i++) {
    const kind = rng.pick(LOCAL_EDIT_KINDS);
    let applied = false;
    let token: string | undefined;
    let error: string | undefined;
    try {
      switch (kind) {
        case "insert-token": {
          token = `tok_${tokenPrefix}_${tokenN++}`;
          applied = insertToken(replica, rng, token);
          if (applied) tokens.push(token);
          break;
        }
        case "delete-word-run":
          applied = deleteWordRun(replica, rng);
          break;
        case "insert-paragraph-token": {
          token = `tok_${tokenPrefix}_${tokenN++}`;
          applied = insertParagraphWithToken(replica, rng, token);
          if (applied) tokens.push(token);
          break;
        }
        case "delete-block":
          applied = deleteWholeBlock(replica, rng);
          break;
        case "split-paragraph":
          applied = splitParagraph(replica, rng);
          break;
        case "heading-level":
          applied = changeHeadingLevel(replica, rng);
          break;
      }
    } catch (err: any) {
      applied = false;
      error = err?.message ?? String(err);
    }
    log.push({ kind, applied, token, error });
  }
  return { log, tokens };
}
