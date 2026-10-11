import { expect, test } from '@playwright/test';

test('codex opens from setup and the in-game menu, and lists data-driven units', async ({ page }) => {
  await page.goto('/');
  await page.click('[data-testid=open-codex]');
  await expect(page.locator('[data-testid=codex]')).toContainText('Signal Fall');
  await page.click('[data-codex-tab=units]');
  await expect(page.locator('[data-codex-unit=bulldog]')).toContainText('Main battle tank');
  await page.click('[data-codex-tab=buildings]');
  await expect(page.locator('[data-codex-building=smelter]')).toContainText('Harvesters unload here');
  await page.click('[data-codex-tab=controls]');
  await expect(page.locator('[data-testid=codex]')).toContainText('Cycle stance');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid=codex]')).toHaveCount(0);

  await page.goto('/?ai=none');
  await page.waitForFunction(() => (window as unknown as { __signalFall: { state: { ready: boolean } } }).__signalFall.state.ready);
  await page.keyboard.press('Escape'); // nothing selected -> menu
  await page.click('[data-testid=menu-codex]');
  await expect(page.locator('[data-testid=codex]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid=codex]')).toHaveCount(0);
});
