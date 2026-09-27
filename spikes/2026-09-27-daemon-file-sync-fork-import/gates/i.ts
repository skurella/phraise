// Gate I wrapper: adapts `gates/fuzz.ts`'s `runFuzz` to the `GateResult`
// shape `gates/index.ts` expects. `--quick` runs 30 trials (brief 03 task
// 4); the full run is 300 trials and belongs to the orchestrator, not this
// command's default quick path.
import { runFuzz } from './fuzz.js';
import type { GateOpts, GateResult } from './lib/types.js';

const SEED_BASE = 0x1a2b3c4d;

export async function runGateI(opts: GateOpts = {}): Promise<GateResult> {
  const trials = opts.quick ? 30 : 300;
  const summary = await runFuzz(trials, SEED_BASE);
  const failures = summary.failingSeeds.map((f) => `seed ${f.seed}: ${f.categories.join(', ')}`);
  return {
    gate: 'I',
    requirement: `${trials} seeded trials interleaving saves/remote edits/restarts/delays: no exception, convergence, no lost text, no echo.`,
    pass: summary.passed === summary.trials,
    numbers: {
      trials: summary.trials,
      passed: summary.passed,
      exception: summary.categories.exception,
      divergence: summary.categories.divergence,
      fileNotRender: summary.categories.fileNotRender,
      lost: summary.categories.lost,
      deleteVsEdit: summary.categories.deleteVsEdit,
      resurrected: summary.categories.resurrected,
      echo: summary.categories.echo,
      detach: summary.categories.detach,
      wholeDocMismatch: summary.categories.wholeDocMismatch,
      baseMisjudged: summary.baseMisjudged,
      forks: summary.forks,
      coarseTextblocks: summary.coarse,
      repairs: summary.repairs,
      noops: summary.noops,
    },
    failures,
  };
}
