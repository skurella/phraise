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
  // Brief 04: gate D/E/I's multi-context tests poll for a real cross-client
  // network round trip (relay -> the other browser's WebSocket -> its own
  // ySyncPlugin/y-tiptap apply cycle), not just a same-page DOM/model
  // state. Under the full `npm run gates` run's default worker parallelism
  // (several Chromium instances + several relay processes competing for
  // CPU at once), that round trip was observed taking noticeably longer
  // than the default 5s `expect.poll` timeout, causing a real, reproduced
  // (not guessed) flake in an otherwise-passing gate E test that ran
  // reliably every time in isolation. Raised globally rather than
  // per-assertion, since any cross-page poll anywhere in the suite is
  // subject to the same contention.
  expect: { timeout: 10_000 },
  reporter: [['./e2e/gateReporter.ts'], ['list']],
  use: {
    headless: true,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // Room for firefox and webkit (brief 06 adds them).
  ],
});
