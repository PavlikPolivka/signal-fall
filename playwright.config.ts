import { defineConfig, devices } from '@playwright/test';

// Playwright's patched Firefox fails to launch on macOS 27 ("Could not find
// profile folder"), so Firefox runs on Linux (CI) only. Set PW_FIREFOX=1 to force it.
const firefox = process.platform !== 'darwin' || process.env.PW_FIREFOX === '1';

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  fullyParallel: true,
  reporter: process.env.CI ? 'github' : 'list',
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    ...(firefox ? [{ name: 'firefox', use: { ...devices['Desktop Firefox'] } }] : []),
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
