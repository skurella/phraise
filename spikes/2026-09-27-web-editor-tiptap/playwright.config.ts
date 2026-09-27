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
  timeout: 45_000,
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
  //
  // Brief 05: raised again (10s -> 15s) after root-causing a DIFFERENT,
  // rarer flake in gate E's first test (`e2e/gateE-undo.spec.ts`, "type
  // alternately"): not a network/relay issue at all (confirmed by
  // instrumenting `page.on('websocket'/'console'/'pageerror', ...)` and the
  // live provider's own `status` event across ~50 reruns -- the connection
  // stayed 'connected' throughout every failure, and polling the LOCAL
  // model for 30+ further seconds after a failure showed it never changed).
  // The real cause: `page.keyboard.type()` occasionally dispatches into a
  // page that a prior real click/keypress had focus on, yet the keystrokes
  // never reach the ProseMirror document at all -- a CDP input-delivery
  // flake on this machine (roughly 1 in 100-150 keystroke sequences),
  // confirmed NOT caused by this brief's own `localCaretFollowPlugin` (the
  // same rate reproduced with that plugin removed). Fixed at the cause in
  // `gateE-undo.spec.ts` itself (`typeAndVerify`: verify the physical
  // keystroke landed locally, retry if not -- not a sleep, since it returns
  // immediately in the overwhelmingly common case), so this timeout no
  // longer needs to be large enough to out-wait a stuck case; the smaller
  // raise here just keeps the existing margin for genuine cross-process
  // contention on this shared dev machine.
  expect: { timeout: 15_000 },
  reporter: [['./e2e/gateReporter.ts'], ['list']],
  use: {
    headless: true,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // Brief 07: Firefox and WebKit, gates A/B/C/D only ("where cheap" --
    // the charter's own budget, and the plan's own "cheap gates" framing
    // for this brief). `grep` restricts each project to exactly the test
    // titles starting `[A]`/`[B]`/`[C]`/`[D]`, matching every spec file
    // (including `smoke.spec.ts`'s own `[A]` test) without needing a
    // separate file list. The gate verdict and exit code stay on
    // Chromium (`gateReporter.ts`'s own primary table); these two
    // projects only feed its second, informational cross-browser table.
    // Not anchored to the start: several gate A/B spec files nest a test
    // inside its own `test.describe(...)`, and Playwright's `grep` matches
    // against the full title path (describe titles + test title), not
    // just the test's own title.
    // Firefox does not launch on the owner's machine (macOS sandbox refuses its
    // helper processes; see the brief 07 builder log), so it is opt-in:
    // PHRAISE_FIREFOX=1 npm run gates.
    ...(process.env.PHRAISE_FIREFOX ? [{ name: 'firefox', grep: /\[[ABCD]\]/, use: { ...devices['Desktop Firefox'] } }] : []),
    { name: 'webkit', grep: /\[[ABCD]\]/, use: { ...devices['Desktop Safari'] } },
  ],
});
