import { expect, test } from '@playwright/test';

type Win = { __signalFall: { state: any } }; // eslint-disable-line @typescript-eslint/no-explicit-any
const online = !!process.env.SUPABASE_URL;

test('stats explain themselves without the online service', async ({ page }) => {
  test.skip(online, 'offline build only');
  await page.goto('/');
  await page.click('[data-testid=open-stats]');
  await expect(page.getByTestId('stats-offline')).toBeVisible();
});

test('a finished match against the AI shows in history and records', async ({ page }) => {
  test.skip(!online, 'needs a Supabase stack (SUPABASE_URL)');
  await page.goto('/');
  await page.click('[data-testid=open-stats]');
  await expect(page.getByTestId('stats-empty')).toBeVisible();

  await page.goto('/?seed=8&size=S&ai=easy&speed=8&faction=2&enemy=1');
  await page.waitForFunction(() => (window as unknown as Win).__signalFall?.state?.cur);
  await page.waitForTimeout(2000);
  await page.evaluate(() => (window as unknown as Win).__signalFall.state.send({ type: 'surrender' }));
  await expect(page.getByTestId('end-screen')).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1500); // the record is written in the background

  await page.goto('/');
  await page.click('[data-testid=open-stats]');
  const history = page.getByTestId('stats-history');
  await expect(history).toContainText('AI (Easy)');
  await expect(history).toContainText('Choir');
  await expect(history).toContainText('Loss');
  await page.click('[data-stats-tab=records]');
  await expect(page.getByTestId('stats-records')).toContainText('0 wins, 1 losses');
  await page.click('[data-stats-tab=leaderboard]');
  await expect(page.getByTestId('stats-leaderboard')).toBeVisible();
});
