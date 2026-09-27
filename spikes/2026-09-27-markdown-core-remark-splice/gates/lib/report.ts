export interface GateRow {
  gate: string;
  threshold: string;
  result: string;
  pass: boolean | 'n/a';
}

export function renderTable(rows: GateRow[]): string {
  const lines = ['| Gate | Threshold | Result | Pass |', '|---|---|---|---|'];
  for (const r of rows) {
    const passCell = r.pass === 'n/a' ? 'n/a' : r.pass ? 'yes' : '**no**';
    lines.push(`| ${r.gate} | ${r.threshold} | ${r.result} | ${passCell} |`);
  }
  return lines.join('\n');
}

export function pct(n: number, total: number): string {
  if (total === 0) return 'n/a (0 files)';
  return `${n}/${total} (${((100 * n) / total).toFixed(1)}%)`;
}
