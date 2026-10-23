import { defineConfig, devices } from '@playwright/test';

// Playwright's patched Firefox fails to launch on macOS 27 ("Could not find
// profile folder"), so Firefox runs on Linux (CI) only. Set PW_FIREFOX=1 to force it.
const firefox = process.platform !== 'darwin' || process.env.PW_FIREFOX === '1';
const viewport = { width: 1400, height: 860 };

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  fullyParallel: true,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: 'http://localhost:4173', viewport },
  webServer: {
    command: 'pnpm --filter @signal-fall/client build && pnpm --filter @signal-fall/client preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // With a Supabase stack (SUPABASE_URL / SUPABASE_ANON_KEY), the client is built against it and
    // multiplayer runs over Realtime signaling between separate browser profiles.
    env: { VITE_SUPABASE_URL: process.env.SUPABASE_URL ?? '', VITE_SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY ?? '' },
  },
  projects: [
    // Muted: test matches play the announcer and unit voices, which nobody running the suite wants to hear.
    { name: 'chromium', testIgnore: /perf\.spec/, use: { ...devices['Desktop Chrome'], viewport, launchOptions: { args: ['--mute-audio'] } } },
    ...(firefox ? [{ name: 'firefox', testIgnore: /perf\.spec/, use: { ...devices['Desktop Firefox'], viewport } }] : []),
    { name: 'webkit', testIgnore: /perf\.spec/, use: { ...devices['Desktop Safari'], viewport } },
    // FPS needs the real GPU: Metal on macOS (CI falls back to SwiftShader and checks frame cost only).
    {
      name: 'perf',
      testMatch: /perf\.spec/,
      use: {
        ...devices['Desktop Chrome'],
        viewport,
        launchOptions: { args: ['--mute-audio', ...(process.platform === 'darwin' ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] : [])] },
      },
    },
  ],
});
