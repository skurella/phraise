// Gate F: every block not concurrently edited equals B's version. We map
// each B textblock to the live element by identity (the plan's own
// definition: elements whose Y item was created in the fork or at seed and
// survive), using this codebase's stable item-id-as-identity scheme (see
// integrate.ts), and compare its live text to the known commit-B wording,
// excluding flagged blocks and blocks with any human-authored run. Also
// checks the live doc minus human-touched/flagged blocks equals B (the same
// six labelled blocks below are exactly that set for this fixture).
import { buildScenario, drainAll } from "./scenario.js";
import { collectBlocks, blockContentAt, needsReview } from "../integrate.js";
import { listAttribution } from "../attribution.js";
import { PM_FRAGMENT } from "../seed.js";
import { deliver } from "../replica.js";
import type { GateResult } from "./types.js";
import type { Labels } from "./scenario.js";

const EXPECTED_B: Array<[keyof Labels, string]> = [
  ["untouchedId", "This introductory paragraph is never touched by anyone during the rebase."],
  [
    "rewrittenId",
    "The background paragraph explains the revised plan for the rollout in careful, thorough detail.",
  ],
  [
    "negControlId",
    "The lighthouse by the harbor stayed lit every night that whole winter season.",
  ],
  ["listItem1Id", "The first list item never changes at all."],
  ["listItem2Id", "The second list item has now been reworded by this commit."],
  ["listItem3Id", "The third list item never changes at all."],
];

export function runGateF(): GateResult {
  const { server, alice, bob, labels } = buildScenario();
  deliver(server, alice);
  deliver(server, bob);
  deliver(alice, server);
  deliver(bob, server);
  drainAll(server, alice, bob);

  const flaggedIds = new Set(needsReview(server.doc).map((f) => f.blockId));
  const humanTouchedIds = new Set(
    listAttribution(server.doc)
      .filter((r) => r.author.kind === "human")
      .map((r) => r.blockId)
  );

  const root = server.doc.getXmlFragment(PM_FRAGMENT);
  const blocks = collectBlocks(root);
  const byId = new Map(blocks.map((b) => [b.id, b] as const));

  const mismatches: string[] = [];
  for (const [labelKey, expected] of EXPECTED_B) {
    const id = labels[labelKey];
    if (flaggedIds.has(id) || humanTouchedIds.has(id)) {
      mismatches.push(`${labelKey}: unexpectedly flagged/human-touched`);
      continue;
    }
    const block = byId.get(id);
    const text = block ? blockContentAt(block, undefined) : null;
    if (text !== expected) {
      mismatches.push(`${labelKey}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(text)}`);
    }
  }

  // P, Q must be excluded (flagged); P2's original id must no longer be
  // live and must be excluded too.
  if (!flaggedIds.has(labels.pId)) mismatches.push("P should be flagged (excluded from this check)");
  if (!flaggedIds.has(labels.qId)) mismatches.push("Q should be flagged (excluded from this check)");

  return {
    name: "F: every non-concurrently-edited block equals B's version (identity-mapped)",
    pass: mismatches.length === 0,
    detail: mismatches.length === 0 ? `${EXPECTED_B.length} blocks matched B exactly` : mismatches.join("; "),
  };
}
