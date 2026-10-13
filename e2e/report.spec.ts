import { expect, test } from '@playwright/test';

type Win = { __signalFall: { state: any } }; // eslint-disable-line @typescript-eslint/no-explicit-any

test('the end screen opens a match report with a table and charts', async ({ page }) => {
  await page.goto('/?seed=8&size=S&ai=easy&speed=8');
  await page.waitForFunction(() => (window as unknown as Win).__signalFall?.state?.cur);
  await page.waitForTimeout(4000);
  // End the match: surrender.
  await page.evaluate(() => (window as unknown as Win).__signalFall.state.send({ type: 'surrender' }));
  await expect(page.getByTestId('end-screen')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('open-report').click();
  const report = page.getByTestId('match-report');
  await expect(report).toContainText('Echo harvested');
  await expect(report.locator('.report-chart polyline')).toHaveCount(2);
  await report.locator('[data-chart=army]').click();
  await expect(report.locator('.report-chart polyline')).toHaveCount(2);
});
