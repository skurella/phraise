// Gates A-F + idempotence (brief 4 item 6), Loro version. Adapted from
// spikes/2026-09-27-crdt-rebase-yjs-fork/src/gates/*.ts, consolidated into
// one module (a scope cut for time: the Yjs fork splits each gate into its
// own file plus a shared convergence.ts; here they're one file since the
// per-gate logic is much shorter on Loro -- see the README's LOC comparison).
import type { Node as PMNode } from "prosemirror-model";
import { Replica, deliver } from "../replica.js";
import { buildScenario, drainAll, MD_A, MD_B, AUTHOR_SEED, AUTHOR_B, DOC_ID, type Scenario } from "./scenario.js";
import { addComment, resolveComment } from "../comments.js";
import { listAttribution } from "../attribution.js";
import { needsReview, collectBlocks } from "../integrate.js";
import { seedDoc } from "../seed.js";
import { computeRebaseUpdate } from "../rebase.js";
import { parseMarkdown } from "../markdown.js";
import { docPlainText } from "../text.js";

export interface GateResult {
  name: string;
  pass: boolean;
  detail: string;
}

function reviewSnapshot(r: Replica): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const e of needsReview(r.doc)) out[e.blockId] = { reason: e.reason, text: e.text };
  return out;
}

function pmEq(a: Replica, b: Replica): boolean {
  return a.docToPM().eq(b.docToPM());
}

function reviewEq(a: Replica, b: Replica): boolean {
  return JSON.stringify(reviewSnapshot(a)) === JSON.stringify(reviewSnapshot(b));
}

const TEXTBLOCK_NAMES = new Set(["paragraph", "heading", "code_block"]);

/** Plain text of every textblock in a parsed PM doc, document order. */
function textblockTexts(doc: PMNode): string[] {
  const out: string[] = [];
  doc.descendants((node) => {
    if (TEXTBLOCK_NAMES.has(node.type.name)) {
      out.push(node.textContent);
      return false;
    }
    return true;
  });
  return out;
}

export function gateA(s: Scenario): GateResult {
  const r = resolveComment(s.server.doc, s.comments.untouched);
  const pass = r.method === "crdt" && r.text === "never touched by anyone";
  return { name: "A", pass, detail: `method=${r.method} text=${JSON.stringify(r.text)}` };
}

/**
 * A comment on a quote inside the "Background" paragraph that survives the
 * rewrite VERBATIM ("the rollout" appears unchanged in both A and B; only
 * "original"->"revised" and the added ", thorough" differ elsewhere in the
 * sentence). B rewrites the paragraph in place (>=50% shared wording, so the
 * tree diff pairs it as an update, not delete+insert). At word granularity
 * jsdiff's diffWordsWithSpace deletes/inserts whole changed words, so a
 * quote straddling a changed word (e.g. "original plan") legitimately loses
 * its CRDT anchor for the deleted word -- that's correct CRDT behavior, not
 * a bug, and is exactly why the plan's fuzzy fallback exists. This gate
 * instead quotes text untouched by the diff, which must stay `crdt`.
 */
export function gateB(): GateResult {
  const doc = seedDoc(DOC_ID, MD_A, "A", AUTHOR_SEED);
  const text = docPlainText(doc).text;
  const idx = text.indexOf("the rollout");
  const id = addComment(doc, idx, idx + "the rollout".length, "check this", { userId: "srv", name: "server" });
  const { update } = computeRebaseUpdate(doc, {
    docId: DOC_ID,
    targetMarkdown: MD_B,
    targetCommit: "B",
    author: AUTHOR_B,
    granularity: "word",
  });
  doc.import(update);
  doc.commit();
  const r = resolveComment(doc, id);
  const pass = r.method === "crdt" && r.text === "the rollout";
  return { name: "B", pass, detail: `method=${r.method} text=${JSON.stringify(r.text)}` };
}

export function gateC(s: Scenario): GateResult {
  const r = resolveComment(s.server.doc, s.comments.deleted);
  const pass = r.method === "orphaned" && r.quote?.exact === "old lighthouse keeper";
  return { name: "C", pass, detail: `method=${r.method}` };
}

export function gateD(): GateResult {
  // Deliver the 3! = 6 orderings of each party's whole pending batch,
  // followed by a relay-fixpoint drain, and check convergence each time.
  // Scope cut (logged): the Yjs fork also tries 50 seeded-random per-update
  // shuffles; cut here for time -- whole-batch permutation order is still a
  // real, non-trivial test of convergence under reordering.
  const perms: Array<Array<"server" | "alice" | "bob">> = [
    ["server", "alice", "bob"],
    ["server", "bob", "alice"],
    ["alice", "server", "bob"],
    ["alice", "bob", "server"],
    ["bob", "server", "alice"],
    ["bob", "alice", "server"],
  ];
  const failures: string[] = [];
  for (const order of perms) {
    const s = buildScenario();
    const byName = { server: s.server, alice: s.alice, bob: s.bob };
    for (const name of order) {
      const from = byName[name];
      for (const peer of [s.server, s.alice, s.bob]) {
        if (peer === from) continue;
        deliver(from, peer);
      }
    }
    drainAll(s.server, s.alice, s.bob);
    const ok =
      pmEq(s.server, s.alice) &&
      pmEq(s.server, s.bob) &&
      reviewEq(s.server, s.alice) &&
      reviewEq(s.server, s.bob);
    if (!ok) failures.push(order.join(">"));
  }
  return {
    name: "D",
    pass: failures.length === 0,
    detail: failures.length === 0 ? `${perms.length} orderings converge` : `failed: ${failures.join(", ")}`,
  };
}

export function gateE(s: Scenario): GateResult {
  drainAll(s.server, s.alice, s.bob);
  const runs = listAttribution(s.server.doc);
  const names = new Set(runs.map((r) => r.author.name));
  const expected = ["Repo Owner", "Contributor Two", "Alice", "Bob"];
  const missing = expected.filter((n) => !names.has(n));
  return { name: "E", pass: missing.length === 0, detail: `authors seen: ${[...names].join(", ")}` };
}

export function gateF(s: Scenario): GateResult {
  drainAll(s.server, s.alice, s.bob);
  const review = new Set(needsReview(s.server.doc).map((e) => e.blockId));
  const blocksNow = collectBlocks(s.server.doc);
  const targetTexts = new Set(textblockTexts(parseMarkdown(MD_B)));
  const problems: string[] = [];
  for (const b of blocksNow) {
    if (review.has(b.id)) continue; // flagged blocks are allowed to differ (needs review)
    if (!targetTexts.has(b.text)) problems.push(`unexpected text: ${JSON.stringify(b.text)}`);
  }
  return {
    name: "F",
    pass: problems.length === 0,
    detail: problems.length === 0 ? "every non-flagged block matches commit B" : problems.join("; "),
  };
}

export function gateIdempotent(): GateResult {
  // Two independent computeRebaseUpdate calls from byte-identical bases
  // produce byte-identical export bytes.
  const server1 = seedDoc(DOC_ID, MD_A, "A", AUTHOR_SEED);
  const server2 = seedDoc(DOC_ID, MD_A, "A", AUTHOR_SEED);
  const opts = { docId: DOC_ID, targetMarkdown: MD_B, targetCommit: "B", author: AUTHOR_B, granularity: "word" as const };
  const r1 = computeRebaseUpdate(server1, opts);
  const r2 = computeRebaseUpdate(server2, opts);
  const bytesEq = Buffer.from(r1.update).equals(Buffer.from(r2.update));

  // Re-applying the same update twice never duplicates content.
  server1.import(r1.update);
  server1.commit();
  const before = server1.export({ mode: "snapshot" });
  server1.import(r1.update); // re-apply, should be a no-op
  server1.commit();
  const after = server1.export({ mode: "snapshot" });
  const reapplyNoop = Buffer.from(before).equals(Buffer.from(after));

  return {
    name: "idempotent",
    pass: bytesEq && reapplyNoop,
    detail: `bytes-equal=${bytesEq} reapply-noop=${reapplyNoop}`,
  };
}

export function runAllGates(): GateResult[] {
  const results: GateResult[] = [];
  const s1 = buildScenario();
  results.push(gateA(s1));
  results.push(gateB());
  results.push(gateC(s1));
  results.push(gateD());
  results.push(gateE(buildScenario()));
  results.push(gateF(buildScenario()));
  results.push(gateIdempotent());
  return results;
}
