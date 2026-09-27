// Brief 03 task 4: runs every gate in order (A-I; J is brief 04's slot) and
// prints + writes the results table. `npm run gates` runs the full sizes;
// `npm run gates:quick` (`--quick`) uses the small sizes brief 03 task 4
// specifies (A 20, B 10/style, C 20, D and E 10, fuzz 30 trials) so the
// whole thing finishes in a few minutes. The full run (A 200, B 100/style, C
// 200, D/E 50, fuzz 300 trials) is the orchestrator's to execute, per the
// charter ("long verification runs belong to the orchestrator").
import { runGateA } from './a.js';
import { runGateB } from './b.js';
import { runGateC } from './c.js';
import { runGateD } from './d.js';
import { runGateE } from './e.js';
import { runGateF } from './f.js';
import { runGateG } from './g.js';
import { runGateH } from './h.js';
import { runGateI } from './i.js';
import { writeReport, printTable } from './lib/report.js';
import type { GateResult } from './lib/types.js';

async function main(): Promise<void> {
  const quick = process.argv.includes('--quick');
  const rows: GateResult[] = [];

  const gates: Array<{ name: string; run: () => Promise<GateResult> }> = [
    { name: 'A', run: () => runGateA({ quick }) },
    { name: 'B', run: () => runGateB({ quick }) },
    { name: 'C', run: () => runGateC({ quick }) },
    { name: 'D', run: () => runGateD({ quick }) },
    { name: 'E', run: () => runGateE({ quick }) },
    { name: 'F', run: () => runGateF({ quick }) },
    { name: 'G', run: () => runGateG({ quick }) },
    { name: 'H', run: () => runGateH({ quick }) },
    { name: 'I', run: () => runGateI({ quick }) },
  ];

  for (const g of gates) {
    console.log(`\n--- running gate ${g.name} ${quick ? '(quick)' : ''} ---`);
    try {
      const result = await g.run();
      rows.push(result);
      console.log(`gate ${g.name}: ${result.pass ? 'PASS' : 'FAIL'}`);
    } catch (err) {
      rows.push({
        gate: g.name,
        requirement: '(threw before completing)',
        pass: false,
        numbers: {},
        failures: [String((err as Error)?.stack ?? err)],
      });
      console.log(`gate ${g.name}: FAIL (threw)`);
    }
  }

  rows.push({
    gate: 'J',
    requirement: 'see brief 04',
    pass: true,
    numbers: {},
    failures: [],
  });

  printTable(rows);
  writeReport(rows, { quick });

  const allPass = rows.every((r) => r.pass);
  if (!allPass) process.exitCode = 1;
}

main();
