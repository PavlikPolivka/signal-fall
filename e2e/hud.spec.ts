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
