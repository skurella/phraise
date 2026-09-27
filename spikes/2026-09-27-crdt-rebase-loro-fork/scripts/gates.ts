#!/usr/bin/env tsx
// `npm run gates`: prints a Markdown table for gates A-F + idempotence, plus
// a mini fuzz summary, and exits non-zero if any gated check fails.
import { runAllGates } from "../src/gates/index.js";
import { runMiniFuzz } from "../src/fuzz/mini.js";

function main() {
  const results = runAllGates();
  console.log("| Gate | Pass | Detail |");
  console.log("|---|---|---|");
  let allPass = true;
  for (const r of results) {
    if (!r.pass) allPass = false;
    console.log(`| ${r.name} | ${r.pass ? "PASS" : "FAIL"} | ${r.detail.replace(/\|/g, "\\|")} |`);
  }

  console.log();
  console.log("Mini fuzz (>= 200 trials, seed 20260927):");
  const fuzz = runMiniFuzz(20260927, 200);
  console.log("| category | count | pct |");
  console.log("|---|---|---|");
  for (const [cat, count] of Object.entries(fuzz.counts)) {
    console.log(`| ${cat} | ${count} | ${((count / fuzz.total) * 100).toFixed(1)}% |`);
  }
  const gated = ["exception", "diverged", "local-text-lost", "F-violation"] as const;
  const gatedFail = gated.some((c) => (fuzz.counts[c] ?? 0) > 0);
  if (gatedFail) allPass = false;
  console.log();
  console.log(
    `Fuzz gate (exception/diverged/local-text-lost/F-violation all zero): ${gatedFail ? "FAIL" : "PASS"}`
  );
  if (fuzz.reproSamples.length > 0) {
    console.log("First few repro seeds for gated failures:");
    for (const s of fuzz.reproSamples.slice(0, 5)) console.log(`  - trial ${s}`);
  }

  console.log();
  console.log(allPass ? "ALL GATES PASS" : "SOME GATES FAILED");
  process.exit(allPass ? 0 : 1);
}

main();
