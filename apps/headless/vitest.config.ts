import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'headless',
    include: ['test/**/*.test.ts'],
  },
});
