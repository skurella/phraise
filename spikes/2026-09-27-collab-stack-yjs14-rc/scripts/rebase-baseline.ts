#!/usr/bin/env npx tsx
// Brief 06 task 3: spike 2's own headless gates (A, B, C, D, D2, idempotent
// -- its own lettering, distinct from this package's A-G table), run in
// process against this stack's ported src/rebase/. Not part of `npm run
// gates`/`gates:quick` (mirrors stack13's scripts/rebase-baseline.ts).
import { runGateA, runGateC } from "../src/rebase/gates/gate-a-c.js";
import { runGateB } from "../src/rebase/gates/gate-b.js";
import { runGateD } from "../src/rebase/gates/gate-d.js";
import { runGateD2 } from "../src/rebase/gates/gate-d2.js";
import { runGateIdempotent } from "../src/rebase/gates/gate-idempotent.js";
import type { GateResult } from "../src/rebase/gates/types.js";

async function main() {
  const results: GateResult[] = [runGateA(), runGateB(), runGateC(), runGateD(), runGateD2(), runGateIdempotent()];

  let allPass = true;
  for (const r of results) {
    const status = r.pass ? "PASS" : "FAIL";
    if (!r.pass) allPass = false;
    console.log(`[${status}] ${r.name}`);
    if (!r.pass) console.log(`         ${r.detail}`);
  }
  console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`);
  if (!allPass) process.exit(1);
}

main();
