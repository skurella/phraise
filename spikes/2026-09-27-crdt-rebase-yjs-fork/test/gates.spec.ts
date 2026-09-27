// Each brief-02 gate (A-G, plus the idempotence row) as its own vitest test,
// sharing the exact same gate implementations `npm run gates` uses (in
// src/gates/*.ts) so there is exactly one place the logic lives.
import { describe, it, expect } from "vitest";
import { runGateA, runGateC } from "../src/gates/gate-a-c.js";
import { runGateB } from "../src/gates/gate-b.js";
import { runGateD } from "../src/gates/gate-d.js";
import { runGateD2 } from "../src/gates/gate-d2.js";
import { runGateE } from "../src/gates/gate-e.js";
import { runGateF } from "../src/gates/gate-f.js";
import { runGateG } from "../src/gates/gate-g.js";
import { runGateIdempotent } from "../src/gates/gate-idempotent.js";

describe("gates (brief 02)", () => {
  it("A: untouched-paragraph comment resolves via crdt", () => {
    const r = runGateA();
    expect(r.pass, r.detail).toBe(true);
  });

  it("B: surviving quote resolves per granularity", () => {
    const r = runGateB();
    expect(r.pass, r.detail).toBe(true);
  });

  it("C: deleted-paragraph comment orphans, negative control holds", () => {
    const r = runGateC();
    expect(r.pass, r.detail).toBe(true);
  });

  it(
    "D: converges under every delivery order",
    () => {
      const r = runGateD();
      expect(r.pass, r.detail).toBe(true);
    },
    30_000
  );

  it("D2: resurrection of a deleted-but-locally-edited block", () => {
    const r = runGateD2();
    expect(r.pass, r.detail).toBe(true);
  });

  it("E: attribution covers alice, bob, seed author, rebase peer", () => {
    const r = runGateE();
    expect(r.pass, r.detail).toBe(true);
  });

  it("F: every non-concurrently-edited block equals B's version", () => {
    const r = runGateF();
    expect(r.pass, r.detail).toBe(true);
  });

  it(
    "G: re-seed anchoring rates",
    () => {
      const r = runGateG();
      expect(r.pass, r.detail).toBe(true);
    },
    30_000
  );

  it("rebase idempotent on two replicas", () => {
    const r = runGateIdempotent();
    expect(r.pass, r.detail).toBe(true);
  });
});
