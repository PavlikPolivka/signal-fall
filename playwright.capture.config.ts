import { defineConfig } from '@playwright/test';
import base from './playwright.config';

/** Screenshot tools (not tests): `pnpm exec playwright test -c playwright.capture.config.ts`. */
export default defineConfig({
  ...base,
  testDir: 'e2e/capture',
  testMatch: /\.capture\.ts$/,
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  timeout: 300_000,
});
