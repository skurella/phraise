// Gate D: bob offline edits P; alice online edits Q; B changes P and Q;
// server rebases; bob reconnects. Every delivery order of the pending update
// sets across server/alice/bob must converge to the same content: all
// permutations of the three batches, plus 50 shuffled per-update orders.
import { buildScenario, drainAll, type Labels } from "./scenario.js";
import { checkConvergence } from "./convergence.js";
import { needsReview } from "../integrate.js";
import { Replica, deliver } from "../replica.js";
import type { GateResult } from "./types.js";

type Party = "server" | "alice" | "bob";

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i++) {
    const rest = items.slice(0, i).concat(items.slice(i + 1));
    for (const p of permutations(rest)) out.push([items[i], ...p]);
  }
  return out;
}

function deliverPartyBatch(who: Party, server: Replica, alice: Replica, bob: Replica): void {
  if (who === "server") {
    deliver(server, alice);
    deliver(server, bob);
  } else if (who === "alice") {
    deliver(alice, server);
  } else {
    deliver(bob, server);
  }
}

// Deterministic PRNG (mulberry32) so the 50 shuffles are reproducible.
function mulberry32(seed: number): () => number {
  let s = seed;
  return function () {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(arr: T[], rnd: () => number): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function checkContent(server: Replica, alice: Replica, bob: Replica, labels: Labels): string | null {
  const conv = checkConvergence(server, alice, bob);
  if (!conv.pmConverged) return "PM JSON did not converge across replicas";
  if (!conv.reviewConverged) return "review map did not converge across replicas";

  const text = server.docToPM().textContent;
  if (!text.includes("BOB EDIT:")) return "bob's inserted text is missing";
  if (!text.includes("ALICE EDIT:")) return "alice's inserted text is missing";
  if (!text.includes("server's revised draft notes")) return "B's rewrite of P/Q is missing";

  const entries = needsReview(server.doc);
  const flagged = new Set(entries.map((f) => f.blockId));
  if (!flagged.has(labels.pId)) return "P is not flagged";
  if (!flagged.has(labels.qId)) return "Q is not flagged";

  const unexpected = entries.filter(
    (f) =>
      f.blockId !== labels.pId &&
      f.blockId !== labels.qId &&
      f.reason !== "deleted-upstream-edited-locally" // the resurrected P2 block
  );
  if (unexpected.length > 0) {
    return `unexpected flags: ${unexpected.map((f) => `${f.blockId}(${f.reason})`).join(", ")}`;
  }
  return null;
}

export function runGateD(): GateResult {
  const orders = permutations<Party>(["server", "alice", "bob"]);
  const permutationFailures: string[] = [];
  for (const order of orders) {
    const { server, alice, bob, labels } = buildScenario();
    for (const who of order) deliverPartyBatch(who, server, alice, bob);
    drainAll(server, alice, bob);
    const problem = checkContent(server, alice, bob, labels);
    if (problem) permutationFailures.push(`[${order.join(">")}]: ${problem}`);
  }

  const SHUFFLE_COUNT = 50;
  const shuffleFailures: string[] = [];
  for (let i = 0; i < SHUFFLE_COUNT; i++) {
    const { server, alice, bob, labels } = buildScenario();
    const flat: Array<{ to: Replica; update: Uint8Array }> = [
      ...server._takeQueueTo("alice").map((update) => ({ to: alice, update })),
      ...server._takeQueueTo("bob").map((update) => ({ to: bob, update })),
      ...alice._takeQueueTo("server").map((update) => ({ to: server, update })),
      ...bob._takeQueueTo("server").map((update) => ({ to: server, update })),
    ];
    const ordered = shuffle(flat, mulberry32(1000 + i));
    for (const entry of ordered) entry.to.receive([entry.update]);
    drainAll(server, alice, bob);
    const problem = checkContent(server, alice, bob, labels);
    if (problem) shuffleFailures.push(`shuffle#${i}: ${problem}`);
  }

  const pass = permutationFailures.length === 0 && shuffleFailures.length === 0;
  return {
    name: "D: converges under every delivery order (6 batch permutations + 50 shuffled per-update orders)",
    pass,
    detail: pass
      ? `${orders.length} permutations + ${SHUFFLE_COUNT} shuffles all converged`
      : [...permutationFailures, ...shuffleFailures].slice(0, 5).join(" | "),
  };
}
