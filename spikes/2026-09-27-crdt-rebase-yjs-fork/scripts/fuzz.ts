#!/usr/bin/env -S npx tsx
// npm run fuzz (brief 03, sections 1-2): runs the granularity comparison —
// >=500 `word` trials (this is gate H's own set) and >=200 each of `char`,
// `block`, `yprosemirror`, all on the same seeds — and prints a Markdown
// table per granularity plus a short interpretation. Exits non-zero if the
// `word` row has any of gate H's four gated-category failures (so `npm run
// fuzz` reflects gate H's true state without re-running it).
import type { Granularity } from "../src/diff.js";
import { runTrials } from "../src/fuzz/run.js";
import { aggregate, formatReport, type GranularityReport } from "../src/fuzz/report.js";

const SEED = 20260927; // same seed as gate H, so `word`'s first 500 trials are identical
const WORD_TRIALS = 500;
const OTHER_TRIALS = 200;

function pct(n: number, d: number): string {
  return d === 0 ? "n/a" : `${((n / d) * 100).toFixed(1)}%`;
}

function interpret(reports: GranularityReport[]): string {
  const lines: string[] = [];
  const byGran = new Map(reports.map((r) => [r.granularity, r] as const));
  const word = byGran.get("word");
  const block = byGran.get("block");

  lines.push(
    "Comment CRDT survival in blocks B modified (higher = the CRDT anchor " +
      "survived the rebase's own text diff without falling back to fuzzy " +
      "matching or orphaning):"
  );
  for (const r of reports) {
    lines.push(
      `- ${r.granularity}: crdt=${pct(r.commentMethodCounts.crdt, r.commentCount)}, ` +
        `fuzzy=${pct(r.commentMethodCounts.fuzzy, r.commentCount)}, ` +
        `orphaned=${pct(r.commentMethodCounts.orphaned, r.commentCount)}`
    );
  }
  lines.push("");
  lines.push("upstream-change-lost rate (lower is better):");
  for (const r of reports) {
    lines.push(`- ${r.granularity}: ${pct(r.failureCounts["upstream-change-lost"] ?? 0, r.trials)}`);
  }
  lines.push("");
  lines.push("Flag precision/recall (higher is better):");
  for (const r of reports) {
    const p = r.flagPrecision === null ? "n/a" : `${(r.flagPrecision * 100).toFixed(1)}%`;
    const rec = r.flagRecall === null ? "n/a" : `${(r.flagRecall * 100).toFixed(1)}%`;
    lines.push(`- ${r.granularity}: precision=${p}, recall=${rec}`);
  }
  lines.push("");
  if (word && block) {
    lines.push(
      "Word- and char-granularity diffs operate inside the existing XmlText, so a " +
        "surviving CRDT position is common; block granularity always replaces the " +
        "whole textblock (by construction, per the plan), destroying any CRDT anchor " +
        "even for a one-word change — the fuzzy/orphan rates above should read " +
        "noticeably higher for block than for word/char. yprosemirror (comparison-only, " +
        "not a candidate default) diffs via y-prosemirror's own prefix/suffix update, " +
        "which typically preserves less of a mid-paragraph anchor than a real word " +
        "diff when the edit isn't at a text boundary."
    );
  }
  return lines.join("\n");
}

function main(): void {
  console.error("Running fuzz (granularity comparison)...");
  const granularities: Granularity[] = ["word", "char", "block", "yprosemirror"];
  const reports: GranularityReport[] = [];

  for (const granularity of granularities) {
    const count = granularity === "word" ? WORD_TRIALS : OTHER_TRIALS;
    const t0 = Date.now();
    const results = runTrials(SEED, count, granularity);
    const report = aggregate(granularity, results);
    reports.push(report);
    console.error(`  ${granularity}: ${count} trials in ${Date.now() - t0}ms`);
  }

  console.log(reports.map(formatReport).join("\n\n"));
  console.log("\n## Interpretation\n");
  console.log(interpret(reports));

  const wordReport = reports.find((r) => r.granularity === "word")!;
  const gatedCategories = ["exception", "diverged", "local-text-lost", "F-violation"] as const;
  const anyGatedFail = gatedCategories.some((c) => (wordReport.failureCounts[c] ?? 0) > 0);
  process.exit(anyGatedFail ? 1 : 0);
}

main();
