// Aggregation + Markdown table per granularity (brief 03, section 1's
// "Output a Markdown table per granularity: trials, failures by category,
// comment method rates, flag precision and recall, runtime.").
import type { FailureCategory, TrialResult } from "./categories.js";

export interface GranularityReport {
  granularity: string;
  trials: number;
  failureCounts: Partial<Record<FailureCategory, number>>;
  failingTrials: Partial<Record<FailureCategory, number>>;
  commentMethodCounts: { crdt: number; fuzzy: number; orphaned: number };
  commentCount: number;
  misAnchoredCount: number;
  flagPrecision: number | null;
  flagRecall: number | null;
  idempotenceChecked: number;
  idempotenceFailed: number;
  totalMs: number;
  firstFailures: TrialResult[];
}

export function aggregate(granularity: string, results: TrialResult[]): GranularityReport {
  const failureCounts: Partial<Record<FailureCategory, number>> = {};
  const failingTrials: Partial<Record<FailureCategory, number>> = {};
  const commentMethodCounts = { crdt: 0, fuzzy: 0, orphaned: 0 };
  let commentCount = 0;
  let misAnchoredCount = 0;
  let expectedFlagTotal = 0;
  let actualFlagTotal = 0;
  let correctFlagTotal = 0;
  let idempotenceChecked = 0;
  let idempotenceFailed = 0;
  let totalMs = 0;
  const firstFailures: TrialResult[] = [];

  for (const r of results) {
    totalMs += r.elapsedMs;
    commentCount += r.commentCount;
    misAnchoredCount += r.misAnchoredCount;
    commentMethodCounts.crdt += r.commentMethodCounts.crdt;
    commentMethodCounts.fuzzy += r.commentMethodCounts.fuzzy;
    commentMethodCounts.orphaned += r.commentMethodCounts.orphaned;
    expectedFlagTotal += r.expectedFlagCount;
    actualFlagTotal += r.actualFlagCount;
    correctFlagTotal += r.correctFlagCount;
    if (r.idempotenceChecked) {
      idempotenceChecked++;
      if (!r.idempotenceOk) idempotenceFailed++;
    }
    for (const [cat, count] of Object.entries(r.failures) as Array<[FailureCategory, number]>) {
      failureCounts[cat] = (failureCounts[cat] ?? 0) + count;
      failingTrials[cat] = (failingTrials[cat] ?? 0) + 1;
      if (firstFailures.length < 5) firstFailures.push(r);
    }
  }

  return {
    granularity,
    trials: results.length,
    failureCounts,
    failingTrials,
    commentMethodCounts,
    commentCount,
    misAnchoredCount,
    flagPrecision: actualFlagTotal > 0 ? correctFlagTotal / actualFlagTotal : null,
    flagRecall: expectedFlagTotal > 0 ? correctFlagTotal / expectedFlagTotal : null,
    idempotenceChecked,
    idempotenceFailed,
    totalMs,
    firstFailures,
  };
}

const ALL_CATEGORIES: FailureCategory[] = [
  "exception",
  "diverged",
  "local-text-lost",
  "F-violation",
  "upstream-change-lost",
  "missing-flag",
  "spurious-flag",
  "schema-drop",
];

function pct(n: number, d: number): string {
  if (d === 0) return "n/a";
  return `${((n / d) * 100).toFixed(1)}%`;
}

export function formatReport(r: GranularityReport): string {
  const lines: string[] = [];
  lines.push(`### Granularity: ${r.granularity}`);
  lines.push("");
  lines.push(`Trials: ${r.trials}. Runtime: ${r.totalMs}ms (${(r.totalMs / Math.max(1, r.trials)).toFixed(1)}ms/trial).`);
  lines.push("");
  lines.push("| Category | Failing trials | Total count |");
  lines.push("|---|---|---|");
  for (const cat of ALL_CATEGORIES) {
    lines.push(`| ${cat} | ${r.failingTrials[cat] ?? 0} | ${r.failureCounts[cat] ?? 0} |`);
  }
  lines.push("");
  lines.push(
    `Comments: ${r.commentCount} total — crdt=${r.commentMethodCounts.crdt} ` +
      `(${pct(r.commentMethodCounts.crdt, r.commentCount)}), fuzzy=${r.commentMethodCounts.fuzzy} ` +
      `(${pct(r.commentMethodCounts.fuzzy, r.commentCount)}), orphaned=${r.commentMethodCounts.orphaned} ` +
      `(${pct(r.commentMethodCounts.orphaned, r.commentCount)}); mis-anchored=${r.misAnchoredCount} ` +
      `(${pct(r.misAnchoredCount, r.commentCount)}).`
  );
  lines.push(
    `Flag precision: ${r.flagPrecision === null ? "n/a" : (r.flagPrecision * 100).toFixed(1) + "%"}; ` +
      `recall: ${r.flagRecall === null ? "n/a" : (r.flagRecall * 100).toFixed(1) + "%"}.`
  );
  if (r.idempotenceChecked > 0) {
    lines.push(
      `Idempotence (dual-rebase mode): ${r.idempotenceChecked} trials checked, ${r.idempotenceFailed} byte-mismatch.`
    );
  }
  if (r.firstFailures.length > 0) {
    lines.push("");
    lines.push("First few failing trials (repro commands):");
    for (const f of r.firstFailures) {
      lines.push(`- \`${f.reproCommand}\` — ${f.detail ?? "see failures"}`);
    }
  }
  return lines.join("\n");
}
