import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The daemon integration tests spin up real relays on 127.0.0.1:41xx and
    // real temp git repos; running test files in parallel would race for
    // ports and make timing-sensitive assertions flaky for no good reason.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
