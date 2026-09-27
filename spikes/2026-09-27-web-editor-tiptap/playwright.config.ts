import { defineConfig, devices } from '@playwright/test';

// Brief 01, task 4/5. Browsers install into .pw-browsers/ inside this spike
// directory (git-ignored) via PLAYWRIGHT_BROWSERS_PATH, set in every npm
// script that touches Playwright (see package.json). Each test starts its
// own server (e2e/fixtures.ts + serverHarness.ts), so tests are not run in
// parallel workers across files that might race for ports -- fullyParallel
// is left off (Playwright's default of parallel *files*, serial tests
// within a file, is fine since each test gets its own server instance and
// its own random port in 4400-4449).
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  reporter: [['./e2e/gateReporter.ts'], ['list']],
  use: {
    headless: true,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // Room for firefox and webkit (brief 06 adds them).
  ],
});
