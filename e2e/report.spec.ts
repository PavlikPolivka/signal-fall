import { expect, test } from '@playwright/test';

type Win = { __signalFall: { state: any } }; // eslint-disable-line @typescript-eslint/no-explicit-any

test('the end screen opens a match report with a table and charts', async ({ page }) => {
  await page.goto('/play/?seed=8&size=S&ai=easy&speed=8');
  await page.waitForFunction(() => (window as unknown as Win).__signalFall?.state?.cur);
  await page.waitForTimeout(4000);
  // End the match: surrender.
  await page.evaluate(() => (window as unknown as Win).__signalFall.state.send({ type: 'surrender' }));
  await expect(page.getByTestId('end-screen')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('open-report').click();
  const report = page.getByTestId('match-report');
  await expect(report).toContainText('Echo harvested');
  // Habits over the match, and tips for next time (surrendering early leaves plenty to work on).
  await expect(report.getByTestId('report-habits')).toContainText('Factory idle time');
  await expect(report.getByTestId('report-habits')).toContainText('Credits held (average)');
  await expect(report.getByTestId('report-tips')).toContainText('Next time');
  await expect(report.locator('.report-chart polyline')).toHaveCount(2);
  await report.locator('[data-chart=army]').click();
  await expect(report.locator('.report-chart polyline')).toHaveCount(2);
});

test('2v2: surrendering while the ally fights on shows "you are out", then the end', async ({ page }) => {
  await page.goto('/play/?mode=2v2&seed=8&size=S&ai=easy&speed=8');
  await page.waitForFunction(() => (window as unknown as Win).__signalFall?.state?.cur);
  await page.waitForTimeout(2000);
  await page.evaluate(() => (window as unknown as Win).__signalFall.state.send({ type: 'surrender' }));
  await expect(page.getByTestId('out-screen')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('keep-watching').click();
  await expect(page.getByTestId('out-screen')).toHaveCount(0);
});

test('rematch with the sides swapped: you play the enemy faction on the same map', async ({ page }) => {
  await page.goto('/play/');
  await page.click('[data-testid=open-skirmish]');
  await page.click('[data-testid=mode] [data-value="1v1"]');
  await page.click('[data-testid=faction] [data-value="0"]');
  await page.selectOption('[data-testid=seat-enemy-faction]', '2');
  await page.click('[data-testid=start]');
  await page.waitForFunction(() => (window as unknown as Win).__signalFall?.state?.cur);
  await page.evaluate(() => (window as unknown as Win).__signalFall.state.send({ type: 'surrender' }));
  await page.click('[data-testid=end-rematch-swapped]');
  // The rematch is a new page: until it loads, the old match (factions [0, 2]) still answers.
  await page.waitForURL(/rematch=1/);
  await page.waitForFunction(() => (window as unknown as Win).__signalFall?.state?.cur?.tick >= 0 && (window as unknown as Win).__signalFall.state.players.length === 2);
  const factions = await page.evaluate(() => (window as unknown as Win).__signalFall.state.players.map((p: { faction: number }) => p.faction));
  expect(factions).toEqual([2, 0]);
});
