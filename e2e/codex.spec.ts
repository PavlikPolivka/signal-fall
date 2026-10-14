import { expect, test } from '@playwright/test';

test('codex opens from setup and the in-game menu, and lists data-driven units', async ({ page }) => {
  await page.goto('/play/');
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

  await page.goto('/play/?ai=none');
  await page.waitForFunction(() => (window as unknown as { __signalFall: { state: { ready: boolean } } }).__signalFall.state.ready);
  await page.keyboard.press('Backquote'); // the menu key
  await page.click('[data-testid=menu-codex]');
  await expect(page.locator('[data-testid=codex]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid=codex]')).toHaveCount(0);
});

test('credits list the asset licenses', async ({ page }) => {
  await page.goto('/play/');
  await page.click('[data-testid=open-credits]');
  const credits = page.getByTestId('credits');
  await expect(credits).toBeVisible();
  await expect(credits).toContainText('Unit and building sprites');
  await expect(credits).toContainText('Saira Stencil One');
  await page.keyboard.press('Escape');
  await expect(credits).toBeHidden();
});
