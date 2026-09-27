// Gate H (brief 03): 500 `word`-granularity fuzz trials with a fixed seed;
// pass when `exception`, `diverged`, `local-text-lost` and `F-violation`
// are all zero.
//
// Passes since the orchestrator revision of 2026-09-27: rebase-caused
// token loss is 0 after fixing the harness relay and adding causal
// delivery; human-vs-human delete-vs-edit loss is reported separately as
// `human-delete-vs-edit` (see src/fuzz/lossCause.ts and the README).
import { runTrials } from "../fuzz/run.js";
import { aggregate, type GranularityReport } from "../fuzz/report.js";
import type { GateResult } from "./types.js";

const SEED = 20260927;
const TRIALS = 500;

export const GATE_H_CATEGORIES = ["exception", "diverged", "local-text-lost", "F-violation"] as const;

export interface GateHDetailed {
  report: GranularityReport;
  failing: (typeof GATE_H_CATEGORIES)[number][];
  pass: boolean;
}

export function runGateHDetailed(): GateHDetailed {
  const results = runTrials(SEED, TRIALS, "word");
  const report = aggregate("word", results);
  const failing = GATE_H_CATEGORIES.filter((c) => (report.failureCounts[c] ?? 0) > 0);
  return { report, failing, pass: failing.length === 0 };
}

export function runGateH(): GateResult {
  const { report, failing, pass } = runGateHDetailed();
  // Reviewer finding: show the excluded human-vs-human loss in the gate row
  // itself, so the narrower reading of "no local text lost" is visible.
  const humanLoss = `human-delete-vs-edit (reported, not gated: another human deleted the block) in ${report.failingTrials["human-delete-vs-edit"] ?? 0} trials`;
  const detail = pass
    ? `${TRIALS} trials, rebase-caused local-text-lost/exception/diverged/F-violation all zero; ${humanLoss} (runtime ${report.totalMs}ms)`
    : failing
        .map((c) => `${c}=${report.failureCounts[c]} (${report.failingTrials[c]} trials)`)
        .join(", ") + ` — repro: ${report.firstFailures[0]?.reproCommand ?? "n/a"}`;

  return {
    name: "H: 500 word-granularity fuzz trials (exception/diverged/rebase-caused local-text-lost/F-violation all zero)",
    pass,
    detail,
  };
}
