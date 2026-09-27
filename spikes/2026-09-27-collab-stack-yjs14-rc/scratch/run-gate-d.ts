// Orchestrator helper: run gate D alone. Run: npx tsx scratch/run-gate-d.ts
import 'global-jsdom/register';
import { runGateD } from '../gates/gateD.js';

const d: any = await runGateD({ ports: { convergence: 4245, caret: 4246 }, dbDir: 'data', quick: false });
console.log(JSON.stringify(d.checks ?? d, null, 1).slice(0, 3000));
process.exit(0);
