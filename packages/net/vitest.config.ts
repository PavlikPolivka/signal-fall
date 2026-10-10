import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'net',
    include: ['test/**/*.test.ts'],
  },
});
