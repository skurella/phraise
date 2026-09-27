// Lists fuzz trials with rebase-caused local-text-lost (orchestrator debugging aid).
// Usage: npx tsx scripts/find-lost.ts [granularity] [trials]
import { runTrial } from "../src/fuzz/trial.js";

const granularity = (process.argv[2] ?? "word") as any;
const n = Number(process.argv[3] ?? 500);
for (let i = 0; i < n; i++) {
  const r = runTrial({ seed: 20260927, trialIndex: i, granularity } as any);
  if (r.failures["local-text-lost"]) {
    console.log(i, r.detail, "| edits:", r.editKindsUsed.join(","), "| upstream:", r.mutationKindsUsed.join(","));
  }
}
