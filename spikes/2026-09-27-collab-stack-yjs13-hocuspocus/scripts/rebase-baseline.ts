#!/usr/bin/env npx tsx
// Brief 05, task 1: run spike 2's own headless gates A-D (its own lettering,
// distinct from stack 13's gates A-G) plus its idempotence check, unchanged
// except the two import retargets documented in src/rebase's README, as a
// baseline confirming the port compiles and behaves identically to spike 2
// before any live-editor work begins. Not part of `npm run gates` (that's
// stack 13's own gate table); this is a one-off verification script.
import { runGateA, runGateC } from '../src/rebase/gates/gate-a-c.js';
import { runGateB } from '../src/rebase/gates/gate-b.js';
import { runGateD } from '../src/rebase/gates/gate-d.js';
import { runGateD2 } from '../src/rebase/gates/gate-d2.js';
import { runGateIdempotent } from '../src/rebase/gates/gate-idempotent.js';

async function main() {
  const results = [
    runGateA(),
    runGateB(),
    runGateC(),
    runGateD(),
    runGateD2(),
    runGateIdempotent(),
  ];
  let anyFail = false;
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'} -- ${r.name}`);
    console.log(`  ${r.detail}`);
    if (!r.pass) anyFail = true;
  }
  if (anyFail) {
    console.error('\nOne or more spike 2 baseline gates failed after the port.');
    process.exit(1);
  }
  console.log('\nAll spike 2 headless gates (A-D, idempotent) pass unchanged after the port.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
