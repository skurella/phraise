// Brief 01, task 5: a custom Playwright reporter that reads the gate letter
// from each test title's `[A]`..`[K]` prefix, prints a results table (gate,
// passed, failed, skipped, status), and writes results/gates.md and
// results/gates.json. A gate with any failure is FAIL; a gate with no tests
// is "not run". `npm run gates` exits non-zero on failure because Playwright
// itself does that whenever any test fails -- this reporter only reports,
// it never changes the exit code.
//
// Brief 07: a second table, cross-browser results by gate and browser
// (chromium/firefox/webkit -- see playwright.config.ts's own `grep` on the
// latter two, gates A-D only). Purely informational: the primary table,
// the overall pass/fail verdict, and Playwright's own exit code all stay
// keyed on chromium alone, exactly as before this brief. `projectNameOf`
// walks a TestCase's parent `Suite` chain to the one whose `.project()` is
// defined (the project-level suite) -- confirmed against the real
// `playwright/types/testReporter.d.ts` shape before relying on it, rather
// than guessed.
import fs from 'node:fs';
import path from 'node:path';
import type { FullResult, Reporter, Suite, TestCase, TestResult } from '@playwright/test/reporter';

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

/** Walks a `TestCase`'s parent `Suite` chain up to the one whose
 * `.project()` is defined -- that is the project-level suite, and its
 * `FullProject.name` is the browser this test ran under (`'chromium'`,
 * `'firefox'`, `'webkit'`). Falls back to `'unknown'` if, somehow, none is
 * found (never observed; defensive only). */
function projectNameOf(test: TestCase): string {
  let suite: Suite | undefined = test.parent;
  while (suite) {
    const project = suite.project();
    if (project) return project.name;
    suite = suite.parent;
  }
  return 'unknown';
}

const BROWSERS = ['chromium', 'firefox', 'webkit'] as const;
type Browser = (typeof BROWSERS)[number] | string;

export default class GateReporter implements Reporter {
  private counts: Record<GateLetter, GateCounts> = Object.fromEntries(GATE_LETTERS.map((l) => [l, emptyCounts()])) as Record<GateLetter, GateCounts>;
  private ungated: GateCounts = emptyCounts();
  // Brief 07: every project's own counts, keyed by browser then gate --
  // chromium's own numbers here are identical to `this.counts` above
  // (the same test results), kept separately only so the second table can
  // print a self-contained browser-by-browser comparison.
  private perBrowser = new Map<Browser, Record<GateLetter, GateCounts>>();

  private bucketFor(browser: Browser, gate: GateLetter): GateCounts {
    let gates = this.perBrowser.get(browser);
    if (!gates) {
      gates = Object.fromEntries(GATE_LETTERS.map((l) => [l, emptyCounts()])) as Record<GateLetter, GateCounts>;
      this.perBrowser.set(browser, gates);
    }
    return gates[gate];
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const gate = gateOf(test.title);
    const bucket = gate ? this.counts[gate] : this.ungated;
    const outcome: keyof GateCounts = result.status === 'passed' ? 'passed' : result.status === 'skipped' ? 'skipped' : 'failed';
    // The primary table/verdict/exit code stay Chromium-only: only count
    // toward `this.counts`/`this.ungated` (the ones `onEnd` below turns
    // into the gate verdict) for that one project.
    const browser = projectNameOf(test);
    if (browser === 'chromium') bucket[outcome]++;
    if (gate) this.bucketFor(browser, gate)[outcome]++;
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

    // Brief 07: the second, cross-browser table -- every gate letter that
    // has at least one test result in ANY browser, one column per browser
    // that actually ran (in the fixed BROWSERS order, then any others).
    const browsersSeen = [...this.perBrowser.keys()].sort((a, b) => {
      const ia = BROWSERS.indexOf(a as (typeof BROWSERS)[number]);
      const ib = BROWSERS.indexOf(b as (typeof BROWSERS)[number]);
      return (ia === -1 ? BROWSERS.length : ia) - (ib === -1 ? BROWSERS.length : ib);
    });
    const gatesWithData = GATE_LETTERS.filter((g) => browsersSeen.some((b) => statusFor(this.bucketFor(b, g)) !== 'not run'));
    let crossBrowserTable = '';
    if (browsersSeen.length > 0 && gatesWithData.length > 0) {
      const cbHeader = `| Gate | ${browsersSeen.join(' | ')} |`;
      const cbSep = `| --- | ${browsersSeen.map(() => '---').join(' | ')} |`;
      const cbLines = gatesWithData.map((gate) => {
        const cells = browsersSeen.map((b) => {
          const c = this.bucketFor(b, gate);
          const s = statusFor(c);
          return s === 'not run' ? 'not run' : `${s} (${c.passed}/${c.passed + c.failed})`;
        });
        return `| ${gate} | ${cells.join(' | ')} |`;
      });
      crossBrowserTable = [cbHeader, cbSep, ...cbLines].join('\n');
      console.log('\nCross-browser results (informational -- the verdict and exit code are Chromium-only):\n');
      console.log(crossBrowserTable);
    }

    const resultsDir = path.resolve(process.cwd(), 'results');
    fs.mkdirSync(resultsDir, { recursive: true });
    const crossBrowserSection = crossBrowserTable ? `\n## Cross-browser results (informational)\n\n${crossBrowserTable}\n` : '';
    fs.writeFileSync(path.join(resultsDir, 'gates.md'), `# Gate results\n\nOverall: ${result.status}\n\n${table}\n${crossBrowserSection}`);
    const crossBrowser: Record<string, Record<string, GateCounts & { status: string }>> = {};
    for (const b of browsersSeen) {
      crossBrowser[b] = {};
      for (const g of GATE_LETTERS) {
        const c = this.bucketFor(b, g);
        crossBrowser[b][g] = { ...c, status: statusFor(c) };
      }
    }
    fs.writeFileSync(
      path.join(resultsDir, 'gates.json'),
      JSON.stringify({ overallStatus: result.status, gates: rows, ungated: this.ungated, crossBrowser }, null, 2),
    );
  }
}
