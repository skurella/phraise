// Orchestrator helper: run gate C alone N times and print pass counts and
// late convergences. Run: npx tsx scratch/gatec-loop.ts 3
import 'global-jsdom/register';
import { runGateC } from '../gates/gateC.js';

const n = Number(process.argv[2] ?? 3);
for (let i = 0; i < n; i++) {
  const r = await runGateC({ port: 4213, dbPath: `data/gateC-loop-${i}.sqlite`, corpusDir: 'corpus/fetched/real' });
  const bad = r.failures.filter((f: any) => f.error || f.ok === false || f.pathA === false || f.pathB === false).slice(0, 3);
  console.log(`run ${i + 1}: A ${r.pathAPassed} B ${r.pathBPassed} / ${r.total}, late ${r.lateConvergences}, failures ${JSON.stringify(bad)}`);
}
process.exit(0);
