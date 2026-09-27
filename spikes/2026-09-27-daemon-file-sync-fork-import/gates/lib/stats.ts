// Brief 03: small shared latency-stats helper (median / p95), used by
// gates A, B and C so they report numbers the same way.
export interface LatencyStats {
  n: number;
  medianMs: number;
  p95Ms: number;
  maxMs: number;
}

export function summarizeLatencies(latenciesMs: number[]): LatencyStats {
  if (latenciesMs.length === 0) return { n: 0, medianMs: NaN, p95Ms: NaN, maxMs: NaN };
  const sorted = [...latenciesMs].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
  return { n: sorted.length, medianMs: median, p95Ms: p95, maxMs: sorted[sorted.length - 1] };
}
