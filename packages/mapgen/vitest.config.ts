import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'mapgen',
    include: ['test/**/*.test.ts'],
    testTimeout: 120_000,
  },
});
