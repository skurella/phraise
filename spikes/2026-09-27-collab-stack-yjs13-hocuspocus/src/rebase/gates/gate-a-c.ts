// Gate A: a comment on a range in a paragraph neither side changed resolves
// via crdt to the identical text after the rebase.
// Gate C: a comment in a paragraph commit B deleted resolves orphaned and
// keeps its quote; negative control: a similar-but-different paragraph
// elsewhere must not capture it.
import { buildScenario, drainAll } from "./scenario.js";
import { resolveComment } from "../comments.js";
import { deliver } from "../replica.js";
import type { GateResult } from "./types.js";

function fullyConverge() {
  const scenario = buildScenario();
  const { server, alice, bob } = scenario;
  deliver(server, alice);
  deliver(server, bob);
  deliver(alice, server);
  deliver(bob, server);
  drainAll(server, alice, bob);
  return scenario;
}

export function runGateA(): GateResult {
  const { server, comments } = fullyConverge();
  const resolved = resolveComment(server.doc, comments.untouched);
  const pass = resolved.method === "crdt" && resolved.text === "never touched by anyone";
  return {
    name: "A: untouched-paragraph comment resolves via crdt",
    pass,
    detail: JSON.stringify(resolved),
  };
}

export function runGateC(): GateResult {
  const { server, comments } = fullyConverge();
  const resolved = resolveComment(server.doc, comments.deleted);
  const negativeControlOk =
    resolved.method !== "fuzzy" || !(resolved.text ?? "").includes("harbor");
  const pass =
    resolved.method === "orphaned" &&
    resolved.quote?.exact === "old lighthouse keeper" &&
    negativeControlOk;
  return {
    name: "C: deleted-paragraph comment orphans (negative control holds)",
    pass,
    detail: JSON.stringify(resolved),
  };
}
