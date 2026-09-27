// Gate E: listAttribution shows ranges by alice, bob, the seed git author,
// and the synthetic rebase peer named after the git author of B.
import { buildScenario, drainAll } from "./scenario.js";
import { listAttribution } from "../attribution.js";
import { deliver } from "../replica.js";
import type { GateResult } from "./types.js";

export function runGateE(): GateResult {
  const { server, alice, bob } = buildScenario();
  deliver(server, alice);
  deliver(server, bob);
  deliver(alice, server);
  deliver(bob, server);
  drainAll(server, alice, bob);

  const runs = listAttribution(server.doc);

  const hasAlice = runs.some(
    (r) => r.author.kind === "human" && r.author.name === "Alice" && r.text.includes("ALICE EDIT")
  );
  const hasBob = runs.some(
    (r) => r.author.kind === "human" && r.author.name === "Bob" && r.text.includes("BOB")
  );
  const hasSeedAuthor = runs.some((r) => r.author.kind === "git" && r.author.name === "Repo Owner");
  const hasRebasePeer = runs.some(
    (r) => r.author.kind === "git" && r.author.name === "Contributor Two"
  );

  const pass = hasAlice && hasBob && hasSeedAuthor && hasRebasePeer;
  return {
    name: "E: attribution covers alice, bob, seed author, and the B rebase peer",
    pass,
    detail: `alice=${hasAlice} bob=${hasBob} seedAuthor=${hasSeedAuthor} rebasePeer=${hasRebasePeer} (${runs.length} runs)`,
  };
}
