// Gate H (brief 03): 500 `word`-granularity fuzz trials with a fixed seed;
// pass when `exception`, `diverged`, `local-text-lost` and `F-violation`
// are all zero.
//
// As of this brief, this gate does **not** pass: a real, root-caused,
// pre-existing design gap (not introduced by this brief, and not a fuzz
// harness artifact — reproduced with a minimal hand-written scenario, no
// rebase involved) causes `local-text-lost` on roughly 5-10% of trials. See
// `context/logs/2026-09-27-builder-spike-2-yjs-fuzz.md` (05:40 entry) and
// the README's "Real bugs found" section for the full root cause and a
// minimal repro. Per this brief's own instruction ("if it needs a design
// change, do not redesign: record it"), this is reported rather than
// papered over — the check is not weakened and the fuzz generator is not
// narrowed to avoid the scenario.
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
  const detail = pass
    ? `${TRIALS} trials, all four gated categories zero (runtime ${report.totalMs}ms)`
    : failing
        .map((c) => `${c}=${report.failureCounts[c]} (${report.failingTrials[c]} trials)`)
        .join(", ") + ` — known issue, see log/README; repro: ${report.firstFailures[0]?.reproCommand ?? "n/a"}`;

  return {
    name: "H: 500 word-granularity fuzz trials (exception/diverged/local-text-lost/F-violation all zero)",
    pass,
    detail,
  };
}
