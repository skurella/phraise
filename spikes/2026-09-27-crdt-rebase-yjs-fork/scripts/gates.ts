#!/usr/bin/env -S npx tsx
// npm run gates: runs gates A-H (including G2 and the idempotence row) and
// prints a Markdown table (gate, pass/fail, key numbers); exits non-zero if
// any gate fails. Gate H runs 500 fuzz trials and is the slowest row.
import { runGateA, runGateC } from "../src/gates/gate-a-c.js";
import { runGateB } from "../src/gates/gate-b.js";
import { runGateD } from "../src/gates/gate-d.js";
import { runGateD2 } from "../src/gates/gate-d2.js";
import { runGateE } from "../src/gates/gate-e.js";
import { runGateF } from "../src/gates/gate-f.js";
import { runGateG } from "../src/gates/gate-g.js";
import { runGateG2 } from "../src/gates/gate-g2.js";
import { runGateH } from "../src/gates/gate-h.js";
import { runGateIdempotent } from "../src/gates/gate-idempotent.js";
import type { GateResult } from "../src/gates/types.js";

function run(name: string, fn: () => GateResult): GateResult {
  const start = Date.now();
  try {
    const result = fn();
    const ms = Date.now() - start;
    console.error(`  ${result.pass ? "PASS" : "FAIL"} ${name} (${ms}ms)`);
    return result;
  } catch (err: any) {
    const ms = Date.now() - start;
    console.error(`  FAIL ${name} (${ms}ms) — threw: ${err?.stack ?? err}`);
    return { name, pass: false, detail: `threw: ${err?.message ?? err}` };
  }
}

function main(): void {
  console.error("Running gates...");
  const results: GateResult[] = [
    run("A", runGateA),
    run("B", runGateB),
    run("C", runGateC),
    run("D", runGateD),
    run("D2", runGateD2),
    run("E", runGateE),
    run("F", runGateF),
    run("G", runGateG),
    run("G2", runGateG2),
    run("idempotent", runGateIdempotent),
    run("H", runGateH),
  ];

  const rows = ["| Gate | Pass | Detail |", "|---|---|---|"];
  for (const r of results) {
    const detail = r.detail.replace(/\|/g, "\\|").slice(0, 300);
    rows.push(`| ${r.name} | ${r.pass ? "PASS" : "FAIL"} | ${detail} |`);
  }
  console.log(rows.join("\n"));

  const anyFailed = results.some((r) => !r.pass);
  process.exit(anyFailed ? 1 : 0);
}

main();
