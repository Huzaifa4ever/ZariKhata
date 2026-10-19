import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./test/globalSetup.ts'],
    testTimeout: 20000,
    hookTimeout: 20000,
    fileParallelism: false, // tests share one MySQL DB; avoid cross-test interference
  },
});
