import { expect, test } from '@playwright/test';

type Win = { __signalFall: { state: any; audio: any } }; // eslint-disable-line @typescript-eslint/no-explicit-any

test('the announcer speaks events in the faction voice', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'headless WebKit has no audio output to run an AudioContext');
  await page.goto('/play/?seed=8&size=S&ai=none&faction=1');
  await page.waitForFunction(() => (window as unknown as Win).__signalFall?.state?.ready);
  // Audio starts on a user gesture.
  await page.mouse.click(400, 300);
  await page.waitForFunction(() => (window as unknown as Win).__signalFall.audio.started);
  await page.evaluate(() => (window as unknown as Win).__signalFall.state.notice('Construction complete'));
  await expect.poll(() => page.evaluate(() => (window as unknown as Win).__signalFall.audio.spoken.join(',')), { timeout: 10_000 }).toContain('construction_complete');
  // Urgent lines are spoken even right after another one; repeats within the cooldown are not.
  await page.evaluate(() => {
    const s = (window as unknown as Win).__signalFall.state;
    s.alert('Base under attack', 0, 0);
    s.alert('Base under attack', 10, 10);
  });
  await expect.poll(() => page.evaluate(() => (window as unknown as Win).__signalFall.audio.spoken.join(',')), { timeout: 10_000 }).toBe('construction_complete,base_attack');
  // The Halcyon voice files are the ones being fetched.
  const fetched = await page.evaluate(() => performance.getEntriesByType('resource').map((r) => r.name).filter((n) => n.includes('/assets/voice/')));
  expect(fetched.length).toBeGreaterThan(0);
  expect(fetched.every((n) => n.includes('/voice/halcyon/'))).toBe(true);
});
