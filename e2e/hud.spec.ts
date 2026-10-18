import { expect, test } from '@playwright/test';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Win = { __signalFall: any };

test('idle army counter selects the idle units; tabs show queued counts', async ({ page }) => {
  await page.goto('/play/?scenario=sandbox');
  await page.waitForFunction(() => (window as unknown as Win).__signalFall?.state?.cur);
  const idle = page.getByTestId('idle-army');
  await expect(idle).toContainText('idle');
  await idle.click();
  expect(await page.evaluate(() => (window as unknown as Win).__signalFall.state.selection.length)).toBeGreaterThan(0);
  // Queue power on the Build tab: its badge shows 1.
  await page.evaluate(() => {
    const s = (window as unknown as Win).__signalFall.state;
    s.send({ type: 'build', category: 'structures', item: s.rules.structureIndex.get('dynamo') });
  });
  await expect(page.locator('[data-tab=structures] .tab-badge')).toHaveText('1', { timeout: 15_000 });
});

test('events land in the log, and the pause menu briefs the player', async ({ page }) => {
  await page.goto('/play/?scenario=sandbox');
  await page.waitForFunction(() => (window as unknown as { __signalFall: { state: { cur: unknown } } }).__signalFall?.state?.cur);
  await page.evaluate(() => (window as unknown as { __signalFall: { state: { alert: (t: string, x: number, y: number) => void } } }).__signalFall.state.alert('Base under attack', 40 * 1024, 40 * 1024));
  await page.click('[data-testid=log-btn]');
  await expect(page.getByTestId('event-log')).toContainText('Base under attack');
  await page.keyboard.press('Backquote');
  await expect(page.getByTestId('briefing')).toContainText('Destroy every enemy building');
  await page.click('[data-testid=menu-surrender]');
  await expect(page.getByTestId('surrender-confirm')).toBeVisible();
});
