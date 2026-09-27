// Gate B, adapted for this stack's diff emitter (brief 06 task 2).
//
// Stack13's gate B ran the SAME rebase three times, once per granularity
// spike 2's own diff.ts exposed (word/char/block), to show word and char
// both preserve the CRDT anchor for a surviving quote while block (which
// forcibly discards and re-inserts the whole textblock's text with no
// diffing at all) destroys it, falling back to the fuzzy/selector path.
//
// This stack's diff.ts (task 2) has no such knob: it always runs
// `lib0/delta`'s own word/line/char structural diff (see diff.ts's header),
// so there is no way to force "destroy the anchor" via a granularity
// setting -- an in-place edit that keeps a quote's exact characters
// unchanged will, by construction, keep the CRDT items backing that quote
// alive (the diff retains them). What stack13's "block" case demonstrated
// (anchor loss -> fuzzy fallback) is exercised elsewhere in this stack's
// gate suite instead: gate C's own scenario (a whole paragraph deleted) is
// a strictly harder version of the same loss (the block is gone entirely,
// not just re-diffed), and already proves the fuzzy/orphan path works.
//
// So this gate narrows to what is left to verify for this stack: does the
// CRDT anchor for a quote SURVIVE an in-place rewrite of the words around
// it (the plan's actual requirement -- "the second paragraph is rewritten
// ... its comment ... resolves to the identical quoted text").
import * as Y from "yjs";
import { seedDoc } from "../seed.js";
import { computeRebaseUpdate } from "../rebase.js";
import { addComment, resolveComment } from "../comments.js";
import { docPlainText } from "../text.js";
import type { Author } from "../seed.js";
import type { GateResult } from "./types.js";

const DOC_ID = "gate-b-doc";
const AUTHOR_A: Author = { name: "Repo Owner", email: "owner@example.com" };
const AUTHOR_B: Author = { name: "Contributor Two", email: "c2@example.com" };

const MD_A = "The background paragraph explains the original plan for the rollout in careful detail.\n";
const MD_B = "The background paragraph explains the revised plan for the rollout in careful, thorough detail.\n";

const QUOTE = "plan for the rollout";

export function runGateB(): GateResult {
  const doc = seedDoc(DOC_ID, MD_A, "A", AUTHOR_A);
  const text = docPlainText(doc).text;
  const start = text.indexOf(QUOTE);
  const id = addComment(doc, start, start + QUOTE.length, "keep this", { userId: "srv", name: "server" });

  const { update } = computeRebaseUpdate(doc, {
    docId: DOC_ID,
    targetMarkdown: MD_B,
    targetCommit: "B",
    author: AUTHOR_B,
  });
  Y.applyUpdate(doc, update);

  const resolved = resolveComment(doc, id);
  const pass = resolved.method === "crdt" && resolved.text === QUOTE;

  return {
    name: "B: surviving quote resolves via crdt after an in-place rewrite",
    pass,
    detail: JSON.stringify(resolved),
  };
}
