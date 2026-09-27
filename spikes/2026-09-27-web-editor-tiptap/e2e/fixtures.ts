// Brief 01, task 4: a Playwright fixture that starts server/main.ts per test
// (see serverHarness.ts) against whatever seed files the test file declares
// with `test.use({ seedFiles: [...] })`, and stops it after -- Playwright
// runs a fixture's teardown (the code after `await use(...)`) whether the
// test passed or failed, so "stops it afterwards, including on failure" is
// Playwright's own guarantee here, not something this file has to implement.
import { test as base } from '@playwright/test';
import { startServer, type PhraiseServer } from './serverHarness.js';

export interface SeedFile {
  /** Path relative to the seeds directory, e.g. `blockquotes.md`. */
  relpath: string;
  /** Absolute path to the file to copy in. */
  srcPath: string;
}

export const test = base.extend<{ seedFiles: SeedFile[]; phraiseServer: PhraiseServer }>({
  seedFiles: [[], { option: true }],
  phraiseServer: async ({ seedFiles }, use) => {
    const seedMap: Record<string, string> = {};
    for (const f of seedFiles) seedMap[f.relpath] = f.srcPath;
    const server = await startServer(seedMap);
    await use(server);
    await server.stop();
  },
});

export { expect } from '@playwright/test';
