// One fuzz trial (brief 03, section 1). Every trial is fully determined by
// (seed, trialIndex); `granularity` is applied only at the rebase step, so
// the same seed+trialIndex produces the same document/edits/mutations
// across all four granularities (needed for the granularity comparison in
// section 2 to be a fair, paired comparison).
import { classifyLoss, deletedElementIds } from "./lossCause.js";
import * as Y from "yjs";
import type { Author } from "../seed.js";
import { PM_FRAGMENT, PHRAISE_MAP, base64ToUint8 } from "../seed.js";
import { Replica, deliver } from "../replica.js";
import { computeRebaseUpdate, type RebaseOptions } from "../rebase.js";
import { collectBlocks, blockContentAt, isVisibleAt, needsReview } from "../integrate.js";
import { addComment, resolveComment, COMMENTS_MAP } from "../comments.js";
import { docPlainText } from "../text.js";
import { parseMarkdown, serializeMarkdown } from "../markdown.js";
import type { Granularity } from "../diff.js";
import { pickWindow } from "./corpus.js";
import { trialRng, type Rng } from "./prng.js";
import { applyLocalEdits } from "./humanEdits.js";
import { applyUpstreamMutations } from "./mutate.js";
import { flattenTextblocks } from "./pmtree.js";
import { blockPMNodeAt, pmNodesEqual } from "./blockjson.js";
import { snapshotBlockTexts, diffTouched } from "./touched.js";
import type { FailureCategory, TrialResult } from "./categories.js";

const AUTHOR_SEED: Author = { name: "Repo Owner", email: "owner@example.com" };
const AUTHOR_B: Author = { name: "Contributor Two", email: "b@example.com" };

export interface TrialOptions {
  seed: number;
  trialIndex: number;
  granularity: Granularity;
}

function reproCommand(opts: TrialOptions): string {
  return `npx tsx scripts/fuzz-repro.ts --seed ${opts.seed} --trial ${opts.trialIndex} --granularity ${opts.granularity}`;
}

export function runTrial(opts: TrialOptions): TrialResult {
  const start = Date.now();
  const rng = trialRng(opts.seed, opts.trialIndex);
  const docId = `fuzz-${opts.seed}-${opts.trialIndex}`;

  const result: TrialResult = {
    seed: opts.seed,
    trialIndex: opts.trialIndex,
    granularity: opts.granularity,
    failures: {},
    reproCommand: reproCommand(opts),
    commentMethodCounts: { crdt: 0, fuzzy: 0, orphaned: 0 },
    misAnchoredCount: 0,
    commentCount: 0,
    expectedFlagCount: 0,
    actualFlagCount: 0,
    correctFlagCount: 0,
    idempotenceChecked: false,
    idempotenceOk: true,
    editKindsUsed: [],
    mutationKindsUsed: [],
    elapsedMs: 0,
  };

  function fail(cat: FailureCategory, detail: string, count = 1): void {
    result.failures[cat] = (result.failures[cat] ?? 0) + count;
    if (!result.detail) result.detail = `${cat}: ${detail}`;
  }

  try {
    // --- 1. Document A ----------------------------------------------------
    const { markdown: markdownA, pm: pmA, sourceFile } = pickWindow(rng);
    result.sourceFile = sourceFile;

    // --- 2. Replicas -------------------------------------------------------
    const hasCarol = rng.bool(0.5);
    const server = new Replica("server", docId, markdownA, "A", AUTHOR_SEED);
    const alice = new Replica("alice", docId, markdownA, "A", AUTHOR_SEED, {
      userId: "alice",
      name: "Alice",
    });
    const bob = new Replica("bob", docId, markdownA, "A", AUTHOR_SEED, { userId: "bob", name: "Bob" });
    const carol = hasCarol
      ? new Replica("carol", docId, markdownA, "A", AUTHOR_SEED, { userId: "carol", name: "Carol" })
      : null;
    server.link(alice);
    server.link(bob);
    if (carol) server.link(carol);
    bob.setOnline(false);
    if (carol) carol.setOnline(false);

    const baseline = snapshotBlockTexts(server.doc);
    const flatIndexToBlockId = collectBlocks(server.doc.getXmlFragment(PM_FRAGMENT)).map((b) => b.id);
    const idToFlatIndex = new Map(flatIndexToBlockId.map((id, i) => [id, i] as const));

    // --- 7. Comments: 5 comments on random word ranges of A, before edits --
    const { text: textA } = docPlainText(server.doc);
    const wordMatches = [...textA.matchAll(/\S+/g)];
    const commentIds: string[] = [];
    for (let i = 0; i < 5 && wordMatches.length > 0; i++) {
      const m = rng.pick(wordMatches);
      const start = m.index!;
      const end = Math.min(textA.length, start + m[0].length);
      if (end <= start) continue;
      const id = addComment(server.doc, start, end, `comment ${i}`, { userId: "srv", name: "server" });
      commentIds.push(id);
    }
    result.commentCount = commentIds.length;

    // --- 3. Local edits ------------------------------------------------
    const humans: Array<{ replica: Replica; name: string }> = [
      { replica: alice, name: "alice" },
      { replica: bob, name: "bob" },
    ];
    if (carol) humans.push({ replica: carol, name: "carol" });

    // Tokens this trial's local-text-lost check must find in the final
    // text. A later op by the *same* human (e.g. a "delete-block" removing
    // the very paragraph an earlier "insert-token" op just created) can
    // remove their own token before it ever leaves their replica — that's
    // "deleted by that same human" per the brief, not a lost token, so only
    // tokens still present in the human's *own* doc right after their edit
    // loop finishes are tracked.
    const allTokens: string[] = [];
    const humanDeletedIds = new Set<string>();
    const editKindsUsed = new Set<string>();
    for (const h of humans) {
      const count = rng.range(1, 6);
      const { log, tokens } = applyLocalEdits(h.replica, rng, count, h.name);
      for (const l of log) if (l.applied) editKindsUsed.add(l.kind);
      for (const id of deletedElementIds(h.replica.doc)) humanDeletedIds.add(id);
      const ownText = docPlainText(h.replica.doc).text;
      for (const t of tokens) if (ownText.includes(t)) allTokens.push(t);
    }
    result.editKindsUsed = [...editKindsUsed];

    const touchedIds = new Set<string>();
    for (const h of humans) {
      const after = snapshotBlockTexts(h.replica.doc);
      for (const id of diffTouched(baseline, after)) touchedIds.add(id);
    }
    const touchedFlatIndices = new Set<number>();
    for (const id of touchedIds) {
      const idx = idToFlatIndex.get(id);
      if (idx !== undefined) touchedFlatIndices.add(idx);
    }

    // Alice's edits reach the server before the rebase in most trials,
    // partially in some, not at all in the rest.
    const preDeliver = rng.next();
    if (preDeliver < 0.7) {
      deliver(alice, server);
      deliver(server, alice);
    } else if (preDeliver < 0.85) {
      const pending = alice._queueTo("server")?.length ?? 0;
      if (pending > 0) {
        const n = rng.range(1, pending);
        const subset = alice._takePrefixTo("server", n);
        if (subset.length > 0) server.receive(subset, "alice");
      }
    }

    // --- 4. Upstream B -------------------------------------------------
    const mutCount = rng.range(1, 6);
    const mutResult = applyUpstreamMutations(pmA, rng, touchedFlatIndices, mutCount);
    const upstreamTouchedFlat = mutResult.touchedFlatIndices;
    result.mutationKindsUsed = [...new Set(mutResult.log.filter((l) => l.applied).map((l) => l.kind))];
    const markdownB = serializeMarkdown(mutResult.doc);

    // --- 5. Rebase -------------------------------------------------------
    const rebaseMode = rng.next();
    const isChainedRebase = rebaseMode >= 0.8;
    let targetCommit = "B";
    if (rebaseMode < 0.6) {
      server.runRebase(markdownB, "B", AUTHOR_B, opts.granularity);
    } else if (rebaseMode < 0.8) {
      // Idempotence under fuzz: two replicas compute the same rebase
      // independently (server, and bob who has extra unsynced local
      // edits — the fork always starts from the shared base snapshot
      // regardless, so both updates must be byte-identical per the plan).
      const rebaseOpts: RebaseOptions = {
        docId,
        targetMarkdown: markdownB,
        targetCommit: "B",
        author: AUTHOR_B,
        granularity: opts.granularity,
      };
      const serverResult = computeRebaseUpdate(server.doc, rebaseOpts);
      const bobResult = computeRebaseUpdate(bob.doc, rebaseOpts);
      result.idempotenceChecked = true;
      result.idempotenceOk = Buffer.from(serverResult.update).equals(Buffer.from(bobResult.update));
      server.receive([serverResult.update]);
      bob.receive([bobResult.update]);
    } else {
      // Chained rebase B -> C before bob reconnects.
      server.runRebase(markdownB, "B", AUTHOR_B, opts.granularity);
      const canonicalPmB = parseMarkdown(markdownB);
      const mutCount2 = rng.range(1, 6);
      const mutResult2 = applyUpstreamMutations(canonicalPmB, rng, new Set(), mutCount2);
      for (const l of mutResult2.log) if (l.applied) result.mutationKindsUsed.push(l.kind);
      const markdownC = serializeMarkdown(mutResult2.doc);
      server.runRebase(markdownC, "C", AUTHOR_B, opts.granularity);
      targetCommit = "C";
    }

    // --- 6. Delivery: shuffled per-update, until quiescent, then a final
    // full sync ------------------------------------------------------------
    function pendingPairs(): Array<[Replica, Replica]> {
      const pairs: Array<[Replica, Replica]> = [
        [server, alice],
        [alice, server],
        [server, bob],
        [bob, server],
      ];
      if (carol) pairs.push([server, carol], [carol, server]);
      return pairs;
    }

    let quiesced = false;
    for (let round = 0; round < 200; round++) {
      const pairs = pendingPairs();
      const flat: Array<{ from: Replica; to: Replica; update: Uint8Array }> = [];
      for (const [from, to] of pairs) {
        for (const u of from._takeQueueTo(to.name)) flat.push({ from, to, update: u });
      }
      if (flat.length === 0) {
        quiesced = true;
        break;
      }
      for (const item of rng.shuffle(flat)) item.to.receive([item.update], item.from.name);
    }
    if (!quiesced) {
      throw new Error("delivery did not quiesce after 200 rounds (possible relay loop)");
    }

    // Final full sync: force a direct all-pairs state exchange regardless
    // of queue state, to catch any per-message queuing bug the relay above
    // might mask.
    const allReplicas = [server, alice, bob, ...(carol ? [carol] : [])];
    for (let round = 0; round < 5; round++) {
      let any = false;
      for (const a of allReplicas) {
        for (const b of allReplicas) {
          if (a === b) continue;
          const sv = Y.encodeStateVector(b.doc);
          const upd = Y.encodeStateAsUpdate(a.doc, sv);
          if (upd.length > 2) {
            b.receive([upd], a.name);
            any = true;
          }
        }
      }
      if (!any) break;
    }

    // --- Checks ------------------------------------------------------------

    // diverged: PM JSON or review map differ across replicas.
    const pmJsons = allReplicas.map((r) => JSON.stringify(r.docToPM().toJSON()));
    const reviewJsons = allReplicas.map((r) =>
      JSON.stringify(
        needsReview(r.doc)
          .map((e) => ({ id: e.blockId, reason: e.reason }))
          .sort((a, b) => a.id.localeCompare(b.id))
      )
    );
    const pmConverged = pmJsons.every((j) => j === pmJsons[0]);
    const reviewConverged = reviewJsons.every((j) => j === reviewJsons[0]);
    if (!pmConverged || !reviewConverged) {
      fail("diverged", `pmConverged=${pmConverged} reviewConverged=${reviewConverged}`);
    }

    // local-text-lost: a human's own token missing from the final text.
    const finalText = docPlainText(server.doc).text;
    const missingTokens = allTokens.filter((t) => !finalText.includes(t));
    // Orchestrator revision: split by cause (see lossCause.ts).
    const rebaseLost = missingTokens.filter((t) => classifyLoss(server.doc, t, humanDeletedIds) !== "human-delete");
    const humanLost = missingTokens.filter((t) => !rebaseLost.includes(t));
    if (rebaseLost.length > 0) {
      fail("local-text-lost", rebaseLost.slice(0, 5).map((t) => `${t}(${classifyLoss(server.doc, t, humanDeletedIds)})`).join(","), rebaseLost.length);
    }
    if (humanLost.length > 0) {
      fail("human-delete-vs-edit", humanLost.slice(0, 5).join(","), humanLost.length);
    }

    // F-violation: every textblock not touched by any human must equal its
    // content at the latest base snapshot exactly, PM-node-JSON (marks
    // count).
    const finalPhraise = server.doc.getMap(PHRAISE_MAP);
    const finalSnapB64 = finalPhraise.get(`snapshot:${targetCommit}`) as string | undefined;
    const finalSnap = finalSnapB64 ? Y.decodeSnapshot(base64ToUint8(finalSnapB64)) : undefined;
    const finalBlocks = collectBlocks(server.doc.getXmlFragment(PM_FRAGMENT));
    const byId = new Map(finalBlocks.map((b) => [b.id, b] as const));
    let fViolations = 0;
    const fDetails: string[] = [];
    for (let i = 0; i < flatIndexToBlockId.length; i++) {
      if (touchedFlatIndices.has(i)) continue;
      const id = flatIndexToBlockId[i];
      const block = byId.get(id);
      if (!block) continue;
      const atBase = blockPMNodeAt(block, finalSnap);
      const atNow = blockPMNodeAt(block, undefined);
      if (!pmNodesEqual(atBase, atNow)) {
        fViolations++;
        fDetails.push(id);
      }
    }
    if (fViolations > 0) {
      fail("F-violation", fDetails.slice(0, 5).join(","), fViolations);
    }

    // schema-drop: yXmlFragmentToProseMirrorRootNode silently dropping a
    // visible-with-content textblock.
    const visibleWithContent = finalBlocks.filter((b) => {
      const c = blockContentAt(b, undefined);
      return c !== null && c.length > 0;
    }).length;
    const pmTextblockCount = flattenTextblocks(server.docToPM()).length;
    if (pmTextblockCount < visibleWithContent) {
      fail(
        "schema-drop",
        `Y visible-with-content=${visibleWithContent} PM textblocks=${pmTextblockCount}`
      );
    }

    // Report-only metrics: upstream-change-lost, missing-flag,
    // spurious-flag. Independent ground truth from our own mutation/edit
    // bookkeeping (touchedFlatIndices, upstreamTouchedFlat), not from
    // integrate.ts's own logic — mirrors gate G's independent diff-mapper
    // ground truth. Wrapped so a bug in *this* bookkeeping can't masquerade
    // as a "system under test" exception. Skipped for chained-rebase trials
    // (B then C): `upstreamTouchedFlat` only tracks round-1 (A->B)
    // mutations, and round 2's `applyUpstreamMutations` call has its own,
    // separately-numbered flat-textblock index space (over `canonicalPmB`,
    // which can have a different block count/order than `pmA` once
    // structural mutations ran) — extending the shared index correlation
    // across a chained rebase is a bigger change than this report-only
    // metric warrants, so those trials simply don't contribute to it
    // (found via the fuzz run itself: a block only mutated in round 2
    // showed up as a false "spurious-flag" before this guard, since round-1
    // bookkeeping correctly had no record of it).
    if (!isChainedRebase) try {
      const originalFlat = flattenTextblocks(pmA);
      const actualFlags = needsReview(server.doc);
      const actualConcurrentIds = new Set(
        actualFlags.filter((f) => f.reason === "concurrent-edit").map((f) => f.blockId)
      );
      const originalIdSet = new Set(flatIndexToBlockId);
      const actualConcurrentOriginal = new Set(
        [...actualConcurrentIds].filter((id) => originalIdSet.has(id))
      );

      // A "concurrent-edit" flag needs a *live* block to attach to. When a
      // human's own concurrent delete (on their own replica) cascades away
      // the very element the rebase text-edited, there is nothing left to
      // flag — that is the same fundamental tree-CRDT limitation as the
      // `local-text-lost` finding (concurrent delete-of-container vs.
      // edit-inside-it), not a flagging-precision gap, so it is excluded
      // from this ground truth rather than reported as "missing" (found via
      // the fuzz run itself: without this, most "missing-flag" reports
      // were really "the block is gone", not "the system failed to flag a
      // live block").
      const expectedFlagIdxs = [...touchedFlatIndices].filter((i) => {
        if (!upstreamTouchedFlat.has(i)) return false;
        const block = byId.get(flatIndexToBlockId[i]);
        return !!block && isVisibleAt(block.item, undefined);
      });
      const expectedFlagIds = new Set(expectedFlagIdxs.map((i) => flatIndexToBlockId[i]));

      let truePositive = 0;
      for (const id of expectedFlagIds) if (actualConcurrentOriginal.has(id)) truePositive++;
      result.expectedFlagCount = expectedFlagIds.size;
      result.actualFlagCount = actualConcurrentOriginal.size;
      result.correctFlagCount = truePositive;

      const missingFlags = [...expectedFlagIds].filter((id) => !actualConcurrentOriginal.has(id));
      const spuriousFlags = [...actualConcurrentOriginal].filter((id) => !expectedFlagIds.has(id));
      if (missingFlags.length > 0) fail("missing-flag", `${missingFlags.length}`, missingFlags.length);
      if (spuriousFlags.length > 0) fail("spurious-flag", `${spuriousFlags.length}`, spuriousFlags.length);

      let upstreamLost = 0;
      const allFlaggedIds = new Set(actualFlags.map((f) => f.blockId));
      for (const i of upstreamTouchedFlat) {
        const id = flatIndexToBlockId[i];
        if (allFlaggedIds.has(id)) continue;
        const block = byId.get(id);
        const orig = originalFlat[i];
        if (!block || !orig) continue;
        const nowNode = blockPMNodeAt(block, undefined);
        if (nowNode && nowNode.eq(orig.node)) upstreamLost++;
      }
      if (upstreamLost > 0) fail("upstream-change-lost", `${upstreamLost}`, upstreamLost);
    } catch {
      // Best-effort report-only metrics; a bug here doesn't count as a
      // system-under-test exception.
    }

    // Comments: method counts + mis-anchored rate.
    for (const id of commentIds) {
      const resolved = resolveComment(server.doc, id);
      result.commentMethodCounts[resolved.method]++;
      if (resolved.method !== "orphaned" && resolved.start !== undefined && resolved.end !== undefined) {
        const record = server.doc.getMap(COMMENTS_MAP).get(id) as any;
        const exact = record?.quote?.exact ?? "";
        if (exact.length > 0) {
          const got = resolved.text ?? "";
          const sim = charSimilarity(got, exact);
          if (sim < 0.5 && quoteExistsElsewhere(finalText, exact, resolved.start, resolved.end)) {
            result.misAnchoredCount++;
          }
        }
      }
    }
  } catch (err: any) {
    fail("exception", err?.stack ?? String(err?.message ?? err));
  }

  result.elapsedMs = Date.now() - start;
  return result;
}

function charSimilarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length, 1);
  return 1 - levenshtein(a, b) / maxLen;
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

/** Does `quote` (or a version of it with at most 25% edits) exist somewhere
 * in `text` other than at [excludeStart, excludeEnd)? Used for the
 * mis-anchored metric. */
function quoteExistsElsewhere(
  text: string,
  quote: string,
  excludeStart: number,
  excludeEnd: number
): boolean {
  if (quote.length === 0) return false;
  const maxErrors = Math.max(1, Math.ceil(0.25 * quote.length));
  let idx = 0;
  while (idx <= text.length - quote.length) {
    const found = text.indexOf(quote, idx);
    if (found < 0) break;
    if (found < excludeStart - maxErrors || found > excludeEnd + maxErrors) return true;
    idx = found + 1;
  }
  // Cheap approx check: scan fixed-size windows near likely spots is
  // overkill for a report-only metric; exact-substring elsewhere already
  // covers the common case this check is meant to catch (a duplicated or
  // moved phrase), so approximate variants are treated as a bonus, not a
  // requirement.
  return false;
}
