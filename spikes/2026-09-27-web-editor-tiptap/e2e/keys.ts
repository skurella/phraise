// Line start and line end keys, per browser and platform. Added by the
// spike 7 orchestrator after the first WebKit run: on macOS, WebKit (like
// Safari) maps Home and End to scrolling, not caret movement, so tests that
// pressed Home or End never moved the caret there; Cmd+Left and Cmd+Right
// are its line keys. Chromium on macOS maps Home and End to line start and
// end, and the suite was written and verified against that.
//
// Open item: in one gate E scenario Chromium's Cmd+Right left the caret
// three characters short of the line end, deterministically, while a
// standalone probe of the same situation (another user's caret widget at
// the line end) did not reproduce it. Chromium therefore keeps Home and End
// here; see the orchestrator log.
import type { Page } from '@playwright/test';

function isMacWebKit(page: Page): boolean {
  return process.platform === 'darwin' && page.context().browser()?.browserType().name() === 'webkit';
}

export function lineStartKey(page: Page): string {
  return isMacWebKit(page) ? 'Meta+ArrowLeft' : 'Home';
}

export function lineEndKey(page: Page): string {
  return isMacWebKit(page) ? 'Meta+ArrowRight' : 'End';
}
