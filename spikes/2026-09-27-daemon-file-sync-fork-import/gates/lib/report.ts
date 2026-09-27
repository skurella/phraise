// Brief 03 task 1: writes `results/gates.md` (a Markdown table) and
// `results/gates.json` (the same data, machine-readable) from a list of
// `GateResult`s. Shared by `gates/index.ts` (the full run) so both quick and
// full runs land in the same two files, whichever ran last.
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { GateResult } from './types.js';

const SPIKE_DIR = path.resolve(import.meta.dirname, '..', '..');
const RESULTS_DIR = path.join(SPIKE_DIR, 'results');

function formatNumbers(numbers: Record<string, unknown>): string {
  const parts = Object.entries(numbers).map(([k, v]) => `${k}=${typeof v === 'number' ? formatNumber(v) : JSON.stringify(v)}`);
  return parts.join(', ');
}

function formatNumber(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2);
}

export function renderMarkdown(rows: GateResult[], opts: { quick: boolean; generatedAt: Date }): string {
  const lines: string[] = [];
  lines.push('# Gate results');
  lines.push('');
  lines.push(`Generated: ${opts.generatedAt.toISOString()}${opts.quick ? ' (--quick)' : ''}`);
  lines.push('');
  lines.push('| Gate | Requirement | Result | Numbers |');
  lines.push('|---|---|---|---|');
  for (const r of rows) {
    const result = r.pass ? 'PASS' : 'FAIL';
    lines.push(`| ${r.gate} | ${r.requirement} | ${result} | ${formatNumbers(r.numbers) || '-'} |`);
  }
  lines.push('');
  const failing = rows.filter((r) => !r.pass);
  if (failing.length > 0) {
    lines.push('## Failures');
    lines.push('');
    for (const r of failing) {
      lines.push(`### Gate ${r.gate}`);
      for (const f of r.failures.slice(0, 20)) lines.push(`- ${f}`);
      if (r.failures.length > 20) lines.push(`- ... and ${r.failures.length - 20} more`);
      lines.push('');
    }
  }
  return lines.join('\n') + '\n';
}

/** Writes `results/gates.md` and `results/gates.json`. Creates `results/` if needed. */
export function writeReport(rows: GateResult[], opts: { quick: boolean }): void {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const generatedAt = new Date();
  fs.writeFileSync(path.join(RESULTS_DIR, 'gates.md'), renderMarkdown(rows, { quick: opts.quick, generatedAt }));
  fs.writeFileSync(
    path.join(RESULTS_DIR, 'gates.json'),
    JSON.stringify({ quick: opts.quick, generatedAt: generatedAt.toISOString(), gates: rows }, null, 2),
  );
}

export function printTable(rows: GateResult[]): void {
  console.log('\n=== Gate results ===');
  for (const r of rows) {
    const result = r.pass ? 'PASS' : 'FAIL';
    console.log(`[${result}] ${r.gate}: ${r.requirement}`);
    const numStr = formatNumbers(r.numbers);
    if (numStr) console.log(`       ${numStr}`);
    if (!r.pass) {
      for (const f of r.failures.slice(0, 10)) console.log(`       failure: ${f}`);
      if (r.failures.length > 10) console.log(`       ... and ${r.failures.length - 10} more`);
    }
  }
  console.log('');
}
