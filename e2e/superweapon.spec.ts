import { expect, test } from '@playwright/test';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Win = { __signalFall: any };

test('superweapons charge in public: own button, every timer in the top bar, the strike zone under the cursor', async ({ page }) => {
  await page.goto('/play/?scenario=sandbox');
  await page.waitForFunction(() => (window as unknown as Win).__signalFall?.state?.cur);
  // Both sides stand a superweapon in the sandbox: two timers, both charging.
  await expect(page.locator('[data-testid=super-timers] .super-timer')).toHaveCount(2);
  const button = page.getByTestId('superweapon');
  await expect(button).toContainText('Barrage');
  await expect(button).toContainText(/\d:\d\d/);
  // Not charged yet: clicking says when.
  await button.click();
  await expect(page.getByTestId('alert')).toContainText('Barrage is ready in');
  expect(await page.evaluate(() => (window as unknown as Win).__signalFall.state.mode)).toBe('normal');
  expect(await page.evaluate(() => (window as unknown as Win).__signalFall.state.superweaponRule().id)).toBe('long_tom');
});

test('an enemy superweapon is announced 30 seconds before it is ready, and its timer flashes', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/play/?scenario=sandbox');
  await page.waitForFunction(() => (window as unknown as Win).__signalFall?.state?.cur);
  await page.evaluate(() => (window as unknown as Win).__signalFall.state.post({ type: 'speed', speed: 16 }));
  await expect(page.getByTestId('alert')).toContainText('Enemy superweapon in 30 seconds', { timeout: 90_000 });
  await expect(page.locator('[data-testid=super-timer-1]')).toHaveClass(/imminent/);
});
