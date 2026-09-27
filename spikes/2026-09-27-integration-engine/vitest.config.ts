import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Later briefs' relay/daemon integration tests spin up real servers on
    // 127.0.0.1:43xx and real temp git repos; running test files in
    // parallel would race for ports and make timing-sensitive assertions
    // flaky for no good reason (spike 3's own vitest.config.ts, same
    // reasoning). Brief 01's tests are pure/in-process, but keep this from
    // the start so later briefs don't need to revisit it.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
