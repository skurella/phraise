// Brief 03: the shape every `runGateX` returns, so `gates/index.ts` can
// print and serialize them uniformly regardless of what a given gate measures.
export interface GateResult {
  gate: string;
  requirement: string;
  pass: boolean;
  /** Free-form measured numbers (latencies, counts, rates, ...), gate-specific. */
  numbers: Record<string, unknown>;
  /** Human-readable failure descriptions (empty when `pass`). */
  failures: string[];
}

export interface GateOpts {
  quick?: boolean;
}
