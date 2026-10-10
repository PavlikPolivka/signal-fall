import { defineConfig, devices } from '@playwright/test';

// Playwright's patched Firefox fails to launch on macOS 27 ("Could not find
// profile folder"), so Firefox runs on Linux (CI) only. Set PW_FIREFOX=1 to force it.
const firefox = process.platform !== 'darwin' || process.env.PW_FIREFOX === '1';

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  fullyParallel: true,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: 'http://localhost:4173', viewport: { width: 1400, height: 860 } },
  webServer: {
    command: 'pnpm --filter @signal-fall/client build && pnpm --filter @signal-fall/client preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1400, height: 860 } } },
    ...(firefox ? [{ name: 'firefox', use: { ...devices['Desktop Firefox'], viewport: { width: 1400, height: 860 } } }] : []),
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width: 1400, height: 860 } } },
  ],
});
