import { describe, it, expect } from "vitest";
import { runAllGates } from "../src/gates/index.js";
import { runMiniFuzz } from "../src/fuzz/mini.js";

describe("gates", () => {
  it("A-F + idempotence all pass", () => {
    const results = runAllGates();
    for (const r of results) {
      expect(r.pass, `gate ${r.name}: ${r.detail}`).toBe(true);
    }
  });

  it(
    "mini fuzz: 200 trials, zero exception/diverged/local-text-lost/F-violation",
    () => {
      const result = runMiniFuzz(20260927, 200);
      expect(result.counts.exception ?? 0).toBe(0);
      expect(result.counts.diverged ?? 0).toBe(0);
      expect(result.counts["local-text-lost"] ?? 0).toBe(0);
      expect(result.counts["F-violation"] ?? 0).toBe(0);
    },
    20000
  );
});
