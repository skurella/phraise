// Brief 03 task 1: the fixture helper (relay + temp repo + daemon + remote
// client, with guaranteed cleanup) used by every gate that runs against the
// real daemon. `test/daemon-helpers.ts` already builds exactly this and has
// no vitest dependency (no `test`/`describe`/`expect` import, just plain
// setup/teardown functions), so it works unchanged outside vitest -- gates
// re-export it here rather than duplicating the wiring a second time. Any
// future divergence between "what gates need" and "what the vitest suite
// needs" should get its own function in this file instead of forking
// `daemon-helpers.ts`.
export { setupFixture, type Fixture } from '../../test/daemon-helpers.js';
