// Gate D2: B deletes P2 while bob edited it offline: P2 is resurrected with
// bob's text once, flagged deleted-upstream-edited-locally, all replicas
// converge.
import { buildScenario, drainAll } from "./scenario.js";
import { checkConvergence } from "./convergence.js";
import { collectBlocks, isVisibleAt, needsReview } from "../integrate.js";
import { PM_FRAGMENT } from "../seed.js";
import { deliver } from "../replica.js";
import type { GateResult } from "./types.js";

export function runGateD2(): GateResult {
  const { server, alice, bob, labels } = buildScenario();
  deliver(server, alice);
  deliver(server, bob);
  deliver(alice, server);
  deliver(bob, server);
  drainAll(server, alice, bob);

  const conv = checkConvergence(server, alice, bob);
  if (!conv.pmConverged || !conv.reviewConverged) {
    return { name: "D2: resurrection of a deleted-but-locally-edited block", pass: false, detail: "did not converge" };
  }

  const root = server.doc.get(PM_FRAGMENT);
  const original = collectBlocks(root).find((b) => b.id === labels.p2Id);
  if (!original) {
    return { name: "D2: resurrection", pass: false, detail: "original P2 item not found at all" };
  }
  if (isVisibleAt(original.item, undefined)) {
    return { name: "D2: resurrection", pass: false, detail: "original P2 block was not deleted upstream" };
  }

  const resurrections = needsReview(server.doc).filter(
    (f) => f.reason === "deleted-upstream-edited-locally" && f.text.includes("BOB P2 EDIT")
  );
  if (resurrections.length !== 1) {
    return {
      name: "D2: resurrection",
      pass: false,
      detail: `expected exactly one resurrected P2 block with bob's text, found ${resurrections.length}`,
    };
  }

  for (const [name, r] of [
    ["alice", alice],
    ["bob", bob],
  ] as const) {
    if (!r.docToPM().textContent.includes("BOB P2 EDIT")) {
      return { name: "D2: resurrection", pass: false, detail: `resurrected text missing on ${name}` };
    }
  }

  return {
    name: "D2: resurrection of a deleted-but-locally-edited block",
    pass: true,
    detail: "P2 resurrected exactly once with bob's text, flagged, converged on all 3 replicas",
  };
}
