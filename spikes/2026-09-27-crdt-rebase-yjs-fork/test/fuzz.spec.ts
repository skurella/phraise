// Fuzz harness sanity (brief 03): determinism from (seed, trialIndex), the
// document window's size bound, and a small smoke run across all four
// granularities. The exhaustive 500-trial run lives in gate H
// (test/gates.spec.ts), which shares this same `runTrial`/`runTrials` code.
import { describe, it, expect } from "vitest";
import { pickWindow } from "../src/fuzz/corpus.js";
import { trialRng } from "../src/fuzz/prng.js";
import { runTrial } from "../src/fuzz/trial.js";
import { runTrials } from "../src/fuzz/run.js";
import type { Granularity } from "../src/diff.js";

describe("fuzz harness", () => {
  it("pickWindow returns 8-25 top-level blocks (clamped to the file's own count)", () => {
    const rng = trialRng(42, 0);
    for (let i = 0; i < 20; i++) {
      const { pm } = pickWindow(rng);
      expect(pm.childCount).toBeGreaterThanOrEqual(1);
      expect(pm.childCount).toBeLessThanOrEqual(25);
    }
  });

  it("a trial is fully reproducible from (seed, trialIndex) alone", () => {
    const a = runTrial({ seed: 7, trialIndex: 3, granularity: "word" });
    const b = runTrial({ seed: 7, trialIndex: 3, granularity: "word" });
    // elapsedMs is wall-clock timing, not part of the trial's own
    // determinism contract — everything else must match exactly.
    const { elapsedMs: _a, ...restA } = a;
    const { elapsedMs: _b, ...restB } = b;
    expect(JSON.stringify(restA)).toEqual(JSON.stringify(restB));
  });

  it("document/edit/mutation generation does not depend on granularity (only the rebase step does)", () => {
    const a = runTrial({ seed: 7, trialIndex: 3, granularity: "word" });
    const b = runTrial({ seed: 7, trialIndex: 3, granularity: "char" });
    expect(a.sourceFile).toEqual(b.sourceFile);
    expect(a.editKindsUsed).toEqual(b.editKindsUsed);
  });

  it("runs a small smoke batch on every granularity without throwing", () => {
    const granularities: Granularity[] = ["word", "char", "block", "yprosemirror"];
    for (const granularity of granularities) {
      const results = runTrials(1, 15, granularity);
      const exceptions = results.filter((r) => (r.failures.exception ?? 0) > 0);
      expect(
        exceptions.length,
        exceptions.map((e) => `${e.reproCommand}: ${e.detail}`).join("\n")
      ).toBe(0);
    }
  });
});
