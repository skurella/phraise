// Brief 01, task 5: a custom Playwright reporter that reads the gate letter
// from each test title's `[A]`..`[K]` prefix, prints a results table (gate,
// passed, failed, skipped, status), and writes results/gates.md and
// results/gates.json. A gate with any failure is FAIL; a gate with no tests
// is "not run". `npm run gates` exits non-zero on failure because Playwright
// itself does that whenever any test fails -- this reporter only reports,
// it never changes the exit code.
import fs from 'node:fs';
import path from 'node:path';
import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';

const GATE_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'] as const;
type GateLetter = (typeof GATE_LETTERS)[number];

interface GateCounts {
  passed: number;
  failed: number;
  skipped: number;
}

function emptyCounts(): GateCounts {
  return { passed: 0, failed: 0, skipped: 0 };
}

function gateOf(title: string): GateLetter | null {
  const m = /^\[([A-K])\]/.exec(title);
  return (m?.[1] as GateLetter | undefined) ?? null;
}

function statusFor(counts: GateCounts): 'PASS' | 'FAIL' | 'not run' {
  const total = counts.passed + counts.failed + counts.skipped;
  if (total === 0) return 'not run';
  return counts.failed > 0 ? 'FAIL' : 'PASS';
}

export default class GateReporter implements Reporter {
  private counts: Record<GateLetter, GateCounts> = Object.fromEntries(GATE_LETTERS.map((l) => [l, emptyCounts()])) as Record<GateLetter, GateCounts>;
  private ungated: GateCounts = emptyCounts();

  onTestEnd(test: TestCase, result: TestResult): void {
    const gate = gateOf(test.title);
    const bucket = gate ? this.counts[gate] : this.ungated;
    if (result.status === 'passed') bucket.passed++;
    else if (result.status === 'skipped') bucket.skipped++;
    else bucket.failed++; // 'failed' | 'timedOut' | 'interrupted'
  }

  onEnd(result: FullResult): void {
    const rows = GATE_LETTERS.map((gate) => ({ gate, ...this.counts[gate], status: statusFor(this.counts[gate]) }));

    const header = '| Gate | Passed | Failed | Skipped | Status |';
    const sep = '| --- | --- | --- | --- | --- |';
    const lines = rows.map((r) => `| ${r.gate} | ${r.passed} | ${r.failed} | ${r.skipped} | ${r.status} |`);
    const table = [header, sep, ...lines].join('\n');

    console.log('\nGate results:\n');
    console.log(table);
    const ungatedTotal = this.ungated.passed + this.ungated.failed + this.ungated.skipped;
    if (ungatedTotal > 0) {
      console.log(
        `\n(${ungatedTotal} test(s) with no [A]-[K] title prefix: ${this.ungated.passed} passed, ${this.ungated.failed} failed, ${this.ungated.skipped} skipped)`,
      );
    }

    const resultsDir = path.resolve(process.cwd(), 'results');
    fs.mkdirSync(resultsDir, { recursive: true });
    fs.writeFileSync(path.join(resultsDir, 'gates.md'), `# Gate results\n\nOverall: ${result.status}\n\n${table}\n`);
    fs.writeFileSync(
      path.join(resultsDir, 'gates.json'),
      JSON.stringify({ overallStatus: result.status, gates: rows, ungated: this.ungated }, null, 2),
    );
  }
}
