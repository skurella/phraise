#!/usr/bin/env npx tsx
// Standalone runner for gate F, used while building/debugging it before
// wiring it into scripts/gates.ts (task 5).
import { runGateF, runGateFContinuousTyping } from '../gates/gateF.js';

async function main() {
  const main = await runGateF({ port: 4238, dbPath: 'data/gateF.sqlite' });
  console.log('=== Gate F: main scenario ===');
  for (const c of main.checks) {
    console.log(`${c.pass ? 'PASS' : 'FAIL'} -- ${c.name}`);
    console.log(`  ${c.detail}`);
  }
  console.log(main.pass ? '\nGate F main scenario: PASS' : '\nGate F main scenario: FAIL');

  const variant = await runGateFContinuousTyping({ port: 4239, dbPath: 'data/gateF-continuous.sqlite' });
  console.log('\n=== Gate F: continuous typing variant ===');
  console.log(`${variant.pass ? 'PASS' : 'FAIL'} -- ${variant.name}`);
  console.log(`  ${variant.detail}`);

  if (!main.pass || !variant.pass) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
