import type { Granularity } from "../diff.js";
import { runTrial } from "./trial.js";
import type { TrialResult } from "./categories.js";

/** Run `count` trials at `granularity`, trial indices `[startIndex,
 * startIndex+count)`, all under the same `seed`. */
export function runTrials(
  seed: number,
  count: number,
  granularity: Granularity,
  startIndex = 0
): TrialResult[] {
  const out: TrialResult[] = [];
  for (let i = startIndex; i < startIndex + count; i++) {
    out.push(runTrial({ seed, trialIndex: i, granularity }));
  }
  return out;
}
