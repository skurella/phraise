// Failure categories (brief 03, section 1, "Checks per trial"). The four
// gated by row H are exception/diverged/local-text-lost/F-violation.
// upstream-change-lost/missing-flag/spurious-flag are reported, not gated,
// per the brief ("Record, do not fail the gate, but report the rate").
// schema-drop is gated implicitly by being in the exhaustive check list, but
// the brief doesn't name it in gate H's pass criterion either, so it too is
// report-only here (never observed in development; if it ever fires it's
// worth promoting to a gated check).
export type FailureCategory =
  | "exception"
  | "diverged"
  | "local-text-lost"
  | "human-delete-vs-edit"
  | "F-violation"
  | "upstream-change-lost"
  | "missing-flag"
  | "spurious-flag"
  | "schema-drop";

export const GATED_CATEGORIES: FailureCategory[] = [
  "exception",
  "diverged",
  "local-text-lost",
  "F-violation",
];

export interface TrialResult {
  seed: number;
  trialIndex: number;
  granularity: string;
  sourceFile?: string;
  failures: Partial<Record<FailureCategory, number>>;
  detail?: string;
  reproCommand: string;
  commentMethodCounts: { crdt: number; fuzzy: number; orphaned: number };
  misAnchoredCount: number;
  commentCount: number;
  expectedFlagCount: number;
  actualFlagCount: number;
  correctFlagCount: number;
  idempotenceChecked: boolean;
  idempotenceOk: boolean;
  editKindsUsed: string[];
  mutationKindsUsed: string[];
  elapsedMs: number;
}

export function hasGatedFailure(r: TrialResult): boolean {
  return GATED_CATEGORIES.some((c) => (r.failures[c] ?? 0) > 0);
}
