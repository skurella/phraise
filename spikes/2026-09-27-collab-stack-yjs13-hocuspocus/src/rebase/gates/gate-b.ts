// Gate B: a comment in a paragraph commit B rewrote (words around the quote
// change, the quote survives) resolves to the quote text. Report method
// (crdt or fuzzy) for each granularity word/char/block; block must still
// pass through fuzzy (replacing the whole textblock text destroys the CRDT
// anchor by construction, so only the selector fallback can find it).
import * as Y from "yjs";
import { seedDoc } from "../seed.js";
import { computeRebaseUpdate } from "../rebase.js";
import { addComment, resolveComment } from "../comments.js";
import { docPlainText } from "../text.js";
import type { Author } from "../seed.js";
import type { Granularity } from "../diff.js";
import type { GateResult } from "./types.js";

const DOC_ID = "gate-b-doc";
const AUTHOR_A: Author = { name: "Repo Owner", email: "owner@example.com" };
const AUTHOR_B: Author = { name: "Contributor Two", email: "c2@example.com" };

const MD_A =
  "The background paragraph explains the original plan for the rollout in careful detail.\n";
const MD_B =
  "The background paragraph explains the revised plan for the rollout in careful, thorough detail.\n";

const QUOTE = "plan for the rollout";

function runOne(granularity: Granularity): { method: string; text?: string } {
  const doc = seedDoc(DOC_ID, MD_A, "A", AUTHOR_A);
  const text = docPlainText(doc).text;
  const start = text.indexOf(QUOTE);
  const id = addComment(doc, start, start + QUOTE.length, "keep this", {
    userId: "srv",
    name: "server",
  });

  const { update } = computeRebaseUpdate(doc, {
    docId: DOC_ID,
    targetMarkdown: MD_B,
    targetCommit: "B",
    author: AUTHOR_B,
    granularity,
  });
  Y.applyUpdate(doc, update);

  const resolved = resolveComment(doc, id);
  return { method: resolved.method, text: resolved.text };
}

export function runGateB(): GateResult {
  const results: Record<string, { method: string; text?: string }> = {};
  for (const g of ["word", "char", "block"] as Granularity[]) {
    results[g] = runOne(g);
  }

  const wordOk = results.word.method === "crdt" && results.word.text === QUOTE;
  const charOk = results.char.method === "crdt" && results.char.text === QUOTE;
  // block granularity replaces the whole text, so the CRDT anchor cannot
  // survive; the plan requires it to still resolve via fuzzy.
  const blockOk = results.block.method === "fuzzy" && results.block.text === QUOTE;

  return {
    name: "B: surviving quote resolves per granularity (word/char via crdt, block via fuzzy)",
    pass: wordOk && charOk && blockOk,
    detail: JSON.stringify(results),
  };
}
